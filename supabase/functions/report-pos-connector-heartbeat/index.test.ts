import { CONNECTOR_TOKEN_HEADER, jsonResponse, type ConnectorAuthResult, type ConnectorRow } from '../_shared/connector-auth.ts'
import { createHeartbeatHandler, type HeartbeatPayload, type HeartbeatUpdateResult } from './handler.ts'

type UpdateCall = {
  auth: ConnectorAuthResult
  payload: HeartbeatPayload
  updatePayload: Record<string, unknown>
}

const NOW = new Date('2026-07-14T15:00:00.000Z')
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_INSTALLATION_ID = '22222222-2222-4222-8222-222222222222'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}`)
}

function connector(overrides: Partial<ConnectorRow> = {}): ConnectorRow {
  return {
    id: 'connector-1',
    store_id: 'store-1',
    connector_name: 'Synthetic connector',
    source_system: 'verifone_commander',
    source_store_number: 'SYNTH',
    status: 'active',
    consecutive_failure_count: 0,
    installation_id: null,
    ...overrides,
  }
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    payload_version: '1',
    installation_id: INSTALLATION_ID,
    source_store_number: 'SYNTH',
    service_version: '3.1.1-heartbeat2',
    runtime_mode: 'Run',
    reported_state: 'ready',
    runtime_started_at: '2026-07-14T14:00:00.000Z',
    heartbeat_at: '2026-07-14T14:59:58.000Z',
    last_sync_started_at: '2026-07-14T14:59:00.000Z',
    last_sync_completed_at: '2026-07-14T14:59:30.000Z',
    last_success_at: '2026-07-14T14:59:30.000Z',
    last_failure_at: null,
    last_error_code: null,
    last_error_message: null,
    consecutive_failure_count: 0,
    commander_status: 'connected',
    cloud_status: 'connected',
    live_poll_interval_seconds: 120,
    canonical_record_count: 352,
    inserted_count: 3,
    updated_count: 0,
    unchanged_count: 349,
    failed_count: 0,
    last_request_id: 'live-request',
    ...overrides,
  }
}

function request(body: unknown, options: { method?: string; token?: string; raw?: string; contentLength?: string } = {}) {
  const headers = new Headers()
  if (options.token !== undefined) headers.set(CONNECTOR_TOKEN_HEADER, options.token)
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength)
  const method = options.method ?? 'POST'
  const rawBody = options.raw ?? JSON.stringify(body)
  return new Request('https://example.test/functions/v1/report-pos-connector-heartbeat', {
    method,
    headers,
    body: method === 'GET' || method === 'OPTIONS' ? undefined : rawBody,
  })
}

function testHarness(options: {
  connector?: ConnectorRow
  authResponse?: Response
  update?: (call: UpdateCall) => Promise<HeartbeatUpdateResult | 'installation_mismatch' | 'unauthorized' | 'not_found'>
} = {}) {
  const calls: UpdateCall[] = []
  const authConnector = options.connector ?? connector()
  const auth: ConnectorAuthResult = {
    connector: authConnector,
    store: { owner_id: 'owner-1' },
    supabase: {} as ConnectorAuthResult['supabase'],
  }
  const handler = createHeartbeatHandler({
    now: () => NOW,
    requestId: () => 'request-test',
    authenticateConnector: async (req) => {
      if (options.authResponse) return options.authResponse
      if (!req.headers.get(CONNECTOR_TOKEN_HEADER)) return jsonResponse({ error: 'unauthorized', request_id: 'request-test' }, 401)
      if (req.headers.get(CONNECTOR_TOKEN_HEADER) === 'invalid-token') return jsonResponse({ error: 'unauthorized', request_id: 'request-test' }, 401)
      return auth
    },
    updateHeartbeat: async (authValue, heartbeatPayload, updatePayload) => {
      const call = { auth: authValue, payload: heartbeatPayload, updatePayload }
      calls.push(call)
      if (options.update) return await options.update(call)
      return {
        connector: {
          id: authConnector.id,
          status: 'active',
          installation_id: heartbeatPayload.installationId,
        },
        installationBound: !authConnector.installation_id,
      }
    },
  })
  return { handler, calls }
}

async function json(response: Response) {
  return await response.json() as Record<string, unknown>
}

Deno.test('OPTIONS accepted', async () => {
  const { handler } = testHarness()
  const response = await handler(request(null, { method: 'OPTIONS' }))
  assertEquals(response.status, 204, 'OPTIONS status')
})

Deno.test('Non-POST rejected', async () => {
  const { handler } = testHarness()
  const response = await handler(request(null, { method: 'GET' }))
  assertEquals(response.status, 405, 'GET status')
})

Deno.test('Oversized body rejected', async () => {
  const { handler } = testHarness()
  const response = await handler(request({}, { token: 'valid-token-value-that-is-long-enough', contentLength: String(65 * 1024) }))
  assertEquals(response.status, 413, 'oversized status')
})

Deno.test('Invalid JSON rejected', async () => {
  const { handler } = testHarness()
  const response = await handler(request(null, { token: 'valid-token-value-that-is-long-enough', raw: '{' }))
  assertEquals(response.status, 400, 'invalid JSON status')
})

Deno.test('Unknown top-level field rejected', async () => {
  const { handler } = testHarness()
  const response = await handler(request(payload({ surprise: true }), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals((await json(response)).error, 'unknown_field', 'unknown field error')
})

Deno.test('Missing token returns 401', async () => {
  const { handler } = testHarness()
  assertEquals((await handler(request(payload()))).status, 401, 'missing token status')
})

Deno.test('Invalid token returns 401', async () => {
  const { handler } = testHarness()
  assertEquals((await handler(request(payload(), { token: 'invalid-token' }))).status, 401, 'invalid token status')
})

Deno.test('Disabled connector returns 401', async () => {
  const { handler } = testHarness({ authResponse: jsonResponse({ error: 'unauthorized', request_id: 'request-test' }, 401) })
  assertEquals((await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))).status, 401, 'disabled token status')
})

Deno.test('Unsupported source system rejected', async () => {
  const { handler } = testHarness({ connector: connector({ source_system: 'other_pos' }) })
  assertEquals((await json(await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' })))).error, 'connector_misconfigured', 'source system error')
})

Deno.test('Source-store mismatch returns 409', async () => {
  const { handler } = testHarness()
  const response = await handler(request(payload({ source_store_number: 'OTHER' }), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals(response.status, 409, 'source store mismatch status')
})

Deno.test('Invalid payload version rejected', async () => {
  const { handler } = testHarness()
  assertEquals((await json(await handler(request(payload({ payload_version: '2' }), { token: 'valid-token-value-that-is-long-enough' })))).error, 'payload_version_unsupported', 'payload version')
})

Deno.test('Invalid UUID rejected', async () => {
  const { handler } = testHarness()
  assertEquals((await json(await handler(request(payload({ installation_id: 'not-a-uuid' }), { token: 'valid-token-value-that-is-long-enough' })))).error, 'installation_id_invalid', 'uuid error')
})

Deno.test('Invalid timestamp rejected', async () => {
  const { handler } = testHarness()
  assertEquals((await json(await handler(request(payload({ heartbeat_at: 'not-a-date' }), { token: 'valid-token-value-that-is-long-enough' })))).error, 'heartbeat_at_invalid', 'timestamp error')
})

Deno.test('Future timestamp rejected', async () => {
  const { handler } = testHarness()
  assertEquals((await json(await handler(request(payload({ heartbeat_at: '2026-07-14T15:30:00.000Z' }), { token: 'valid-token-value-that-is-long-enough' })))).error, 'heartbeat_at_future', 'future timestamp error')
})

Deno.test('Invalid state rejected', async () => {
  const { handler } = testHarness()
  assertEquals((await json(await handler(request(payload({ reported_state: 'offline' }), { token: 'valid-token-value-that-is-long-enough' })))).error, 'reported_state_invalid', 'state error')
})

Deno.test('Invalid Commander state rejected', async () => {
  const { handler } = testHarness()
  assertEquals((await json(await handler(request(payload({ commander_status: 'bad' }), { token: 'valid-token-value-that-is-long-enough' })))).error, 'commander_status_invalid', 'commander state error')
})

Deno.test('Invalid cloud state rejected', async () => {
  const { handler } = testHarness()
  assertEquals((await json(await handler(request(payload({ cloud_status: 'bad' }), { token: 'valid-token-value-that-is-long-enough' })))).error, 'cloud_status_invalid', 'cloud state error')
})

Deno.test('Negative count rejected', async () => {
  const { handler } = testHarness()
  assertEquals((await json(await handler(request(payload({ failed_count: -1 }), { token: 'valid-token-value-that-is-long-enough' })))).error, 'failed_count_invalid', 'count error')
})

Deno.test('Invalid poll interval rejected', async () => {
  const { handler } = testHarness()
  assertEquals((await json(await handler(request(payload({ live_poll_interval_seconds: 0 }), { token: 'valid-token-value-that-is-long-enough' })))).error, 'live_poll_interval_seconds_invalid', 'poll error')
})

Deno.test('First heartbeat binds installation ID', async () => {
  const { handler } = testHarness()
  const body = await json(await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' })))
  assertEquals(body.installation_bound, true, 'installation bound')
})

Deno.test('Matching installation ID succeeds', async () => {
  const { handler } = testHarness({ connector: connector({ installation_id: INSTALLATION_ID }) })
  const body = await json(await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' })))
  assertEquals(body.installation_bound, false, 'matching not newly bound')
})

Deno.test('Different installation ID returns 409', async () => {
  const { handler } = testHarness({ connector: connector({ installation_id: OTHER_INSTALLATION_ID }) })
  const response = await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals(response.status, 409, 'different installation status')
})

Deno.test('Concurrent same-ID binding remains idempotent', async () => {
  const { handler } = testHarness({
    update: async (call) => ({
      connector: { id: call.auth.connector.id, status: 'active', installation_id: call.payload.installationId },
      installationBound: false,
    }),
  })
  assertEquals((await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))).status, 200, 'same-id concurrent status')
})

Deno.test('Concurrent different-ID binding cannot overwrite', async () => {
  const { handler } = testHarness({ update: async () => 'installation_mismatch' })
  const response = await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals(response.status, 409, 'different concurrent status')
})

Deno.test('Connector disabled between authentication and update does not return success', async () => {
  const { handler } = testHarness({ update: async () => 'unauthorized' })
  assertEquals((await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))).status, 401, 'disabled during update status')
})

Deno.test('Zero-row update does not return success', async () => {
  const { handler } = testHarness({ update: async () => 'not_found' })
  assertEquals((await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))).status, 409, 'zero-row update status')
})

Deno.test('Valid update changes only approved fields', async () => {
  const { handler, calls } = testHarness()
  await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))
  assert(calls.length === 1, 'one update call')
  assert(!('token_hash' in calls[0].updatePayload), 'token_hash not updated')
  assert(!('status' in calls[0].updatePayload), 'administrative status not updated')
})

Deno.test('Administrative status remains unchanged', async () => {
  const { handler, calls } = testHarness()
  await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))
  assert(!('status' in calls[0].updatePayload), 'status absent from update')
})

Deno.test('token_hash remains unchanged and is never returned', async () => {
  const { handler, calls } = testHarness()
  const body = await json(await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' })))
  assert(!('token_hash' in body), 'token_hash absent response')
  assert(!('token_hash' in calls[0].updatePayload), 'token_hash absent update')
})

Deno.test('Server time is stored in last_heartbeat_at', async () => {
  const { handler, calls } = testHarness()
  await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals(calls[0].updatePayload.last_heartbeat_at, NOW.toISOString(), 'server heartbeat time')
})

Deno.test('Payload heartbeat time is stored in reported_heartbeat_at', async () => {
  const { handler, calls } = testHarness()
  await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals(calls[0].updatePayload.reported_heartbeat_at, '2026-07-14T14:59:58.000Z', 'reported heartbeat time')
})

Deno.test('Response excludes token and secrets', async () => {
  const { handler } = testHarness()
  const text = await (await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))).text()
  assert(!text.includes('valid-token-value-that-is-long-enough'), 'response token redacted')
})

Deno.test('Ready state clears old safe errors when counts show success', async () => {
  const { handler, calls } = testHarness()
  await handler(request(payload({ last_error_code: 'old', last_error_message: 'old', consecutive_failure_count: 0, failed_count: 0 }), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals(calls[0].updatePayload.last_error, null, 'ready clears error')
  assertEquals(calls[0].updatePayload.last_error_code, null, 'ready clears code')
})

Deno.test('Degraded/error state preserves safe error information', async () => {
  const { handler, calls } = testHarness()
  await handler(request(payload({ reported_state: 'degraded', commander_status: 'error', cloud_status: 'unknown', last_error_code: 'commander_response_invalid', last_error_message: 'bad response', consecutive_failure_count: 1 }), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals(calls[0].updatePayload.last_error_code, 'commander_response_invalid', 'degraded preserves code')
  assertEquals(calls[0].updatePayload.last_error, 'bad response', 'degraded preserves message')
})

Deno.test('Installation mismatch never leaks the currently bound installation ID', async () => {
  const { handler } = testHarness({ update: async () => 'installation_mismatch' })
  const text = await (await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))).text()
  assert(!text.includes(OTHER_INSTALLATION_ID), 'mismatch hides bound installation ID')
  assert(text.includes('installation_mismatch'), 'mismatch reports safe code')
})
