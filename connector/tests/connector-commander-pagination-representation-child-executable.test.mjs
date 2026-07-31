import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const child = path.join(repo, 'research', 'commander-vplus-pagination-representation-child.mjs')
const fields = ['request_succeeded', 'bounded_response_received', 'utf8_valid', 'xml_parse_succeeded', 'response_root_valid', 'representation_analysis_completed', 'page_target_detected', 'of_pages_target_detected', 'page_representation', 'of_pages_representation', 'page_depth_bucket', 'of_pages_depth_bucket', 'page_candidate_count_bucket', 'of_pages_candidate_count_bucket', 'page_numeric_class', 'of_pages_numeric_class', 'page_conflicting_candidates', 'of_pages_conflicting_candidates', 'raw_response_retained', 'product_values_retained', 'safe_error_code']
const secret = 'executable-input-cookie-sentinel'

function execute(input) {
  return new Promise((resolve, reject) => {
    const childProcess = execFile(process.execPath, [child], { windowsHide: true, timeout: 10000 }, (error, stdout, stderr) => {
      if (error?.killed) return reject(error)
      resolve({ code: error?.code ?? 0, stdout, stderr })
    })
    childProcess.stdin.end(input)
  })
}

function assertFailure(run) {
  assert.equal(run.code, 1)
  assert.equal(run.stderr, '')
  assert.ok(Buffer.byteLength(run.stdout, 'utf8') <= 8192)
  assert.equal(run.stdout.includes(secret), false)
  const result = JSON.parse(run.stdout)
  assert.deepEqual(Object.keys(result), fields)
  assert.equal(result.safe_error_code, 'invalid_input')
  for (const field of ['request_succeeded', 'bounded_response_received', 'utf8_valid', 'xml_parse_succeeded', 'response_root_valid', 'representation_analysis_completed']) assert.equal(result[field], false)
}

test('direct child rejects every malformed bounded stdin form before configuration or transport', async () => {
  const cases = [
    '', ' \r\n\t ', '{', '[]', 'null', '{}', '{"other":"x"}', '{"Session_Cookie":"x"}', '{"session_cookie":"x","extra":"y"}', '{"extra":"y","session_cookie":"x"}', '"text"', '{"session_cookie":7}', '{"session_cookie":true}', '{"session_cookie":null}', '{"session_cookie":{}}', '{"session_cookie":[]}', '{"session_cookie":""}', '{"session_cookie":"bad&cookie"}', '{"session_cookie":"x"}{"session_cookie":"y"}', '{"session_cookie":"x"} trailing', JSON.stringify({ session_cookie: 'x'.repeat(4097) }), ' '.repeat(8193),
  ]
  for (const input of cases) assertFailure(await execute(input))
})

test('direct child accepts bounded, ordered stdin framing before later fixed-machine trust handling', async () => {
  const maximumCookie = JSON.stringify({ session_cookie: 'a'.repeat(4096) })
  const atBound = `${JSON.stringify({ session_cookie: secret })}${' '.repeat(8192 - Buffer.byteLength(JSON.stringify({ session_cookie: secret }), 'utf8'))}`
  for (const input of [maximumCookie, atBound]) {
    const run = await execute(input)
    assert.equal(run.code, 1)
    assert.equal(run.stderr, '')
    const result = JSON.parse(run.stdout)
    assert.deepEqual(Object.keys(result), fields)
    assert.equal(result.safe_error_code, 'transport_failed')
    assert.equal(run.stdout.includes(secret), false)
  }
})

test('source keeps fixed child input and transport boundary without insecure alternate paths', async () => {
  const source = await readFile(child, 'utf8')
  assert.match(source, /Object\.keys\(value\)\.join\('\|'\) !== 'session_cookie'/)
  assert.match(source, /command: 'vPLUs'/)
  assert.match(source, /xml: PAGE1_XML/)
  assert.doesNotMatch(source, /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|http:\/\//)
})
