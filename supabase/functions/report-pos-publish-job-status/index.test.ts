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

Deno.test('create reports require flags and preserve the create operation through each status', async () => {
  const received: Array<{ operation?: string; status: string }> = []
  const tested = handler(async (_auth, payload) => {
    received.push(payload as { operation?: string; status: string })
    return { job_id: JOB_ID, status: (payload as { status: string }).status }
  })
  const verification = {
    upc: '00012345678901', modifier: '000', description: 'New product', department: '1', price: '1.25',
    payment_product_code: '0', selling_unit: '1.000', maximum_quantity_per_transaction: '0.00', taxable_rebate: '0.00',
    tax_rate_ids: ['2'], id_check_ids: ['1'], flag_ids: ['1', '5'],
  }
  assertEquals((await tested(request({ job_id: JOB_ID, operation: 'create_product', status: 'sending' }))).status, 200, 'create sending accepted')
  assertEquals((await tested(request({ job_id: JOB_ID, operation: 'create_product', status: 'verifying' }))).status, 200, 'create verifying accepted')
  assertEquals((await tested(request({ job_id: JOB_ID, operation: 'create_product', status: 'completed', verification }))).status, 200, 'create completed accepted')
  assertEquals((await tested(request({ job_id: JOB_ID, operation: 'create_product', status: 'failed', error_code: 'update_rejected', error_message: 'Commander rejected the create.' }))).status, 200, 'create failed accepted')
  assertEquals((await tested(request({ job_id: JOB_ID, operation: 'create_product', status: 'completed', verification: { ...verification, flag_ids: undefined } }))).status, 400, 'create completed requires flag ids')
  assertEquals(received.map(payload => `${payload.operation}:${payload.status}`).join(','), 'create_product:sending,create_product:verifying,create_product:completed,create_product:failed', 'create operation survives validation')
})

Deno.test('default report dispatch routes every create state to its create RPC and preserves legacy reports', async () => {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = []
  const auth = {
    ...fakeAuth(),
    supabase: {
      rpc: async (name: string, parameters: Record<string, unknown>) => {
        calls.push({ name, parameters })
        return { data: [{ job_id: JOB_ID, status: parameters.p_status }], error: null }
      },
    },
  } as unknown as ConnectorAuthResult
  const tested = createReportPosPublishJobStatusHandler({ authenticateConnector: async () => auth })
  const verification = {
    upc: '00012345678901', modifier: '000', description: 'New product', department: '1', price: '1.25',
    payment_product_code: '0', selling_unit: '1.000', maximum_quantity_per_transaction: '0.00', taxable_rebate: '0.00',
    tax_rate_ids: ['2'], id_check_ids: ['1'], flag_ids: ['1', '5'],
  }
  for (const body of [
    { job_id: JOB_ID, operation: 'create_product', status: 'sending' },
    { job_id: JOB_ID, operation: 'create_product', status: 'verifying' },
    { job_id: JOB_ID, operation: 'create_product', status: 'completed', verification },
    { job_id: JOB_ID, operation: 'create_product', status: 'failed', error_code: 'update_rejected', error_message: 'Commander rejected the create.' },
  ]) {
    assertEquals((await tested(request(body))).status, 200, `create ${body.status} dispatches`)
  }
  assertEquals((await tested(request({ job_id: JOB_ID, status: 'sending' }))).status, 200, 'legacy report dispatches')
  assertEquals(calls.slice(0, 4).every(call => call.name === 'report_commander_product_create_status'), true, 'all create reports use the create RPC')
  assertEquals(calls[2].parameters.p_verification_flag_ids instanceof Array, true, 'create verification forwards flag ids')
  assertEquals(calls[4].name, 'report_pos_publish_job_status', 'legacy report uses the existing RPC')
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
  const wrongUpc = await tested(request({ job_id: JOB_ID, status: 'completed', verification: { upc: 'not-digits', modifier: '000', price: '1.25' } }))
  const wrongPrice = await tested(request({ job_id: JOB_ID, status: 'completed', verification: { upc: '00012345678901', modifier: '000', price: '1.2' } }))
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
  const pendingCompleted = await invalidTransition(request({ job_id: JOB_ID, status: 'completed', verification: { upc: '00012345678901', modifier: '000', price: '1.25' } }))
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
