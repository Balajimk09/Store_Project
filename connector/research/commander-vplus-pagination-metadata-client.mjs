import { Agent, request as httpsRequest } from 'node:https'
import { readFileSync } from 'node:fs'

export const PAGE1_XML='<domain:PLUSelect xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><pageSize>100</pageSize><page>1</page></domain:PLUSelect>'
const MAX_BYTES=1048576,MAX_DEPTH=8,MAX_ELEMENTS=5000,MAX_ATTRIBUTES=5000,MAX_NAMES=128,MAX_RESULT=8192,NAME=/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/
const FIELDS=['request_succeeded','response_structure_valid','page_field_present','of_pages_field_present','page_source_kind','of_pages_source_kind','page_value_unambiguous','of_pages_value_unambiguous','current_page_is_one','of_pages_bucket','more_pages_present','pagination_metadata_valid','raw_response_retained','product_values_retained','safe_error_code']
const empty=code=>({request_succeeded:false,response_structure_valid:false,page_field_present:false,of_pages_field_present:false,page_source_kind:'none',of_pages_source_kind:'none',page_value_unambiguous:false,of_pages_value_unambiguous:false,current_page_is_one:null,of_pages_bucket:'unknown',more_pages_present:null,pagination_metadata_valid:false,raw_response_retained:false,product_values_retained:false,safe_error_code:code??null})
const fail=code=>{throw new Error(code)}
const local=name=>name.split(':').at(-1)
const bucket=value=>value===1?'one':value<=5?'2-5':value<=10?'6-10':value<=25?'11-25':value<=50?'26-50':value<=1000000?'over-50':'unknown'
function number(value){if(typeof value!=='string'||!/^[0-9]+$/.test(value))return null;const n=Number(value);return Number.isSafeInteger(n)&&n>0&&n<=1000000?n:null}
function sourceKind(items){const s=new Set(items.map(x=>x.kind));return !s.size?'none':s.size===1?[...s][0]:'mixed'}
function inspect(xml){
  if(/<!DOCTYPE|<!ENTITY|<\?[^x]/i.test(xml))fail('xml_unsafe')
  const tags=xml.match(/<[^>]*>/g);if(!tags)fail('xml_invalid');const stack=[],wanted={page:[],ofPages:[]},names=new Set();let root=false,elements=0,attrs=0
  for(const tag of tags){
    if(/^<\?xml\s/i.test(tag))continue
    if(/^<\//.test(tag)){const name=tag.slice(2,-1).trim();if(!stack.length||stack.pop()!==name)fail('xml_invalid');continue}
    if(/^<!--/.test(tag)||/^<!/.test(tag))fail('xml_unsafe')
    const m=/^<([A-Za-z_][A-Za-z0-9_.:-]*)([\s\S]*?)(\/?)>$/.exec(tag);if(!m)fail('xml_invalid');const name=m[1],lname=local(name);if(!NAME.test(lname))fail('xml_unsafe');names.add(lname);if(++elements>MAX_ELEMENTS||names.size>MAX_NAMES||stack.length>=MAX_DEPTH)fail('structure_limit_exceeded')
    const attrsRe=/([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(["'])(.*?)\2/g;let a;while((a=attrsRe.exec(m[2]))){const an=local(a[1]);if(!NAME.test(an)||++attrs>MAX_ATTRIBUTES)fail('structure_limit_exceeded');if(wanted[an])wanted[an].push({kind:'attribute',value:a[3]})}
    if(!root){root=true}else if(!stack.length)fail('xml_invalid');if(m[3]!=='/')stack.push(name)
  }
  if(!root||stack.length)fail('xml_invalid')
  const elementsRe=/<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?(page|ofPages)\b[^>]*>([^<]*)<\/(?:[A-Za-z_][A-Za-z0-9_.-]*:)?\1\s*>/g;let match
  while((match=elementsRe.exec(xml))){wanted[match[1]].push({kind:'element',value:match[2]})}
  return wanted
}
export function analyzePagination(bytes){
  if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);if(bytes.length>MAX_BYTES)fail('response_too_large');let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{fail('invalid_utf8')}
  const all=inspect(xml),page=all.page,ofPages=all.ofPages,values=x=>[...new Set(x.map(y=>number(y.value)).filter(n=>n!==null))],pv=values(page),ov=values(ofPages)
  const result={request_succeeded:true,response_structure_valid:true,page_field_present:page.length>0,of_pages_field_present:ofPages.length>0,page_source_kind:sourceKind(page),of_pages_source_kind:sourceKind(ofPages),page_value_unambiguous:pv.length===1,of_pages_value_unambiguous:ov.length===1,current_page_is_one:null,of_pages_bucket:'unknown',more_pages_present:null,pagination_metadata_valid:false,raw_response_retained:false,product_values_retained:false,safe_error_code:null}
  if(!page.length||!ofPages.length){result.safe_error_code='pagination_metadata_missing';return result}if(pv.length!==1||ov.length!==1){result.safe_error_code='pagination_metadata_ambiguous';return result}
  result.current_page_is_one=pv[0]===1;result.of_pages_bucket=bucket(ov[0]);result.more_pages_present=ov[0]>pv[0]
  if(!result.current_page_is_one||ov[0]<pv[0]||result.of_pages_bucket==='unknown'){result.safe_error_code='pagination_metadata_invalid';return result}
  result.pagination_metadata_valid=true;return result
}
export function buildPage1Body(cookie){if(typeof cookie!=='string'||!cookie||/[\r\n]/.test(cookie))fail('invalid_input');return `cmd=vPLUs&cookie=${encodeURIComponent(cookie)}\r\n\r\n${PAGE1_XML}`}
export async function requestPage1(input,{requestFactory=httpsRequest,readCertificate=readFileSync}={}){if(!input||Object.keys(input).sort().join(',')!=='base_url,ca_cert_path,session_cookie,timeout_ms'||input.timeout_ms!==15000)fail('invalid_input');const url=new URL(input.base_url);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash)fail('invalid_origin');let ca;try{ca=readCertificate(input.ca_cert_path,'utf8')}catch{fail('ca_file_invalid')}const body=buildPage1Body(input.session_cookie),agent=new Agent({ca,rejectUnauthorized:true});try{const response=await new Promise((resolve,reject)=>{const req=requestFactory(`${url.origin}/cgi-bin/NAXML?`,{method:'POST',agent,rejectUnauthorized:true,headers:{'content-type':'text/plain; charset=UTF-8','content-length':Buffer.byteLength(body)}},res=>{const chunks=[];let n=0;res.on('data',chunk=>{n+=chunk.length;if(n>MAX_BYTES){req.destroy();reject(new Error('response_too_large'))}else chunks.push(chunk)});res.on('end',()=>resolve({status:res.statusCode||0,bytes:Buffer.concat(chunks)}))});req.on('error',()=>reject(new Error('transport_failed')));req.setTimeout(15000,()=>{req.destroy();reject(new Error('timeout'))});req.write(body);req.end()});if(response.status===401||response.status===403)return empty('http_rejected');if(response.status<200||response.status>=300)return empty('http_rejected');return analyzePagination(response.bytes)}finally{agent.destroy()}}
if(process.argv[1]?.endsWith('commander-vplus-pagination-metadata-client.mjs')){const chunks=[];for await(const c of process.stdin)chunks.push(c);let result;try{result=await requestPage1(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch(error){result=empty(['invalid_input','invalid_origin','ca_file_invalid','transport_failed','timeout','response_too_large','http_rejected','invalid_utf8','xml_invalid','xml_unsafe','structure_limit_exceeded'].includes(error.message)?error.message:'unexpected_failure')}const json=JSON.stringify(result);process.stdout.write(json.length<=MAX_RESULT?json:JSON.stringify(empty('result_too_large')))}
