import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
const root=path.resolve('connector'), stage=path.join(root,'build','commander-catalog-page1-structure-93c4cbc')
test('page-one package is a four-file fixed read-only closure',async()=>{const manifest=JSON.parse(await readFile(path.join(stage,'manifest.json'),'utf8'));assert.equal(manifest.runtime_files.length,2);assert.deepEqual(manifest.runtime_files.map(x=>x.path).sort(),['maintenance/run-connector-commander-catalog-page1-structure.ps1','research/commander-vplus-page1-structure-client.mjs']);assert.deepEqual(manifest.fixed_request,{command:'vPLUs',page:1,page_size:100,query_present:false,where_present:false,maximum_request_count:1,retry_count:0,response_byte_limit:1048576});for(const x of manifest.runtime_files){const a=await readFile(path.join(root,x.path));const b=await readFile(path.join(stage,x.path));assert.deepEqual(a,b);assert.equal(createHash('sha256').update(a).digest('hex'),x.sha256);assert.equal(a.length,x.size_bytes)}const runner=await readFile(path.join(stage,'maintenance/run-connector-commander-catalog-page1-structure.ps1'),'utf8');assert.match(runner,/New-StorePulseCommanderConnection/);assert.match(runner,/Get-StorePulseCommanderSessionCookie/);assert.match(runner,/StreamWriter.*\$true/);assert.match(runner,/page=1/);assert.doesNotMatch(runner,/commander-cookie-auth-provider|commander-session-manager|uPLUs|Supabase/i);assert.equal((await stat(path.join(root,'build','StorePulse-Connector-Commander-Catalog-Page1-Structure-93c4cbc.zip'))).size>0,true)})

test('PowerShell public result contract is exactly the authoritative 22 fields', async () => {
  const runner = await readFile(path.join(root, 'maintenance', 'run-connector-commander-catalog-page1-structure.ps1'), 'utf8')
  const source = runner.match(/\[ordered\]@\{([^}]*)\}/)?.[1]
  const keys = [...source.matchAll(/(?:^|;)\s*([a-z_]+)=/g)].map(match => match[1])
  assert.deepEqual(keys, ['operation','authentication_succeeded','catalog_request_attempted','catalog_request_succeeded','request_page','request_page_size','query_present','where_present','response_structure_valid','response_size_bucket','root_local_name','root_namespace_matches_expected','record_element_candidate','record_count_bucket','pagination_candidate_names','raw_response_retained','product_values_retained','write_attempted','session_disposed','error_code','failure_stage','exception_type'])
  assert.equal(keys.length, 22)
  assert.match(runner, /\[AllowNull\(\)\]\$Code=\$null,\[AllowNull\(\)\]\$Stage=\$null,\[AllowNull\(\)\]\$Type=\$null/)
  assert.match(runner, /foreach\(\$v in @\('Size','Root','Record','Count','Code','Stage','Type'\)\)\{if\(\[string\]::IsNullOrEmpty\(\[string\]\(Get-Variable \$v -ValueOnly\)\)\)\{Set-Variable \$v \$null\}\}/)
  assert.match(runner, /\$code='catalog_transport';\$failure='catalog_transport'/)
  assert.match(runner, /\$code='catalog_structure_invalid';\$failure='catalog_structure_validate'/)
})
