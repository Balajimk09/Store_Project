import assert from 'node:assert/strict'
import test from 'node:test'

import {
  runCommanderSelectedProductSnapshotExport,
} from '../connector/lib/catalog-sync/selected-product-snapshot-exporter.mjs'
import {
  createCatalogPilotSnapshot,
  serializeCatalogPilotSnapshot,
} from '../lib/pos/catalog-pilot-snapshot.mjs'
import {
  importCatalogPilotSnapshot,
} from '../lib/pos/catalog-pilot-local-importer.mjs'

const STORE_ID = 'ec192877-0156-42ab-8fbf-31105f3e2ea3'
const OWNER_ID = 'c702332a-9299-4b1a-9583-a01302bd7b4a'
const CONNECTOR_ID = 'c91205c3-9c88-4f5c-942a-58ae49800cd2'
const RUN_ID = '11111111-1111-4111-8111-111111111111'

function artifact(products) {
  return JSON.stringify({
    schema_version: '1',
    mode: 'selected_products',
    store: {
      store_id: STORE_ID,
      owner_id: OWNER_ID,
      store_name: 'Balaji Stores',
      source_system: 'verifone_commander',
      source_store_number: 'AB123',
    },
    safety: {
      read_only: true,
      automatic_publishing_enabled: false,
      retain_raw_xml: false,
      retain_credentials_or_cookies: false,
      max_selected_products: 10,
    },
    products: products.map(({ upc, modifier = '000' }, index) => ({
      upc,
      modifier,
      reason: `Dedicated pilot product ${index + 1}.`,
    })),
  })
}

function commanderProduct(upc, description, price, hashCharacter) {
  return {
    upc,
    modifier: '000',
    description,
    retail_price: price,
    cost: null,
    department_number: null,
    department_name: null,
    category_number: null,
    category_name: null,
    tax_number: null,
    tax_name: null,
    age_restriction: null,
    active: null,
    raw_payload_hash: hashCharacter.repeat(64),
    _write_template: { must_not_escape: true },
  }
}

const selected = [
  { upc: '00999999999993', modifier: '000' },
  { upc: '00000000000017', modifier: '000' },
]

const approval = {
  approved: true,
  operation: 'export_selected_products_snapshot',
  supervised: true,
  read_only: true,
  selected_products_reviewed: true,
}

test('exporter reads sequentially and writes one sanitized snapshot', async () => {
  const events = []
  let written

  const result = await runCommanderSelectedProductSnapshotExport({
    approval,
    selectionArtifact: artifact(selected),
    clock: () => new Date('2026-07-31T19:00:00.000Z'),
    readSelectedProduct: async ({ upc }) => {
      events.push(`start:${upc}`)
      await Promise.resolve()
      events.push(`end:${upc}`)
      const index = selected.findIndex((item) => item.upc === upc)
      return {
        status: 'success',
        product: commanderProduct(
          upc,
          `Commander ${index + 1}`,
          index + 1,
          index === 0 ? 'a' : 'b',
        ),
      }
    },
    writeSnapshot: async (value) => {
      events.push('write')
      written = value
      return {
        written: true,
        location: 'fixed-pilot-output',
      }
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(events, [
    `start:${selected[0].upc}`,
    `end:${selected[0].upc}`,
    `start:${selected[1].upc}`,
    `end:${selected[1].upc}`,
    'write',
  ])
  assert.doesNotMatch(
    written.contents,
    /_write_template|must_not_escape|raw_xml|sessionCookie|uPLUs/,
  )
})

test('missing selected product aborts without snapshot output', async () => {
  let writes = 0

  const result = await runCommanderSelectedProductSnapshotExport({
    approval,
    selectionArtifact: artifact(selected),
    readSelectedProduct: async ({ upc }) =>
      upc === selected[0].upc
        ? {
            status: 'success',
            product: commanderProduct(upc, 'Found', 1, 'a'),
          }
        : { status: 'product_not_found' },
    writeSnapshot: async () => {
      writes += 1
      return { written: true, location: 'unexpected' }
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.safe_error_code, 'selected_product_not_found')
  assert.equal(writes, 0)
})

function snapshotText() {
  const products = selected.map(({ upc }, index) => ({
    sourceSystem: 'verifone_commander',
    sourceStoreNumber: 'AB123',
    sourceProductKey: `upc:${upc}|modifier:000`,
    upc,
    modifier: '000',
    description: `Dynamic ${index + 1}`,
    retailPrice: index + 1,
    cost: null,
    departmentNumber: null,
    departmentName: null,
    categoryNumber: null,
    categoryName: null,
    taxNumber: null,
    taxName: null,
    ageRestriction: null,
    active: null,
    payloadHash: (index === 0 ? 'a' : 'b').repeat(64),
  }))

  return serializeCatalogPilotSnapshot(
    createCatalogPilotSnapshot({
      storeId: STORE_ID,
      ownerId: OWNER_ID,
      sourceStoreNumber: 'AB123',
      capturedAt: '2026-07-31T19:00:00.000Z',
      selectedProducts: selected,
      products,
    }),
  )
}

test('local importer persists preview then promotes the same run exactly once', async () => {
  const calls = []

  const client = {
    async rpc(name, args) {
      calls.push({ name, args })

      if (name === 'create_pos_catalog_pilot_preview') {
        return {
          data: [{ sync_run_id: RUN_ID, created: true }],
          error: null,
        }
      }

      if (name === 'promote_pos_catalog_pilot_products') {
        assert.deepEqual(args, { p_sync_run_id: RUN_ID })
        return {
          data: [{
            sync_run_id: RUN_ID,
            promoted_count: 2,
            created_count: 2,
            updated_count: 0,
            unchanged_count: 0,
          }],
          error: null,
        }
      }

      throw new Error('unexpected_rpc')
    },
  }

  const result = await importCatalogPilotSnapshot({
    snapshotText: snapshotText(),
    connector: {
      id: CONNECTOR_ID,
      storeId: STORE_ID,
      sourceSystem: 'verifone_commander',
      sourceStoreNumber: 'AB123',
    },
    ownerId: OWNER_ID,
    client,
  })

  assert.equal(result.ok, true)
  assert.equal(result.promoted_count, 2)
  assert.deepEqual(
    calls.map((call) => call.name),
    [
      'create_pos_catalog_pilot_preview',
      'promote_pos_catalog_pilot_products',
    ],
  )
  assert.doesNotMatch(
    JSON.stringify(result),
    /Dynamic 1|Dynamic 2|retailPrice|source_values/,
  )
})

test('identity mismatch fails before any Supabase RPC', async () => {
  let calls = 0

  const result = await importCatalogPilotSnapshot({
    snapshotText: snapshotText(),
    connector: {
      id: CONNECTOR_ID,
      storeId: STORE_ID,
      sourceSystem: 'verifone_commander',
      sourceStoreNumber: 'WRONG',
    },
    ownerId: OWNER_ID,
    client: {
      async rpc() {
        calls += 1
        throw new Error('must_not_run')
      },
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.safe_error_code, 'import_identity_invalid')
  assert.equal(calls, 0)
})

test('promotion errors return safe failure without product values', async () => {
  const client = {
    async rpc(name) {
      if (name === 'create_pos_catalog_pilot_preview') {
        return {
          data: [{ sync_run_id: RUN_ID, created: true }],
          error: null,
        }
      }

      return {
        data: null,
        error: { message: 'database detail must not escape' },
      }
    },
  }

  const result = await importCatalogPilotSnapshot({
    snapshotText: snapshotText(),
    connector: {
      id: CONNECTOR_ID,
      storeId: STORE_ID,
      sourceSystem: 'verifone_commander',
      sourceStoreNumber: 'AB123',
    },
    ownerId: OWNER_ID,
    client,
  })

  assert.deepEqual(result, {
    ok: false,
    selected_products_only: true,
    preview_created: false,
    promotion_completed: false,
    safe_error_code: 'promotion_failed',
  })
  assert.doesNotMatch(JSON.stringify(result), /database detail/)
})
