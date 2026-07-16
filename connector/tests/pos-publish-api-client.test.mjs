import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CANONICAL_UPC_LENGTH,
  createPosPublishApiClient,
  validateClaimResponse,
  validateReportPayload,
} from '../lib/pos-publish-api-client.mjs'

const TOKEN = 'test-connector-token-0123456789abcdef'
const JOB_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'

function claimJob(overrides = {}) {
  return {
    job_id: JOB_ID,
    operation: 'update_price',
    product_id: PRODUCT_ID,
    upc: '00012345678901',
    price: '1.00',
    attempt: 1,
    claimed_at: '2026-07-16T12:00:00.000Z',
    ...overrides,
  }
}

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } })
}

function clientWith(fetchImpl, options = {}) {
  return createPosPublishApiClient({
    baseUrl: 'http://127.0.0.1:54321',
    connectorToken: TOKEN,
    workerVersion: 'offline-test.1',
    fetchImpl,
    timeoutMs: 20,
    ...options,
  })
}

test('claim accepts a 204 response as no work', async () => {
  const client = clientWith(async () => new Response(null, { status: 204 }))
  assert.equal(await client.claim(), undefined)
})

test('HTTP accepts only literal loopback test URL forms regardless of scheme casing', () => {
  for (const url of ['http://localhost', 'HTTP://localhost:8787', 'HtTp://127.0.0.1', 'http://127.0.0.1:54321', 'http://[::1]', 'HtTp://[::1]:8787']) {
    assert.doesNotThrow(() => clientWith(globalThis.fetch, { baseUrl: url }))
  }
  for (const url of [
    'http://2130706433', 'http://0x7f000001', 'http://0177.0.0.1', 'http://127.1', 'http://localhost.example.com',
    'http://127.0.0.1.example.com', 'http://user@localhost.evil.com', 'http://%31%32%37.0.0.1', 'http://user:pass@127.0.0.1',
    'http://localhost?x=1', 'http://localhost#fragment', 'http://localhost/path', 'http://api.storepulse.example',
    'HTTP://api.storepulse.example', 'HtTp://api.storepulse.example', 'http://localhost:0', 'http://localhost:65536', 'http://localhost:not-a-port',
  ]) {
    assert.throws(() => clientWith(globalThis.fetch, { baseUrl: url }), /api_url_invalid/)
  }
  assert.doesNotThrow(() => clientWith(globalThis.fetch, { baseUrl: 'https://api.storepulse.example' }))
})

test('client uses fixed paths, no credentials, manual redirects, and fixed headers', async () => {
  let request
  const client = clientWith(async (url, options) => {
    request = { url: String(url), options }
    return jsonResponse(claimJob())
  })
  await client.claim()
  assert.equal(request.url, 'http://127.0.0.1:54321/functions/v1/claim-pos-publish-job')
  assert.equal(request.options.redirect, 'manual')
  assert.equal(request.options.credentials, 'omit')
  assert.deepEqual(request.options.headers, { 'content-type': 'application/json', 'x-storepulse-connector-token': TOKEN })
  assert.deepEqual(JSON.parse(request.options.body), { worker_version: 'offline-test.1', capabilities: ['update_price'] })
})

test('client rejects redirects and times out without echoing the token', async () => {
  const redirectClient = clientWith(async () => new Response('', { status: 302, headers: { location: 'https://elsewhere.invalid' } }))
  await assert.rejects(redirectClient.claim(), /api_request_failed/)
  const timeoutClient = clientWith((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error(TOKEN)))
  }), { timeoutMs: 1 })
  await assert.rejects(timeoutClient.claim(), (error) => error.code === 'api_timeout' && !String(error).includes(TOKEN))
})

test('response Content-Length is validated before streaming', async () => {
  const cases = [
    ['65', 'api_response_too_large'],
    ['-1', 'api_response_invalid'],
    ['invalid', 'api_response_invalid'],
  ]
  for (const [length, code] of cases) {
    const client = clientWith(async () => jsonResponse(claimJob(), { 'content-length': length }), { maxResponseBytes: 64 })
    await assert.rejects(client.claim(), (error) => error.code === code)
  }
})

test('response streaming enforces exact and overflowing byte limits', async () => {
  const exact = JSON.stringify(claimJob())
  const exactClient = clientWith(async () => jsonResponse(claimJob(), { 'content-length': String(Buffer.byteLength(exact)) }), { maxResponseBytes: Buffer.byteLength(exact) })
  assert.equal((await exactClient.claim()).job_id, JOB_ID)
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"data":"'))
      controller.enqueue(new TextEncoder().encode('x'.repeat(128)))
      controller.enqueue(new TextEncoder().encode('"}'))
      controller.close()
    },
  })
  const overflowClient = clientWith(async () => new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } }), { maxResponseBytes: 64 })
  await assert.rejects(overflowClient.claim(), /api_response_too_large/)
})

test('JSON response MIME type is required while claim 204 remains bodyless', async () => {
  for (const type of [undefined, 'text/plain', 'text/html', 'application/xml']) {
    const client = clientWith(async () => new Response(JSON.stringify(claimJob()), { status: 200, headers: type ? { 'content-type': type } : {} }))
    await assert.rejects(client.claim(), /api_response_invalid/)
  }
  const charsetClient = clientWith(async () => jsonResponse(claimJob(), { 'content-type': 'application/json; charset=utf-8' }))
  assert.equal((await charsetClient.claim()).job_id, JOB_ID)
})

test('malformed, empty, primitive, array, and secret-bearing error responses stay opaque', async () => {
  const responses = [
    new Response('', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response('secret response body', { status: 500, headers: { 'content-type': 'text/plain' } }),
  ]
  for (const response of responses) {
    const client = clientWith(async () => response.clone())
    await assert.rejects(client.claim(), (error) => error.code === 'api_response_invalid' || error.code === 'api_request_failed')
  }
})

test('claim validation requires exactly fourteen-digit UPCs and strict RFC3339 timestamps', () => {
  const polluted = JSON.parse('{"job_id":"11111111-1111-4111-8111-111111111111","operation":"update_price","product_id":"22222222-2222-4222-8222-222222222222","upc":"00012345678901","price":"1.00","attempt":1,"claimed_at":"2026-07-16T12:00:00Z","__proto__":{}}')
  assert.equal(validateClaimResponse(claimJob()).upc, '00012345678901')
  assert.equal(validateClaimResponse(claimJob({ upc: '00000000000001' })).upc, '00000000000001')
  assert.equal(validateClaimResponse(claimJob({ claimed_at: '2026-07-16T12:00:00+05:30' })).claimed_at, '2026-07-16T12:00:00+05:30')
  const invalids = [
    claimJob({ job_id: 'not-a-uuid' }), claimJob({ operation: 'delete_product' }), claimJob({ upc: 'ABC' }),
    claimJob({ upc: '1'.repeat(CANONICAL_UPC_LENGTH - 1) }), claimJob({ upc: '1'.repeat(CANONICAL_UPC_LENGTH + 1) }),
    claimJob({ upc: '1'.repeat(64) }), claimJob({ upc: '1'.repeat(65) }), claimJob({ upc: 12345678901234 }), claimJob({ upc: '00012345-678901' }),
    claimJob({ upc: ' 00012345678901' }), claimJob({ price: '1.2' }), claimJob({ price: 1 }),
    claimJob({ attempt: 0 }), claimJob({ attempt: Number.MAX_SAFE_INTEGER + 1 }), claimJob({ claimed_at: '2026-07-16' }),
    claimJob({ claimed_at: 'July 16, 2026' }), claimJob({ claimed_at: '2026-02-30T12:00:00Z' }), claimJob({ claimed_at: '2026-07-16T12:00:00' }),
    (() => { const value = claimJob(); delete value.upc; return value })(), claimJob({ extra: 'not-allowed' }), polluted,
    { ...claimJob(), constructor: {} }, { ...claimJob(), prototype: {} }, null, [], 'claim', 1,
  ]
  for (const value of invalids) assert.throws(() => validateClaimResponse(value), /api_response_invalid/)
})

test('report validation permits only strict safe payloads', () => {
  assert.deepEqual(validateReportPayload({ job_id: JOB_ID, status: 'sending' }), { job_id: JOB_ID, status: 'sending' })
  assert.deepEqual(validateReportPayload({ job_id: JOB_ID, status: 'completed', verification: { upc: '00012345678901', price: '1.00' } }), {
    job_id: JOB_ID, status: 'completed', verification: { upc: '00012345678901', price: '1.00' },
  })
  const invalids = [
    { job_id: JOB_ID, status: 'cancelled' }, { job_id: JOB_ID, status: 'completed', verification: { upc: '00012345678901', price: 1 } },
    { job_id: JOB_ID, status: 'completed', verification: { upc: '00012345678901', price: '1.2', metadata: {} } },
    { job_id: JOB_ID, status: 'failed', error_code: 'arbitrary', error_message: 'safe message' },
    { job_id: JOB_ID, status: 'failed', error_code: 'update_rejected', error_message: 'Bearer secret' },
  ]
  for (const value of invalids) assert.throws(() => validateReportPayload(value), /report_payload_invalid/)
})

test('report returns only the safe acknowledgement', async () => {
  const client = clientWith(async () => jsonResponse({ job_id: JOB_ID, status: 'sending' }))
  assert.deepEqual(await client.report({ job_id: JOB_ID, status: 'sending' }), { job_id: JOB_ID, status: 'sending' })
})
