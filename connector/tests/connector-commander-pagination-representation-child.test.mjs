import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PAGE1_XML } from '../research/commander-vplus-pagination-representation-client.mjs'
import { runPinnedRepresentation, validateChildInput } from '../research/commander-vplus-pagination-representation-child.mjs'

const fields = ['request_succeeded', 'bounded_response_received', 'utf8_valid', 'xml_parse_succeeded', 'response_root_valid', 'representation_analysis_completed', 'page_target_detected', 'of_pages_target_detected', 'page_representation', 'of_pages_representation', 'page_depth_bucket', 'of_pages_depth_bucket', 'page_candidate_count_bucket', 'of_pages_candidate_count_bucket', 'page_numeric_class', 'of_pages_numeric_class', 'page_conflicting_candidates', 'of_pages_conflicting_candidates', 'raw_response_retained', 'product_values_retained', 'safe_error_code']
const child = new URL('../research/commander-vplus-pagination-representation-child.mjs', import.meta.url)
const config = { commander_ip: 'commander.fixture', commander_tls_server_name: 'commander.fixture', commander_tls_peer_sha256: 'A'.repeat(64), commander_tls_ca_bundle_sha256: 'B'.repeat(64) }
const filesystem = { async lstat() { return { isFile: () => true, isSymbolicLink: () => false, isReparsePoint: () => false } }, async readFile() { return Buffer.from(JSON.stringify(config)) } }
const trust = { caBundle: Buffer.from('fixture'), serverName: 'commander.fixture', peerSha256: 'A'.repeat(64) }

function check(value, code = null) {
  assert.deepEqual(Object.keys(value), fields)
  assert.equal(value.raw_response_retained, false)
  assert.equal(value.product_values_retained, false)
  assert.equal(value.safe_error_code, code)
}
function dependencies(body = '<domain:PLUs xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><page>1</page><ofPages>2</ofPages></domain:PLUs>') {
  let calls = 0
  return { calls: () => calls, filesystem, trustLoader: async () => trust, sender: async request => { calls += 1; assert.equal(request.origin, 'https://commander.fixture'); assert.equal(request.timeoutMs, 15000); assert.deepEqual(request.request, { command: 'vPLUs', sessionCookie: 'fixture-cookie', xml: PAGE1_XML }); return { status: 200, body } } }
}

test('preserves the exact one-field input contract', () => {
  assert.equal(validateChildInput({ session_cookie: 'fixture-cookie' }), 'fixture-cookie')
  for (const value of [null, {}, { cookie: 'x' }, { session_cookie: 'x', extra: false }, { session_cookie: '' }, { session_cookie: 1 }, { session_cookie: 'x&y' }, { session_cookie: 'x'.repeat(4097) }]) assert.throws(() => validateChildInput(value), /invalid_input/)
})

test('uses pinned dependencies once and preserves parser structural classes', async () => {
  for (const [body, expected] of [
    ['<domain:PLUs xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01" page="1" ofPages="2"/>', 'root_attribute'],
    ['<domain:PLUs xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><page/><ofPages/></domain:PLUs>', 'self_closing_element'],
    ['<domain:PLUs xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><page data="1"/><ofPages data="2"/></domain:PLUs>', 'element_with_attributes'],
    ['<domain:PLUs xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><page><x>1</x></page><ofPages><x>2</x></ofPages></domain:PLUs>', 'element_with_children'],
  ]) {
    const d = dependencies(body); const output = await runPinnedRepresentation({ session_cookie: 'fixture-cookie' }, d)
    check(output, null); assert.equal(output.page_representation, expected); assert.equal(output.of_pages_representation, expected); assert.equal(d.calls(), 1)
  }
})

test('normalizes trust, transport, timeout, response, and HTTP errors safely', async () => {
  for (const [override, expected] of [
    [{ trustLoader: async () => { const e = new Error('commander_tls_peer_mismatch'); e.code = e.message; throw e } }, 'transport_failed'],
    [{ sender: async () => { const e = new Error('timeout'); e.code = e.message; throw e } }, 'timeout'],
    [{ sender: async () => ({ status: 403, body: '' }) }, 'http_rejected'],
    [{ sender: async () => { const e = new Error('response_too_large'); e.code = e.message; throw e } }, 'response_too_large'],
    [{ sender: async () => { const e = new Error('response_invalid'); e.code = e.message; throw e } }, 'invalid_utf8'],
  ]) {
    const d = { ...dependencies(), ...override }; const output = await runPinnedRepresentation({ session_cookie: 'fixture-cookie' }, d); check(output, expected)
  }
})

test('direct execution emits one safe result and importing has no transport side effects', async () => {
  const source = await readFile(child, 'utf8')
  assert.match(source, /resolveCommanderTlsTrust/); assert.match(source, /sendCommanderNaxml/); assert.doesNotMatch(source, /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|uPLUs|Supabase/i)
  const result = await new Promise((resolve, reject) => { const p = spawn(process.execPath, [fileURLToPath(child)], { windowsHide: true }); let out = '', err = ''; p.stdout.on('data', x => { out += x }); p.stderr.on('data', x => { err += x }); p.on('error', reject); p.on('close', code => resolve({ code, out, err })); p.stdin.end('not-json') })
  assert.equal(result.code, 1); assert.equal(result.err, ''); const output = JSON.parse(result.out); check(output, 'invalid_input')
})
