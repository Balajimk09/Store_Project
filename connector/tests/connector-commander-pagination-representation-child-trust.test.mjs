import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(repo, 'research', 'commander-vplus-pagination-representation-child.mjs')
const fields = ['request_succeeded','bounded_response_received','utf8_valid','xml_parse_succeeded','response_root_valid','representation_analysis_completed','page_target_detected','of_pages_target_detected','page_representation','of_pages_representation','page_depth_bucket','of_pages_depth_bucket','page_candidate_count_bucket','of_pages_candidate_count_bucket','page_numeric_class','of_pages_numeric_class','page_conflicting_candidates','of_pages_conflicting_candidates','raw_response_retained','product_values_retained','safe_error_code']

async function fixture(config) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'representation-trust-'))
  const runtime = path.join(dir, 'runtime'); const research = path.join(runtime, 'research'); const session = path.join(runtime, 'lib', 'commander', 'session'); const configPath = path.join(dir, 'config.json'); const programData = path.join(dir, 'programdata')
  await mkdir(session, { recursive: true }); await mkdir(research, { recursive: true })
  let child = await readFile(source, 'utf8')
  for (const [from, to] of [["const CONFIG_PATH = 'C:\\\\ProgramData\\\\StorePulse\\\\config.json'", `const CONFIG_PATH = ${JSON.stringify(configPath)}`], ["const PROGRAM_DATA = 'C:\\\\ProgramData'", `const PROGRAM_DATA = ${JSON.stringify(programData)}`]]) { assert.equal(child.split(from).length - 1, 1); child = child.replace(from, to) }
  await Promise.all([writeFile(path.join(research, 'commander-vplus-pagination-representation-child.mjs'), child), copyFile(path.join(repo, 'research', 'commander-vplus-pagination-representation-client.mjs'), path.join(research, 'commander-vplus-pagination-representation-client.mjs')), copyFile(path.join(repo, 'lib','commander','commander-naxml-client.mjs'), path.join(runtime,'lib','commander','commander-naxml-client.mjs')), copyFile(path.join(repo, 'lib','commander','session','commander-tls-trust.mjs'), path.join(session,'commander-tls-trust.mjs'))])
  if (config !== undefined) await writeFile(configPath, config)
  return { dir, child: path.join(research, 'commander-vplus-pagination-representation-child.mjs') }
}
async function run(child) { return new Promise(resolve => { const p=execFile(process.execPath,[child],{windowsHide:true},(e,out,err)=>resolve({code:e?.code??0,out,err})); p.stdin.end('{"session_cookie":"x"}') }) }
function safe(run) { assert.equal(run.code,1); assert.equal(run.err,''); const body=JSON.parse(run.out); assert.deepEqual(Object.keys(body),fields); assert.equal(body.safe_error_code,'transport_failed'); assert.equal(body.request_succeeded,false); assert.equal(body.representation_analysis_completed,false) }
const valid = { commander_ip:'127.0.0.1', commander_tls_server_name:'127.0.0.1', commander_tls_peer_sha256:'A'.repeat(64), commander_tls_ca_bundle_sha256:'B'.repeat(64) }
test('real child safely rejects malformed or absent temporary configuration before a request', async () => { for (const config of [undefined,'',' ','{','null','[]','"x"','7','{}']) { const f=await fixture(config); try { safe(await run(f.child)) } finally { await rm(f.dir,{recursive:true,force:true}) } } })
test('real child follows source config validation and JSON last-key-wins semantics', async () => { const invalid=[{}, {...valid,commander_ip:'https://bad'}, {...valid,commander_ip:'bad path'}, {...valid,commander_tls_server_name:'https://bad'}, {...valid,commander_tls_server_name:'bad/path'}, {...valid,commander_tls_peer_sha256:'A'.repeat(63)}, {...valid,commander_tls_ca_bundle_sha256:'SHA256:'+ 'B'.repeat(64)}]; for (const value of invalid) { const f=await fixture(JSON.stringify(value)); try { safe(await run(f.child)) } finally { await rm(f.dir,{recursive:true,force:true}) } }; const duplicate=`{"commander_ip":"bad path","commander_ip":"127.0.0.1","commander_tls_server_name":"127.0.0.1","commander_tls_peer_sha256":"${'a'.repeat(64)}","commander_tls_ca_bundle_sha256":"${'b'.repeat(64)}"}`; const f=await fixture(duplicate); try { safe(await run(f.child)) } finally { await rm(f.dir,{recursive:true,force:true}) } })

test('real child safely rejects fixed CA and server certificate file failures before a request', async () => {
  for (const kind of ['missing-ca', 'ca-directory', 'empty-ca', 'invalid-ca', 'missing-server', 'server-directory', 'empty-server', 'invalid-server']) {
    const f = await fixture(JSON.stringify(valid))
    try {
      const certificates = path.join(f.dir, 'programdata', 'StorePulse', 'certificates')
      await mkdir(certificates, { recursive: true })
      if (kind === 'ca-directory') await mkdir(path.join(certificates, 'commander-ca.pem'))
      if (kind === 'server-directory') await mkdir(path.join(certificates, 'commander-server.pem'))
      if (kind === 'empty-ca') await writeFile(path.join(certificates, 'commander-ca.pem'), '')
      if (kind === 'invalid-ca') await writeFile(path.join(certificates, 'commander-ca.pem'), 'not-a-certificate')
      if (kind === 'empty-server') { await writeFile(path.join(certificates, 'commander-ca.pem'), 'not-a-certificate'); await writeFile(path.join(certificates, 'commander-server.pem'), '') }
      if (kind === 'invalid-server') { await writeFile(path.join(certificates, 'commander-ca.pem'), 'not-a-certificate'); await writeFile(path.join(certificates, 'commander-server.pem'), 'not-a-certificate') }
      safe(await run(f.child))
    } finally { await rm(f.dir, { recursive: true, force: true }) }
  }
})
