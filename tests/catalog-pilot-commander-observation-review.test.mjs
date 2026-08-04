import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CommanderObservationReviewError,
  listCommanderObservationReview,
  normalizeCommanderObservation,
} from '../lib/pos/catalog-pilot-commander-observations.mjs'

const STORE_ID = 'ec192877-0156-42ab-8fbf-31105f3e2ea3'
const OTHER_STORE_ID = 'a6f3c2d1-7ea7-4e9a-a75e-51fd2649628c'
const USER_ID = 'c702332a-9299-4b1a-9583-a01302bd7b4a'

function row({ upc = '00000000000017', modifier = '000', observedAt = '2026-08-03T12:00:00.000Z' } = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    source_product_key: `${upc}/${modifier}`,
    source_upc: upc,
    source_modifier: modifier,
    source_description: 'Commander item',
    source_price: '2.5',
    source_department: '10',
    observation_status: 'observed',
    observed_at: observedAt,
    updated_at: observedAt,
    owner_id: USER_ID,
    last_snapshot_hash: 'a'.repeat(64),
  }
}

function fakeClient({ store = { id: STORE_ID }, observations = [row()], storeError = null, observationsError = null } = {}) {
  const calls = []
  const client = {
    calls,
    from(table) {
      calls.push(['from', table])
      if (table === 'stores') {
        const filters = []
        return {
          select(columns) {
            calls.push(['select', table, columns])
            return {
              eq(column, value) {
                filters.push([column, value])
                calls.push(['eq', table, column, value])
                return this
              },
              async maybeSingle() {
                return { data: store, error: storeError, filters }
              },
            }
          },
        }
      }

      if (table === 'pos_catalog_source_observations') {
        const filters = []
        return {
          select(columns) {
            calls.push(['select', table, columns])
            return {
              eq(column, value) {
                filters.push([column, value])
                calls.push(['eq', table, column, value])
                return this
              },
              order(column, options) {
                calls.push(['order', table, column, options])
                return this
              },
              async limit(value) {
                calls.push(['limit', table, value])
                return { data: observations, error: observationsError, filters }
              },
            }
          },
        }
      }

      throw new Error(`unexpected_table:${table}`)
    },
  }
  return client
}

test('authorized store receives only bounded Commander observations in deterministic query order', async () => {
  const client = fakeClient({ observations: [
    row({ upc: '00000000000024', observedAt: '2026-08-03T11:00:00.000Z' }),
    row({ upc: '00000000000017', observedAt: '2026-08-03T12:00:00.000Z' }),
  ] })

  const observations = await listCommanderObservationReview({ client, userId: USER_ID, storeId: STORE_ID })

  assert.equal(observations.length, 2)
  assert.deepEqual(Object.keys(observations[0]), [
    'id', 'source_product_key', 'upc', 'modifier', 'description', 'price', 'department', 'status', 'observed_at', 'updated_at',
  ])
  assert.equal(observations[0].upc, '00000000000024')
  assert.equal(observations[0].modifier, '000')
  assert.equal(observations[0].price, '2.50')
  assert.equal('owner_id' in observations[0], false)
  assert.equal('last_snapshot_hash' in observations[0], false)
  assert.deepEqual(
    client.calls.filter((call) => call[0] === 'eq' && call[1] === 'pos_catalog_source_observations'),
    [
      ['eq', 'pos_catalog_source_observations', 'store_id', STORE_ID],
      ['eq', 'pos_catalog_source_observations', 'source_system', 'commander'],
    ],
  )
  assert.deepEqual(
    client.calls.filter((call) => call[0] === 'order'),
    [
      ['order', 'pos_catalog_source_observations', 'observed_at', { ascending: false }],
      ['order', 'pos_catalog_source_observations', 'source_product_key', { ascending: true }],
    ],
  )
  assert.deepEqual(client.calls.filter((call) => call[0] === 'limit'), [['limit', 'pos_catalog_source_observations', 100]])
  assert.equal(client.calls.some((call) => /insert|update|upsert|delete|rpc/i.test(call[0])), false)
})

test('another store cannot reach Commander observations and an empty result remains valid', async () => {
  const deniedClient = fakeClient({ store: null })
  await assert.rejects(
    () => listCommanderObservationReview({ client: deniedClient, userId: USER_ID, storeId: OTHER_STORE_ID }),
    (error) => error instanceof CommanderObservationReviewError && error.code === 'forbidden',
  )
  assert.deepEqual(deniedClient.calls.map((call) => call.slice(0, 2)), [
    ['from', 'stores'], ['select', 'stores'], ['eq', 'stores'], ['eq', 'stores'],
  ])

  const emptyClient = fakeClient({ observations: [] })
  assert.deepEqual(await listCommanderObservationReview({ client: emptyClient, userId: USER_ID, storeId: STORE_ID }), [])
})

test('invalid store input, database failures, and malformed database rows fail closed', async () => {
  await assert.rejects(
    () => listCommanderObservationReview({ client: fakeClient(), userId: USER_ID, storeId: 'caller-controlled' }),
    (error) => error instanceof CommanderObservationReviewError && error.code === 'invalid_store',
  )
  await assert.rejects(
    () => listCommanderObservationReview({ client: fakeClient({ observationsError: { message: 'hidden' } }), userId: USER_ID, storeId: STORE_ID }),
    (error) => error instanceof CommanderObservationReviewError && error.code === 'observations_unavailable',
  )
  assert.throws(
    () => normalizeCommanderObservation({ ...row(), source_upc: 17 }),
    (error) => error instanceof CommanderObservationReviewError && error.code === 'observations_unavailable',
  )
})
