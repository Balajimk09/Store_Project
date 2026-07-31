import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CatalogPilotPreviewInputError,
  buildCatalogPilotPreviewPayload,
} from '../lib/pos/catalog-pilot-preview-input.mjs'

const connector = {
  id: '11111111-1111-4111-8111-111111111111',
  storeId: 'ec192877-0156-42ab-8fbf-31105f3e2ea3',
  sourceSystem: 'verifone_commander',
  sourceStoreNumber: 'AB123',
}

function product(overrides = {}) {
  return {
    sourceSystem: 'verifone_commander',
    sourceStoreNumber: 'AB123',
    sourceProductKey: 'upc:00999999999993|modifier:000',
    upc: '00999999999993',
    modifier: '000',
    description: 'STOREPULSE TEST',
    retailPrice: 0.02,
    cost: null,
    departmentNumber: '1',
    departmentName: null,
    categoryNumber: null,
    categoryName: null,
    taxNumber: '1',
    taxName: null,
    ageRestriction: null,
    active: true,
    payloadHash: 'a'.repeat(64),
    ...overrides,
  }
}

function body(overrides = {}) {
  return {
    schemaVersion: '1',
    mode: 'selected_products',
    sourceSystem: 'verifone_commander',
    sourceStoreNumber: 'AB123',
    capturedAt: '2026-07-31T02:30:00.000Z',
    selectedProducts: [{ upc: '00999999999993', modifier: '000' }],
    products: [product()],
    ...overrides,
  }
}

function build(value = body(), idempotencyKey = 'pilot-request-0001') {
  return buildCatalogPilotPreviewPayload({
    body: value,
    connector,
    ownerId: 'c702332a-9299-4b1a-9583-a01302bd7b4a',
    idempotencyKey,
  })
}

function hasCode(code) {
  return (error) => error instanceof CatalogPilotPreviewInputError && error.code === code
}

test('preview request becomes an idempotent preview-only RPC payload', () => {
  const payload = build()
  assert.equal(payload.run.import_mode, 'selected_products')
  assert.equal(payload.run.catalog_complete, false)
  assert.equal(payload.run.status, 'previewed')
  assert.equal(payload.run.idempotency_key, 'pilot-request-0001')
  assert.match(payload.run.request_fingerprint, /^[0-9a-f]{64}$/)
  assert.equal(payload.run.metadata.preview_only, true)
  assert.equal(payload.run.metadata.automatic_product_creation, false)
  assert.equal(payload.run.metadata.automatic_publishing_enabled, false)
  assert.deepEqual(payload.items[0].transaction_evidence, {})
})

test('preview request rejects extra keys and raw POS payload fields', () => {
  assert.throws(() => build({ ...body(), rawXml: '<xml />' }), hasCode('invalid_request'))
  assert.throws(() => build({ ...body(), transactionEvidenceBySourceKey: {} }), hasCode('invalid_request'))
})

test('preview request binds source store and connector source system', () => {
  assert.throws(() => build(body({ sourceStoreNumber: 'WRONG' })), hasCode('source_store_mismatch'))
  assert.throws(
    () => buildCatalogPilotPreviewPayload({
      body: body(),
      connector: { ...connector, sourceSystem: 'other_pos' },
      ownerId: 'c702332a-9299-4b1a-9583-a01302bd7b4a',
      idempotencyKey: 'pilot-request-0001',
    }),
    hasCode('connector_source_mismatch'),
  )
})

test('preview request requires strict UTC capture time and bounded idempotency key', () => {
  assert.throws(() => build(body({ capturedAt: '2026-07-30 21:30:00' })), hasCode('invalid_request'))
  assert.throws(() => build(body(), 'short'), hasCode('idempotency_key_invalid'))
})

test('preview request rejects product source-store mismatch and unselected products', () => {
  assert.throws(
    () => build(body({ products: [product({ sourceStoreNumber: 'WRONG' })] })),
    hasCode('source_store_mismatch'),
  )
  assert.throws(
    () => build(body({ products: [product({
      sourceProductKey: 'upc:111|modifier:000',
      upc: '111',
    })] })),
    hasCode('unselected_product_returned'),
  )
})
