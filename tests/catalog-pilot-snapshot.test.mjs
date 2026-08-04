import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CatalogPilotSnapshotError,
  catalogPilotSnapshotIdempotencyKey,
  catalogPilotSnapshotToPreviewBody,
  createCatalogPilotSnapshot,
  parseCatalogPilotSnapshot,
  serializeCatalogPilotSnapshot,
} from '../lib/pos/catalog-pilot-snapshot.mjs'

const STORE_ID = 'ec192877-0156-42ab-8fbf-31105f3e2ea3'
const OWNER_ID = 'c702332a-9299-4b1a-9583-a01302bd7b4a'

function product(upc, description, price, hashCharacter = 'a') {
  return {
    sourceSystem: 'verifone_commander',
    sourceStoreNumber: 'AB123',
    sourceProductKey: `upc:${upc}|modifier:000`,
    upc,
    modifier: '000',
    description,
    retailPrice: price,
    cost: null,
    departmentNumber: null,
    departmentName: null,
    categoryNumber: null,
    categoryName: null,
    taxNumber: null,
    taxName: null,
    ageRestriction: null,
    active: null,
    payloadHash: hashCharacter.repeat(64),
  }
}

const selection = [
  { upc: '00999999999993', modifier: '000' },
  { upc: '00000000000017', modifier: '000' },
]

const products = [
  product('00999999999993', 'Dynamic Commander A', 0.02, 'a'),
  product('00000000000017', 'Dynamic Commander B', 3, 'b'),
]

test('snapshot round trip preserves leading zeroes and dynamic product values', () => {
  const snapshot = createCatalogPilotSnapshot({
    storeId: STORE_ID,
    ownerId: OWNER_ID,
    sourceStoreNumber: 'AB123',
    capturedAt: '2026-07-31T19:00:00.000Z',
    selectedProducts: selection,
    products,
  })

  const parsed = parseCatalogPilotSnapshot(
    serializeCatalogPilotSnapshot(snapshot),
  )

  assert.equal(parsed.selectedProducts[1].upc, '00000000000017')
  assert.equal(parsed.products[0].description, 'Dynamic Commander A')
  assert.equal(parsed.products[0].retailPrice, 0.02)
  assert.match(parsed.snapshotHash, /^[0-9a-f]{64}$/)
})

test('snapshot hash detects product-value tampering', () => {
  const snapshot = createCatalogPilotSnapshot({
    storeId: STORE_ID,
    ownerId: OWNER_ID,
    sourceStoreNumber: 'AB123',
    capturedAt: '2026-07-31T19:00:00.000Z',
    selectedProducts: selection,
    products,
  })

  const tampered = {
    ...snapshot,
    products: [
      { ...snapshot.products[0], retailPrice: 99.99 },
      snapshot.products[1],
    ],
  }

  assert.throws(
    () => parseCatalogPilotSnapshot(JSON.stringify(tampered)),
    (error) =>
      error instanceof CatalogPilotSnapshotError
      && error.code === 'catalog_pilot_snapshot_hash_mismatch',
  )
})

test('snapshot requires every selected product exactly once', () => {
  assert.throws(
    () => createCatalogPilotSnapshot({
      storeId: STORE_ID,
      ownerId: OWNER_ID,
      sourceStoreNumber: 'AB123',
      capturedAt: '2026-07-31T19:00:00.000Z',
      selectedProducts: selection,
      products: [products[0]],
    }),
    (error) =>
      error instanceof CatalogPilotSnapshotError
      && error.code === 'catalog_pilot_snapshot_invalid',
  )
})

test('first pilot blocks more than five products and non-zero modifiers', () => {
  const six = Array.from({ length: 6 }, (_, index) => ({
    upc: String(index + 1).padStart(14, '0'),
    modifier: '000',
  }))

  assert.throws(
    () => createCatalogPilotSnapshot({
      storeId: STORE_ID,
      ownerId: OWNER_ID,
      sourceStoreNumber: 'AB123',
      capturedAt: '2026-07-31T19:00:00.000Z',
      selectedProducts: six,
      products: [],
    }),
    /catalog_pilot_snapshot_invalid/,
  )

  assert.throws(
    () => createCatalogPilotSnapshot({
      storeId: STORE_ID,
      ownerId: OWNER_ID,
      sourceStoreNumber: 'AB123',
      capturedAt: '2026-07-31T19:00:00.000Z',
      selectedProducts: [{ upc: '00000000000014', modifier: '145' }],
      products: [{
        ...product('00000000000014', 'Variant', 1.25, 'c'),
        modifier: '145',
        sourceProductKey: 'upc:00000000000014|modifier:145',
      }],
    }),
    /catalog_pilot_snapshot_invalid/,
  )
})

test('preview body and idempotency key derive only from validated snapshot', () => {
  const snapshot = createCatalogPilotSnapshot({
    storeId: STORE_ID,
    ownerId: OWNER_ID,
    sourceStoreNumber: 'AB123',
    capturedAt: '2026-07-31T19:00:00.000Z',
    selectedProducts: selection,
    products,
  })

  const body = catalogPilotSnapshotToPreviewBody(snapshot)
  assert.deepEqual(Object.keys(body), [
    'schemaVersion',
    'mode',
    'sourceSystem',
    'sourceStoreNumber',
    'capturedAt',
    'selectedProducts',
    'products',
  ])
  assert.equal(body.mode, 'selected_products')
  assert.equal(
    catalogPilotSnapshotIdempotencyKey(snapshot),
    `catalog-snapshot:${snapshot.snapshotHash}`,
  )
})

test('serialized snapshots never contain Commander write or secret material', () => {
  const snapshot = createCatalogPilotSnapshot({
    storeId: STORE_ID,
    ownerId: OWNER_ID,
    sourceStoreNumber: 'AB123',
    capturedAt: '2026-07-31T19:00:00.000Z',
    selectedProducts: selection,
    products,
  })

  assert.doesNotMatch(
    serializeCatalogPilotSnapshot(snapshot),
    /_write_template|raw_xml|sessionCookie|commander_password|connector_token|<domain:PLU/i,
  )
})
