import {
  CONNECTOR_TOKEN_HEADER,
  authenticateConnector,
  sha256Hex,
  type ConnectorRow,
} from './connector-auth.ts'

const RAW_TOKEN = 'connector-token-that-must-never-appear-in-tests-1234567890'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}`)
}

function request(token?: string) {
  const headers = new Headers()
  if (token !== undefined) headers.set(CONNECTOR_TOKEN_HEADER, token)
  return new Request('https://example.test/functions/v1/claim-pos-publish-job', { method: 'POST', headers })
}

function fakeClient(connector: ConnectorRow | null, expectedHash: string) {
  return (() => ({
    from(table: string) {
      return {
        select() {
          const chain = {
            eq(column: string, value: unknown) {
              if (table === 'store_pos_connectors' && column === 'token_hash') assertEquals(value, expectedHash, 'connector token is SHA-256 hashed before lookup')
              return chain
            },
            async maybeSingle() {
              return { data: connector, error: null }
            },
            async single() {
              return { data: { owner_id: '55555555-5555-4555-8555-555555555555' }, error: null }
            },
          }
          return chain
        },
      }
    },
  })) as never
}

async function authenticateWith(connector: ConnectorRow | null, token?: string) {
  const logs: string[] = []
  const result = await authenticateConnector(request(token), 'auth-test', { distinguishInactive: true }, {
    getEnv: (name) => ({ SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key' })[name],
    createClient: fakeClient(connector, await sha256Hex(RAW_TOKEN)),
    logError: (value) => logs.push(String(value)),
  })
  return { result, logs }
}

const activeConnector: ConnectorRow = {
  id: '33333333-3333-4333-8333-333333333333',
  store_id: '44444444-4444-4444-8444-444444444444',
  connector_name: 'Test connector',
  source_system: 'verifone_commander',
  source_store_number: null,
  status: 'active',
  consecutive_failure_count: 0,
}

Deno.test('shared connector authentication returns 401 for a missing token', async () => {
  const { result, logs } = await authenticateWith(activeConnector)
  assert(result instanceof Response, 'missing token returns an HTTP response')
  assertEquals(result.status, 401, 'missing token status')
  assert(!logs.join('\n').includes(RAW_TOKEN), 'missing token is never logged')
})

Deno.test('shared connector authentication returns 401 for an invalid token without reflection', async () => {
  const { result, logs } = await authenticateWith(null, RAW_TOKEN)
  assert(result instanceof Response, 'invalid token returns an HTTP response')
  const body = await result.text()
  assertEquals(result.status, 401, 'invalid token status')
  assert(!body.includes(RAW_TOKEN) && !logs.join('\n').includes(RAW_TOKEN), 'raw token is absent from responses and logs')
})

Deno.test('shared connector authentication returns 403 for an inactive known connector', async () => {
  const { result, logs } = await authenticateWith({ ...activeConnector, status: 'inactive' }, RAW_TOKEN)
  assert(result instanceof Response, 'inactive connector returns an HTTP response')
  assertEquals(result.status, 403, 'inactive connector status')
  assert(!logs.join('\n').includes(RAW_TOKEN), 'inactive token is never logged')
})

Deno.test('shared connector authentication resolves an active connector after hashing its token', async () => {
  const { result, logs } = await authenticateWith(activeConnector, RAW_TOKEN)
  assert(!(result instanceof Response), 'active connector continues to the handler')
  assertEquals(result.connector.id, activeConnector.id, 'resolved connector id')
  assertEquals(result.store.owner_id, '55555555-5555-4555-8555-555555555555', 'resolved store owner')
  assert(!logs.join('\n').includes(RAW_TOKEN), 'active token is never logged')
})
