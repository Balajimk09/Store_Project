import { getCommanderOperation } from './commander-operation-registry.mjs'
const LIMITS = Object.freeze({ bytes: 262144, elements: 256, depth: 16, path: 1024, attrs: 16, name: 128, namespace: 512, cookies: 8 })
const fail = (code) => { const e = new Error(code); e.code = code; throw e }
const safe = (s, max) => { if (typeof s !== 'string' || s.length > max || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(s)) fail('response_structure_limit'); return s }
export function emptyValidateStructureResult(code) { return { capture_succeeded: false, root: null, elements: [], cookie_elements: [], cookie_element_count: 0, safe_error_code: code } }
export function parseValidateStructure(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > LIMITS.bytes) fail('response_too_large')
  let xml; try { xml = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { fail('response_invalid_encoding') }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml)) fail('response_invalid_xml')
  const token = /<\/?([A-Za-z_][\w.:-]*)([^>]*)>|([^<]+)/g; const stack=[]; const elements=[]; const cookies=[]; let root=null; let count=0; let match
  while ((match = token.exec(xml))) {
    if (match[3] !== undefined) continue
    const close = match[0].startsWith('</'); if (close) { if (!stack.length || stack.at(-1).name !== match[1]) fail('response_invalid_xml'); stack.pop(); continue }
    const name=safe(match[1], LIMITS.name); const attrs=match[2]||''; const self=/\/\s*$/.test(attrs); const depth=stack.length; if (depth > LIMITS.depth || ++count > LIMITS.elements) fail('response_structure_limit')
    const attrNames=[...attrs.matchAll(/\s([A-Za-z_][\w.:-]*)\s*=/g)].map(x=>safe(x[1],LIMITS.name)); if (attrNames.length>LIMITS.attrs) fail('response_structure_limit')
    const path=`/${[...stack.map(x=>x.name),name].join('/')}`; if (path.length>LIMITS.path) fail('response_structure_limit')
    const node={ name, path, depth, parent: stack.at(-1)?.name??null }; if (!root) root=node; else elements.push({ path, local_name:name, namespace_uri:'', parent_local_name:node.parent, depth, attribute_names:attrNames })
    if (name.toLowerCase()==='cookie') { if (++cookies.length>LIMITS.cookies) fail('response_structure_limit'); cookies.push({ path, local_name:name, namespace_uri:'', parent_local_name:node.parent, is_direct_child_of_root:depth===1 }) }
    if (!self) stack.push(node)
  }
  if (!root || stack.length) fail('response_invalid_xml')
  return { capture_succeeded:true, root:{ local_name:root.name, namespace_uri:'' }, elements, cookie_elements:cookies, cookie_element_count:cookies.length, safe_error_code:null }
}
export async function runCommanderDiagnostic({ operation, approval, transport }) {
  try { const op=getCommanderOperation(operation); if (!approval?.approved || approval.approvedOperation!==op.operation) return emptyValidateStructureResult('approval_required'); if (!transport || typeof transport.validate!== 'function') return emptyValidateStructureResult('contained_worker_failed'); return parseValidateStructure(await transport.validate(op)) } catch (error) { return emptyValidateStructureResult(error?.code || 'internal_failure') }
}
