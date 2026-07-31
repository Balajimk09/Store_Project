import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  CatalogPilotContractError,
  buildSelectedPilotRunRecords,
  canonicalSelectedCatalogHash,
  normalizeCommanderSelectedIdentity,
  validateSelectedProductSet,
} from '../lib/pos/catalog-pilot-contract.mjs'

function product(overrides = {}) {
  const value = {
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
  return value
}

const selected = [
  { upc: '00999999999993', modifier: '000' },
  { upc: '00000000000014', modifier: '145' },
]

test('Commander selected identity preserves leading zeroes and modifier', () => {
  assert.deepEqual(normalizeCommanderSelectedIdentity(selected[0]), {
    upc: '00999999999993',
    modifier: '000',
    sourceProductKey: 'upc:00999999999993|modifier:000',
  })
})

test('selected product set is bounded and duplicate-safe', () => {
  assert.equal(validateSelectedProductSet(selected).length, 2)
  assert.throws(
    () => validateSelectedProductSet(Array.from({ length: 11 }, (_, index) => ({ upc: String(index + 1), modifier: '000' }))),
    (error) => error instanceof CatalogPilotContractError && error.code === 'selected_product_set_invalid',
  )
  assert.throws(
    () => validateSelectedProductSet([selected[0], selected[0]]),
    (error) => error instanceof CatalogPilotContractError && error.code === 'duplicate_source_product_key',
  )
})

test('selected catalog hash is order-independent but selection-sensitive', () => {
  const second = product({
    sourceProductKey: 'upc:00000000000014|modifier:145',
    upc: '00000000000014',
    modifier: '145',
    description: '12OZ CAN',
    retailPrice: 1.19,
    payloadHash: 'b'.repeat(64),
  })

  const left = canonicalSelectedCatalogHash({
    sourceSystem: 'verifone_commander',
    sourceStoreNumber: 'AB123',
    selectedProducts: selected,
    products: [product(), second],
  })
  const right = canonicalSelectedCatalogHash({
    sourceSystem: 'verifone_commander',
    sourceStoreNumber: 'AB123',
    selectedProducts: [...selected].reverse(),
    products: [second, product()],
  })

  assert.equal(left, right)
  assert.match(left, /^[0-9a-f]{64}$/)
})

test('unselected products and source identity mismatches fail closed', () => {
  assert.throws(
    () => canonicalSelectedCatalogHash({
      sourceSystem: 'verifone_commander',
      sourceStoreNumber: 'AB123',
      selectedProducts: selected,
      products: [product({ sourceProductKey: 'upc:111|modifier:000', upc: '111' })],
    }),
    (error) => error instanceof CatalogPilotContractError && error.code === 'unselected_product_returned',
  )

  assert.throws(
    () => canonicalSelectedCatalogHash({
      sourceSystem: 'verifone_commander',
      sourceStoreNumber: 'AB123',
      selectedProducts: selected,
      products: [product({ sourceProductKey: 'upc:00999999999993|modifier:001' })],
    }),
    (error) => error instanceof CatalogPilotContractError && error.code === 'source_identity_mismatch',
  )
})

test('run records remain selected-products, incomplete-catalog, preview-only', () => {
  const records = buildSelectedPilotRunRecords({
    storeId: 'ec192877-0156-42ab-8fbf-31105f3e2ea3',
    ownerId: 'c702332a-9299-4b1a-9583-a01302bd7b4a',
    connectorId: 'connector-id',
    sourceStoreNumber: 'AB123',
    capturedAt: '2026-07-31T02:00:00.000Z',
    selectedProducts: selected,
    products: [product()],
    transactionEvidenceBySourceKey: {
      'upc:00999999999993|modifier:000': { sale_line_count: 0 },
    },
  })

  assert.equal(records.run.import_mode, 'selected_products')
  assert.equal(records.run.catalog_complete, false)
  assert.equal(records.run.status, 'previewed')
  assert.equal(records.run.selection_count, 2)
  assert.equal(records.run.received_product_count, 1)
  assert.equal(records.run.metadata.missing_selected_count, 1)
  assert.equal(records.items[0].reconciliation_status, 'ready')
  assert.deepEqual(records.items[0].transaction_evidence, { sale_line_count: 0 })
  assert.equal(Object.hasOwn(records.run, 'auto_apply'), false)
})
