import { CONNECTOR_TOKEN_HEADER, jsonResponse, type ConnectorAuthResult, type ConnectorRow } from '../_shared/connector-auth.ts'
import { createHeartbeatHandler, defaultUpdateHeartbeat, validateHeartbeat, type HeartbeatPayload, type HeartbeatUpdateResult } from './handler.ts'

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
    service_version: '3.1.2-heartbeat3',
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
  const { handler } = testHarness({
    connector: connector({ installation_id: OTHER_INSTALLATION_ID }),
    update: async () => 'installation_mismatch',
  })
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
  await handler(request(payload({ last_error_code: 'unknown_error', last_error_message: 'old', consecutive_failure_count: 0, failed_count: 0 }), { token: 'valid-token-value-that-is-long-enough' }))
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

Deno.test('Oversized optional error text is safely truncated', async () => {
  const { handler, calls } = testHarness()
  await handler(request(payload({
    reported_state: 'error',
    commander_status: 'error',
    cloud_status: 'unknown',
    last_error_code: 'unknown_error',
    last_error_message: 'x'.repeat(1200),
    consecutive_failure_count: 1,
    failed_count: 1,
    canonical_record_count: 1,
    inserted_count: 0,
    updated_count: 0,
    unchanged_count: 0,
  }), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals(String(calls[0].updatePayload.last_error).length, 1000, 'truncated error length')
})

Deno.test('Sync completion cannot precede sync start', async () => {
  const { handler } = testHarness()
  const response = await handler(request(payload({
    last_sync_started_at: '2026-07-14T14:59:30.000Z',
    last_sync_completed_at: '2026-07-14T14:59:00.000Z',
  }), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals((await json(response)).error, 'last_sync_completed_at_before_started', 'timestamp ordering error')
})

Deno.test('Success timestamp cannot be after sync completion', async () => {
  const { handler } = testHarness()
  const response = await handler(request(payload({
    last_sync_completed_at: '2026-07-14T14:59:00.000Z',
    last_success_at: '2026-07-14T14:59:30.000Z',
  }), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals((await json(response)).error, 'last_success_at_after_completion', 'success timestamp ordering error')
})

Deno.test('Failure timestamp cannot be after sync completion', async () => {
  const { handler } = testHarness()
  const response = await handler(request(payload({
    reported_state: 'degraded',
    commander_status: 'error',
    cloud_status: 'unknown',
    last_error_code: 'unknown_error',
    last_error_message: 'failed',
    consecutive_failure_count: 1,
    last_sync_completed_at: '2026-07-14T14:59:00.000Z',
    last_success_at: null,
    last_failure_at: '2026-07-14T14:59:30.000Z',
  }), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals((await json(response)).error, 'last_failure_at_after_completion', 'failure timestamp ordering error')
})

Deno.test('Runtime start cannot be after heartbeat time', async () => {
  const { handler } = testHarness()
  const response = await handler(request(payload({
    runtime_started_at: '2026-07-14T15:00:00.000Z',
    heartbeat_at: '2026-07-14T14:59:00.000Z',
  }), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals((await json(response)).error, 'runtime_started_at_after_heartbeat', 'runtime timestamp ordering error')
})

Deno.test('Count totals cannot exceed canonical count', async () => {
  const { handler } = testHarness()
  const response = await handler(request(payload({
    canonical_record_count: 1,
    inserted_count: 1,
    updated_count: 1,
    unchanged_count: 0,
    failed_count: 0,
  }), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals((await json(response)).error, 'count_totals_exceed_canonical', 'count consistency error')
})

Deno.test('last_error_code allowlist is enforced', async () => {
  const { handler } = testHarness()
  const response = await handler(request(payload({
    reported_state: 'degraded',
    commander_status: 'error',
    cloud_status: 'unknown',
    last_error_code: 'raw_secret_stack_trace',
    last_error_message: 'failed',
    consecutive_failure_count: 1,
  }), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals((await json(response)).error, 'last_error_code_invalid', 'error code allowlist error')
})

Deno.test('runtime_mode allowlist is enforced', async () => {
  const { handler } = testHarness()
  const response = await handler(request(payload({ runtime_mode: 'DebugShell' }), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals((await json(response)).error, 'runtime_mode_invalid', 'runtime mode error')
})

Deno.test('source store number length and characters are validated', async () => {
  const { handler } = testHarness({ connector: connector({ source_store_number: null }) })
  const response = await handler(request(payload({ source_store_number: '../bad' }), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals((await json(response)).error, 'source_store_number_invalid', 'source store format error')
})

Deno.test('Database adapter exception returns 503 without details', async () => {
  const { handler } = testHarness({ update: async () => { throw new Error('internal database detail') } })
  const response = await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))
  const body = await json(response)
  assertEquals(response.status, 503, 'database exception status')
  assertEquals(body.error, 'service_unavailable', 'database exception public error')
  assertEquals(body.request_id, 'request-test', 'database exception request id')
  assert(!JSON.stringify(body).includes('internal database detail'), 'database detail hidden')
})

Deno.test('Authentication exception is handled safely', async () => {
  const handler = createHeartbeatHandler({
    now: () => NOW,
    requestId: () => 'request-test',
    authenticateConnector: async () => {
      throw new Error('raw auth failure detail')
    },
  })
  const response = await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))
  const body = await json(response)
  assertEquals(response.status, 503, 'auth exception status')
  assertEquals(body.error, 'service_unavailable', 'auth exception public error')
  assertEquals(body.request_id, 'request-test', 'auth exception request id')
  assert(!JSON.stringify(body).includes('raw auth failure detail'), 'auth detail hidden')
})

Deno.test('Response always has cache-control no-store', async () => {
  const { handler } = testHarness()
  const response = await handler(request(payload(), { token: 'valid-token-value-that-is-long-enough' }))
  assertEquals(response.headers.get('cache-control'), 'no-store', 'cache-control header')
})

type FakeConnectorRow = {
  id: string
  status: string
  installation_id: string | null
  token_hash?: string
}

type FakeTableState = {
  row: FakeConnectorRow | null
  selectedFields: string[]
  updates: Record<string, unknown>[]
  failUpdate?: boolean
}

class FakeQuery {
  private readonly filters: Record<string, unknown> = {}
  private updatePayload: Record<string, unknown> | null = null
  private selected = ''

  constructor(private readonly state: FakeTableState) {}

  update(payload: Record<string, unknown>) {
    this.updatePayload = payload
    return this
  }

  select(fields: string) {
    this.selected = fields
    this.state.selectedFields.push(fields)
    return this
  }

  eq(field: string, value: unknown) {
    this.filters[field] = value
    return this
  }

  is(field: string, value: unknown) {
    this.filters[field] = value
    return this
  }

  async maybeSingle() {
    if (this.state.failUpdate && this.updatePayload) {
      return { data: null, error: { message: 'synthetic update failure' } }
    }
    const row = this.state.row
    if (!row || !this.matches(row)) return { data: null, error: null }
    if (this.updatePayload) {
      this.state.updates.push(this.updatePayload)
      this.state.row = { ...row, ...this.updatePayload } as FakeConnectorRow
      return { data: this.project(this.state.row), error: null }
    }
    return { data: this.project(row), error: null }
  }

  private matches(row: FakeConnectorRow) {
    for (const [field, value] of Object.entries(this.filters)) {
      if ((row as unknown as Record<string, unknown>)[field] !== value) return false
    }
    return true
  }

  private project(row: FakeConnectorRow) {
    const result: Record<string, unknown> = {}
    for (const field of this.selected.split(',').map((part) => part.trim()).filter(Boolean)) {
      result[field] = (row as unknown as Record<string, unknown>)[field]
    }
    return result
  }
}

function fakeSupabase(state: FakeTableState) {
  return {
    from(name: string) {
      assertEquals(name, 'store_pos_connectors', 'fake table name')
      return new FakeQuery(state)
    },
  } as unknown as ConnectorAuthResult['supabase']
}

function fakeAuth(state: FakeTableState): ConnectorAuthResult {
  return {
    connector: connector({ id: 'connector-1', installation_id: state.row?.installation_id ?? null }),
    store: { owner_id: 'owner-1' },
    supabase: fakeSupabase(state),
  }
}

function validatedPayload(overrides: Record<string, unknown> = {}) {
  return validateHeartbeat(payload(overrides), connector(), NOW)
}

Deno.test('Default adapter binds null installation ID and returns installation_bound true', async () => {
  const state: FakeTableState = { row: { id: 'connector-1', status: 'active', installation_id: null, token_hash: 'secret' }, selectedFields: [], updates: [] }
  const result = await defaultUpdateHeartbeat(fakeAuth(state), validatedPayload(), { installation_id: INSTALLATION_ID, service_version: '3.1.2-heartbeat3' })
  assert(typeof result !== 'string', 'adapter returns success')
  assertEquals(result.installationBound, true, 'binding request is true')
  assertEquals(state.row?.installation_id, INSTALLATION_ID, 'row bound to installation')
  assert(state.selectedFields.every((fields) => !fields.includes('token_hash')), 'token_hash never selected')
})

Deno.test('Default adapter matching installation update returns installation_bound false', async () => {
  const state: FakeTableState = { row: { id: 'connector-1', status: 'active', installation_id: INSTALLATION_ID, token_hash: 'secret' }, selectedFields: [], updates: [] }
  const result = await defaultUpdateHeartbeat(fakeAuth(state), validatedPayload(), { installation_id: INSTALLATION_ID, reported_state: 'ready' })
  assert(typeof result !== 'string', 'adapter returns success')
  assertEquals(result.installationBound, false, 'matching request is false')
  assertEquals(state.row?.status, 'active', 'administrative status unchanged')
  assert(state.selectedFields.every((fields) => !fields.includes('token_hash')), 'token_hash never selected')
})

Deno.test('Default adapter mismatched installation returns installation_mismatch', async () => {
  const state: FakeTableState = { row: { id: 'connector-1', status: 'active', installation_id: OTHER_INSTALLATION_ID }, selectedFields: [], updates: [] }
  const result = await defaultUpdateHeartbeat(fakeAuth(state), validatedPayload(), { installation_id: INSTALLATION_ID })
  assertEquals(result, 'installation_mismatch', 'mismatch result')
})

Deno.test('Default adapter disabled connector cannot update', async () => {
  const state: FakeTableState = { row: { id: 'connector-1', status: 'disabled', installation_id: null }, selectedFields: [], updates: [] }
  const result = await defaultUpdateHeartbeat(fakeAuth(state), validatedPayload(), { installation_id: INSTALLATION_ID })
  assertEquals(result, 'unauthorized', 'disabled result')
  assertEquals(state.updates.length, 0, 'disabled row not updated')
})

Deno.test('Default adapter deleted connector returns not_found', async () => {
  const state: FakeTableState = { row: null, selectedFields: [], updates: [] }
  const result = await defaultUpdateHeartbeat(fakeAuth(state), validatedPayload(), { installation_id: INSTALLATION_ID })
  assertEquals(result, 'not_found', 'deleted result')
})

Deno.test('Default adapter database update error is thrown', async () => {
  const state: FakeTableState = { row: { id: 'connector-1', status: 'active', installation_id: null }, selectedFields: [], updates: [], failUpdate: true }
  let threw = false
  try {
    await defaultUpdateHeartbeat(fakeAuth(state), validatedPayload(), { installation_id: INSTALLATION_ID })
  } catch {
    threw = true
  }
  assert(threw, 'database update error thrown')
})

Deno.test('Default adapter concurrent same-ID binding has exactly one true result', async () => {
  const state: FakeTableState = { row: { id: 'connector-1', status: 'active', installation_id: null }, selectedFields: [], updates: [] }
  const results = await Promise.all([
    defaultUpdateHeartbeat(fakeAuth(state), validatedPayload(), { installation_id: INSTALLATION_ID }),
    defaultUpdateHeartbeat(fakeAuth(state), validatedPayload(), { installation_id: INSTALLATION_ID }),
  ])
  const boundCount = results.filter((result) => typeof result !== 'string' && result.installationBound).length
  const successCount = results.filter((result) => typeof result !== 'string').length
  assertEquals(successCount, 2, 'both same-ID requests succeed')
  assertEquals(boundCount, 1, 'exactly one request reports binding')
})

Deno.test('Default adapter concurrent different-ID binding cannot overwrite', async () => {
  const state: FakeTableState = { row: { id: 'connector-1', status: 'active', installation_id: null }, selectedFields: [], updates: [] }
  const firstPayload = validatedPayload({ installation_id: INSTALLATION_ID })
  const secondPayload = validatedPayload({ installation_id: OTHER_INSTALLATION_ID })
  const results = await Promise.all([
    defaultUpdateHeartbeat(fakeAuth(state), firstPayload, { installation_id: INSTALLATION_ID }),
    defaultUpdateHeartbeat(fakeAuth(state), secondPayload, { installation_id: OTHER_INSTALLATION_ID }),
  ])
  const successCount = results.filter((result) => typeof result !== 'string').length
  const mismatchCount = results.filter((result) => result === 'installation_mismatch').length
  assertEquals(successCount, 1, 'one different-ID request succeeds')
  assertEquals(mismatchCount, 1, 'one different-ID request mismatches')
  assertEquals(state.row?.installation_id, INSTALLATION_ID, 'first binding is preserved')
})
