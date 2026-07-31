import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CatalogPilotPreviewPersistenceError,
  persistCatalogPilotPreview,
} from '../lib/pos/catalog-pilot-preview-service.mjs'

const payload = Object.freeze({
  run: Object.freeze({ idempotency_key: 'pilot-request-0001' }),
  items: Object.freeze([]),
})

test('preview persistence calls the single atomic RPC and returns safe identifiers', async () => {
  let invocation = null
  const client = {
    async rpc(name, args) {
      invocation = { name, args }
      return {
        data: [{ sync_run_id: '22222222-2222-4222-8222-222222222222', created: true }],
        error: null,
      }
    },
  }

  const result = await persistCatalogPilotPreview({ client, payload })
  assert.deepEqual(invocation, {
    name: 'create_pos_catalog_pilot_preview',
    args: { p_run: payload.run, p_items: payload.items },
  })
  assert.deepEqual(result, {
    syncRunId: '22222222-2222-4222-8222-222222222222',
    created: true,
  })
})

test('preview persistence maps idempotency conflicts without leaking database errors', async () => {
  const client = {
    async rpc() {
      return { data: null, error: { message: 'catalog_pilot_idempotency_conflict' } }
    },
  }

  await assert.rejects(
    persistCatalogPilotPreview({ client, payload }),
    (error) => error instanceof CatalogPilotPreviewPersistenceError && error.code === 'idempotency_conflict',
  )
})

test('preview persistence fails closed on malformed RPC responses', async () => {
  const client = {
    async rpc() {
      return { data: [{ sync_run_id: 'not-a-uuid', created: true }], error: null }
    },
  }

  await assert.rejects(
    persistCatalogPilotPreview({ client, payload }),
    (error) => error instanceof CatalogPilotPreviewPersistenceError && error.code === 'persistence_response_invalid',
  )
})
