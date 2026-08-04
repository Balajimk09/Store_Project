import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CommanderPricePublishError,
  getCommanderPriceJob,
  listCommanderPriceIdentities,
  normalizeCommanderPriceRequest,
  readBoundedCommanderPriceJson,
  requestCommanderPriceUpdate,
} from '../lib/pos/controlled-commander-price-publish.mjs'

const STORE_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const JOB_ID = '44444444-4444-4444-8444-444444444444'

function input(overrides = {}) {
  return {
    store_id: STORE_ID,
    product_id: PRODUCT_ID,
    expected_price: '0.03',
    requested_price: '0.04',
    idempotency_key: 'commander-price-20260804-0001',
    ...overrides,
  }
}

function isCode(code) {
  return (error) => error instanceof CommanderPricePublishError && error.code === code
}

test('request normalization accepts no caller-supplied Commander identity and preserves decimal strings', () => {
  assert.deepEqual(normalizeCommanderPriceRequest(input()), {
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    expectedPrice: '0.03',
    requestedPrice: '0.04',
    idempotencyKey: 'commander-price-20260804-0001',
  })
  assert.throws(() => normalizeCommanderPriceRequest(input({ upc: '00000000000017' })), isCode('invalid_request'))
  assert.throws(() => normalizeCommanderPriceRequest(input({ modifier: '000' })), isCode('invalid_request'))
  assert.throws(() => normalizeCommanderPriceRequest(input({ requested_price: '0.03' })), isCode('price_unchanged'))
  assert.throws(() => normalizeCommanderPriceRequest(input({ requested_price: '0.0' })), isCode('invalid_price'))
})

test('bounded JSON reader requires JSON MIME, strict UTF-8, and maximum body size', async () => {
  const valid = new Request('https://storepulse.example/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input()) })
  assert.deepEqual(await readBoundedCommanderPriceJson(valid), input())
  await assert.rejects(readBoundedCommanderPriceJson(new Request('https://storepulse.example/api', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })), isCode('unsupported_media_type'))
  await assert.rejects(readBoundedCommanderPriceJson(new Request('https://storepulse.example/api', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '5000' }, body: '{}' })), isCode('payload_too_large'))
  await assert.rejects(readBoundedCommanderPriceJson(new Request('https://storepulse.example/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array([0xc3, 0x28]) })), isCode('invalid_request'))
})

test('request helper calls only the generic bounded RPC and returns a normalized job', async () => {
  let call
  const client = { async rpc(name, parameters) { call = { name, parameters }; return { data: [{ job_id: JOB_ID, status: 'pending', expected_price: '0.03', requested_price: '0.04', created_at: '2026-08-04T00:00:00Z' }], error: null } } }
  assert.equal((await requestCommanderPriceUpdate({ client, userId: USER_ID, input: input() })).id, JOB_ID)
  assert.deepEqual(call, { name: 'request_commander_price_update', parameters: { p_store_id: STORE_ID, p_product_id: PRODUCT_ID, p_expected_price: '0.03', p_requested_price: '0.04', p_idempotency_key: 'commander-price-20260804-0001' } })
})

function queryResult(result, calls) {
  const query = {
    select(value) { calls.push(['select', value]); return query },
    eq(column, value) { calls.push(['eq', column, value]); return query },
    order(column) { calls.push(['order', column]); return query },
    limit(value) { calls.push(['limit', value]); return query },
    async maybeSingle() { return result },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) },
  }
  return query
}

test('identity list is owner-scoped and returns only exact 14/3 Commander mappings', async () => {
  const calls = []
  const client = { from(table) {
    calls.push(['from', table])
    return table === 'stores'
      ? queryResult({ data: { id: STORE_ID }, error: null }, calls)
      : queryResult({ data: [{ product_id: PRODUCT_ID, source_product_key: '00000000000017/000', source_upc: '00000000000017', source_modifier: '000' }], error: null }, calls)
  } }
  assert.deepEqual(await listCommanderPriceIdentities({ client, userId: USER_ID, storeId: STORE_ID }), [{ product_id: PRODUCT_ID, source_product_key: '00000000000017/000' }])
  assert.equal(JSON.stringify(calls).includes('owner_id'), true)
  assert.equal(JSON.stringify(calls).includes('source_system'), true)
})

test('status lookup verifies ownership and returns only safe job fields', async () => {
  const calls = []
  const jobRow = { id: JOB_ID, store_id: STORE_ID, product_id: PRODUCT_ID, status: 'failed', expected_price: '0.03', requested_price: '0.04', created_at: '2026-08-04T00:00:00Z', completed_at: null, failed_at: '2026-08-04T00:01:00Z', audit_metadata: { failure_code: 'price_conflict' } }
  const client = { from(table) { calls.push(['from', table]); return table === 'stores' ? queryResult({ data: { id: STORE_ID }, error: null }, calls) : queryResult({ data: jobRow, error: null }, calls) } }
  assert.equal((await getCommanderPriceJob({ client, userId: USER_ID, storeId: STORE_ID, jobId: JOB_ID })).failure_code, 'price_conflict')
  assert.deepEqual(calls.filter((entry) => entry[0] === 'from').map((entry) => entry[1]), ['stores', 'pos_publish_jobs'])
})
