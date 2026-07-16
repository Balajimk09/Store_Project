import { CONNECTOR_TOKEN_HEADER, jsonResponse, type ConnectorAuthResult } from '../_shared/connector-auth.ts'
import { createClaimPosPublishJobHandler } from './index.ts'

const JOB_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const RAW_TOKEN = 'connector-token-that-must-never-appear-in-responses-1234567890'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}`)
}

function request(body: unknown, options: { token?: string; raw?: string; contentType?: string; contentLength?: string } = {}) {
  const headers = new Headers({ 'content-type': options.contentType ?? 'application/json; charset=utf-8' })
  headers.set(CONNECTOR_TOKEN_HEADER, options.token ?? RAW_TOKEN)
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength)
  return new Request('https://example.test/functions/v1/claim-pos-publish-job', {
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

const validBody = { worker_version: '1.2.3', capabilities: ['update_price'] }

Deno.test('claim returns 401 for a missing connector token', async () => {
  const handler = createClaimPosPublishJobHandler({
    authenticateConnector: async () => jsonResponse({ error: 'unauthorized' }, 401),
  })
  const response = await handler(request(validBody, { token: '' }))
  assertEquals(response.status, 401, 'missing token status')
})

Deno.test('claim returns 401 for an invalid connector token', async () => {
  const handler = createClaimPosPublishJobHandler({
    authenticateConnector: async () => jsonResponse({ error: 'unauthorized' }, 401),
  })
  const response = await handler(request(validBody))
  assertEquals(response.status, 401, 'invalid token status')
})

Deno.test('claim returns 403 for an inactive connector', async () => {
  const handler = createClaimPosPublishJobHandler({
    authenticateConnector: async () => jsonResponse({ error: 'forbidden' }, 403),
  })
  const response = await handler(request(validBody))
  assertEquals(response.status, 403, 'inactive connector status')
})

Deno.test('claim returns 204 when no assigned pending job is available', async () => {
  const handler = createClaimPosPublishJobHandler({
    authenticateConnector: async () => fakeAuth(),
    claimJob: async () => null,
  })
  const response = await handler(request(validBody))
  assertEquals(response.status, 204, 'no job status')
  assertEquals(await response.text(), '', '204 response has no body')
})

Deno.test('claim returns only the allowlisted job shape', async () => {
  const handler = createClaimPosPublishJobHandler({
    authenticateConnector: async () => fakeAuth(),
    claimJob: async () => ({
      job_id: JOB_ID,
      operation: 'update_price',
      product_id: PRODUCT_ID,
      upc: '0123456789012',
      price: '1.25',
      attempt: 1,
      claimed_at: '2026-07-16T16:00:00.000Z',
      payload: { price: '1.25', token: RAW_TOKEN },
      token_hash: RAW_TOKEN,
      owner_id: 'secret-owner-id',
    } as never),
  })
  const response = await handler(request(validBody))
  const text = await response.text()
  const body = JSON.parse(text) as Record<string, unknown>
  assertEquals(response.status, 200, 'claim status')
  assertEquals(Object.keys(body).sort().join(','), 'attempt,claimed_at,job_id,operation,price,product_id,upc', 'safe response keys')
  assert(!text.includes(RAW_TOKEN), 'raw token is omitted')
  assert(!text.includes('payload'), 'payload is omitted')
  assert(!text.includes('owner_id'), 'owner id is omitted')
})

Deno.test('claim rejects worker identity and arbitrary capability fields', async () => {
  const handler = createClaimPosPublishJobHandler({ authenticateConnector: async () => fakeAuth() })
  const response = await handler(request({ ...validBody, connector_id: JOB_ID }))
  assertEquals(response.status, 400, 'untrusted connector id rejected')
})

Deno.test('claim rejects malformed, empty, and unsupported request bodies safely', async () => {
  const handler = createClaimPosPublishJobHandler({ authenticateConnector: async () => fakeAuth() })
  const malformed = await handler(request(validBody, { raw: '{not-json' }))
  const empty = await handler(request(validBody, { raw: '' }))
  const unsupported = await handler(request(validBody, { contentType: 'text/plain' }))
  assertEquals(malformed.status, 400, 'malformed JSON status')
  assertEquals(await malformed.text(), JSON.stringify({ error: 'invalid_json' }), 'malformed JSON safe error')
  assertEquals(empty.status, 400, 'empty JSON status')
  assertEquals(unsupported.status, 415, 'unsupported content type status')
})

Deno.test('claim enforces declared and streamed body limits before parsing', async () => {
  const handler = createClaimPosPublishJobHandler({ authenticateConnector: async () => fakeAuth() })
  const declaredTooLarge = await handler(request(validBody, { contentLength: '8193' }))
  const streamedTooLarge = await handler(request(validBody, { raw: `{"padding":"${'x'.repeat(8192)}"}` }))
  assertEquals(declaredTooLarge.status, 413, 'declared oversized body status')
  assertEquals(streamedTooLarge.status, 413, 'streamed oversized body status')
})
