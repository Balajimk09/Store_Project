import { CONNECTOR_TOKEN_HEADER, jsonResponse, type ConnectorAuthResult } from '../_shared/connector-auth.ts'
import { createReportPosPublishJobStatusHandler } from './index.ts'

const JOB_ID = '11111111-1111-4111-8111-111111111111'
const RAW_TOKEN = 'connector-token-that-must-never-appear-in-responses-1234567890'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}`)
}

function request(body: unknown, options: { token?: string; raw?: string; contentType?: string; contentLength?: string } = {}) {
  const headers = new Headers({ 'content-type': options.contentType ?? 'application/json' })
  headers.set(CONNECTOR_TOKEN_HEADER, options.token ?? RAW_TOKEN)
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength)
  return new Request('https://example.test/functions/v1/report-pos-publish-job-status', {
    method: 'POST',
    headers,
    body: options.raw ?? JSON.stringify(body),
  })
}

function fakeAuth(): ConnectorAuthResult {
  return {
    supabase: {} as ConnectorAuthResult['supabase'],
    connector: {
      id: '33333333-3333-4333-8333-333333333333',
      store_id: '44444444-4444-4444-8444-444444444444',
      connector_name: 'Synthetic connector',
      source_system: 'verifone_commander',
      source_store_number: null,
      status: 'active',
      consecutive_failure_count: 0,
    },
    store: { owner_id: '55555555-5555-4555-8555-555555555555' },
  }
}

function handler(reportStatus?: (auth: ConnectorAuthResult, payload: unknown) => Promise<{ job_id: string; status: string }>) {
  return createReportPosPublishJobStatusHandler({
    authenticateConnector: async () => fakeAuth(),
    reportStatus: reportStatus as never,
  })
}

Deno.test('report accepts sending and verifying transitions', async () => {
  const calls: string[] = []
  const tested = handler(async (_auth, payload) => {
    calls.push((payload as { status: string }).status)
    return { job_id: JOB_ID, status: (payload as { status: string }).status }
  })
  assertEquals((await tested(request({ job_id: JOB_ID, status: 'sending' }))).status, 200, 'sending status')
  assertEquals((await tested(request({ job_id: JOB_ID, status: 'verifying' }))).status, 200, 'verifying status')
  assertEquals(calls.join(','), 'sending,verifying', 'transitions passed to RPC adapter')
})

Deno.test('completed reports require an exact verification object', async () => {
  const tested = handler(async (_auth, payload) => ({ job_id: JOB_ID, status: (payload as { status: string }).status }))
  const response = await tested(request({ job_id: JOB_ID, status: 'completed' }))
  assertEquals(response.status, 400, 'missing verification rejected')
})

Deno.test('wrong verification UPC and non-two-decimal price are rejected by the guarded RPC result', async () => {
  const tested = handler(async () => {
    const error = new Error('verification mismatch') as Error & { code: string }
    error.code = '23514'
    throw error
  })
  const wrongUpc = await tested(request({ job_id: JOB_ID, status: 'completed', verification: { upc: 'not-digits', price: '1.25' } }))
  const wrongPrice = await tested(request({ job_id: JOB_ID, status: 'completed', verification: { upc: '0123456789012', price: '1.2' } }))
  assertEquals(wrongUpc.status, 400, 'wrong UPC rejected before RPC')
  assertEquals(wrongPrice.status, 400, 'wrong price rejected before RPC')
})

Deno.test('report accepts only allowlisted failed error codes', async () => {
  const tested = handler(async (_auth, payload) => ({ job_id: JOB_ID, status: (payload as { status: string }).status }))
  const accepted = await tested(request({ job_id: JOB_ID, status: 'failed', error_code: 'update_rejected', error_message: 'Commander rejected the update.' }))
  const rejected = await tested(request({ job_id: JOB_ID, status: 'failed', error_code: 'anything_else', error_message: 'Nope' }))
  assertEquals(accepted.status, 200, 'allowlisted failure accepted')
  assertEquals(rejected.status, 400, 'unknown failure rejected')
})

Deno.test('report rejects sensitive failure messages, dumps, controls, URLs, and XML', async () => {
  const tested = handler(async (_auth, payload) => ({ job_id: JOB_ID, status: (payload as { status: string }).status }))
  for (const message of [
    'Authorization: Bearer secret',
    'service-role credential failure',
    'service-role value',
    'token=secret',
    'cookie=secret',
    'password=secret',
    'stack trace: details',
    'request headers: details',
    'response dump: details',
    'https://unsafe.test',
    '<xml>dump</xml>',
    'bad\nmessage',
  ]) {
    const response = await tested(request({ job_id: JOB_ID, status: 'failed', error_code: 'internal_connector_error', error_message: message }))
    assertEquals(response.status, 400, `unsafe message rejected: ${message}`)
  }
})

Deno.test('report prevents other connectors and terminal or pending completion transitions', async () => {
  const tested = handler(async () => {
    const error = new Error('forbidden') as Error & { code: string }
    error.code = '42501'
    throw error
  })
  const otherConnector = await tested(request({ job_id: JOB_ID, status: 'sending' }))
  assertEquals(otherConnector.status, 403, 'other connector forbidden')

  const invalidTransition = handler(async () => {
    const error = new Error('invalid transition') as Error & { code: string }
    error.code = '23514'
    throw error
  })
  const pendingCompleted = await invalidTransition(request({ job_id: JOB_ID, status: 'completed', verification: { upc: '0123456789012', price: '1.25' } }))
  assertEquals(pendingCompleted.status, 400, 'pending to completed rejected')
})

Deno.test('report response never includes connector tokens or service-only data', async () => {
  const tested = handler(async (_auth, payload) => ({
    job_id: JOB_ID,
    status: (payload as { status: string }).status,
    token_hash: RAW_TOKEN,
    service_role_key: RAW_TOKEN,
  } as never))
  const response = await tested(request({ job_id: JOB_ID, status: 'sending' }))
  const text = await response.text()
  assertEquals(response.status, 200, 'report success')
  assert(!text.includes(RAW_TOKEN), 'secret values omitted')
  assertEquals(text, JSON.stringify({ job_id: JOB_ID, status: 'sending' }), 'minimal safe response')
})

Deno.test('report returns authentication status without reflecting the raw connector token', async () => {
  const tested = createReportPosPublishJobStatusHandler({
    authenticateConnector: async () => jsonResponse({ error: 'unauthorized' }, 401),
  })
  const response = await tested(request({ job_id: JOB_ID, status: 'sending' }))
  const text = await response.text()
  assertEquals(response.status, 401, 'invalid token status')
  assert(!text.includes(RAW_TOKEN), 'raw token is not reflected')
})

Deno.test('report rejects malformed, empty, unsupported, and oversized request bodies', async () => {
  const tested = handler(async (_auth, payload) => ({ job_id: JOB_ID, status: (payload as { status: string }).status }))
  const malformed = await tested(request({ job_id: JOB_ID, status: 'sending' }, { raw: '{bad' }))
  const empty = await tested(request({ job_id: JOB_ID, status: 'sending' }, { raw: '' }))
  const unsupported = await tested(request({ job_id: JOB_ID, status: 'sending' }, { contentType: 'text/plain' }))
  const declaredTooLarge = await tested(request({ job_id: JOB_ID, status: 'sending' }, { contentLength: '8193' }))
  const streamedTooLarge = await tested(request({ job_id: JOB_ID, status: 'sending' }, { raw: `{"padding":"${'x'.repeat(8192)}"}` }))
  assertEquals(malformed.status, 400, 'malformed JSON rejected')
  assertEquals(empty.status, 400, 'empty JSON rejected')
  assertEquals(unsupported.status, 415, 'unsupported content type rejected')
  assertEquals(declaredTooLarge.status, 413, 'declared oversized body rejected')
  assertEquals(streamedTooLarge.status, 413, 'streamed oversized body rejected')
})
