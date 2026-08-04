import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CatalogPilotPromotionError,
  buildCatalogPilotProductPromotionPlan,
} from '../lib/pos/catalog-pilot-product-promotion.mjs'

const STORE_ID = 'ec192877-0156-42ab-8fbf-31105f3e2ea3'
const OWNER_ID = 'c702332a-9299-4b1a-9583-a01302bd7b4a'
const CONNECTOR_ID = 'c91205c3-9c88-4f5c-942a-58ae49800cd2'
const RUN_ID = '11111111-1111-4111-8111-111111111111'

function run(count) {
  return {
    id: RUN_ID,
    store_id: STORE_ID,
    owner_id: OWNER_ID,
    connector_id: CONNECTOR_ID,
    source_system: 'verifone_commander',
    source_store_number: 'AB123',
    import_mode: 'selected_products',
    status: 'previewed',
    catalog_complete: false,
    selection_count: count,
    received_product_count: count,
  }
}

function sourceValues({
  upc,
  modifier = '000',
  description,
  retailPrice,
  cost = null,
  departmentNumber = null,
  departmentName = null,
  categoryNumber = null,
  categoryName = null,
  taxNumber = null,
  taxName = null,
  ageRestriction = null,
  active = null,
  hash,
}) {
  return {
    sourceSystem: 'verifone_commander',
    sourceStoreNumber: 'AB123',
    sourceProductKey: `upc:${upc}|modifier:${modifier}`,
    upc,
    modifier,
    description,
    retailPrice,
    cost,
    departmentNumber,
    departmentName,
    categoryNumber,
    categoryName,
    taxNumber,
    taxName,
    ageRestriction,
    active,
    payloadHash: hash,
  }
}

function item({
  index,
  upc,
  modifier = '000',
  description,
  retailPrice,
  cost = null,
  departmentNumber = null,
  categoryName = null,
  active = null,
}) {
  const hash = String((index % 9) + 1).repeat(64)
  const values = sourceValues({
    upc,
    modifier,
    description,
    retailPrice,
    cost,
    departmentNumber,
    categoryName,
    active,
    hash,
  })

  return {
    id: `22222222-2222-4222-8${String(index).padStart(3, '0')}-222222222222`,
    sync_run_id: RUN_ID,
    store_id: STORE_ID,
    record_index: index,
    source_system: 'verifone_commander',
    source_product_key: values.sourceProductKey,
    source_upc: upc,
    source_modifier: modifier,
    source_payload_hash: hash,
    source_values: values,
    reconciliation_status: 'ready',
  }
}

const FOUR_ITEMS = [
  item({
    index: 0,
    upc: '00999999999993',
    description: 'Commander value A',
    retailPrice: 0.02,
    departmentNumber: '0001',
  }),
  item({
    index: 1,
    upc: '00000000000017',
    description: 'Commander value B',
    retailPrice: 3,
    departmentNumber: '0001',
  }),
  item({
    index: 2,
    upc: '00000000000024',
    description: 'Commander value C',
    retailPrice: 4.25,
  }),
  item({
    index: 3,
    upc: '00000000034524',
    description: 'Commander value D',
    retailPrice: 6.5,
    active: true,
  }),
]

test('four selected products become four dynamic create operations', () => {
  const plan = buildCatalogPilotProductPromotionPlan({
    run: run(4),
    items: FOUR_ITEMS,
  })

  assert.equal(plan.operation_count, 4)
  assert.equal(plan.counts.create_product, 4)
  assert.equal(plan.operations[0].product_values.upc, '00999999999993')
  assert.equal(plan.operations[0].product_values.item_name, 'Commander value A')
  assert.equal(plan.operations[0].product_values.selling_price, '0.02')
  assert.equal(plan.operations[1].product_values.item_name, 'Commander value B')
  assert.equal(plan.operations[1].product_values.selling_price, '3.00')
  assert.equal(plan.operations[2].product_values.item_name, 'Commander value C')
  assert.equal(plan.operations[3].product_values.item_name, 'Commander value D')
})

test('a fifth selected UPC can be added without changing planner code', () => {
  const fifth = item({
    index: 4,
    upc: '00000000000031',
    description: 'Value returned later by Commander',
    retailPrice: 9.75,
  })

  const plan = buildCatalogPilotProductPromotionPlan({
    run: run(5),
    items: [...FOUR_ITEMS, fifth],
  })

  assert.equal(plan.selection_count, 5)
  assert.equal(plan.operation_count, 5)
  assert.equal(
    plan.operations[4].product_values.item_name,
    'Value returned later by Commander',
  )
  assert.equal(plan.operations[4].product_values.selling_price, '9.75')
})

test('leading zeroes and the UPC plus modifier source key are preserved', () => {
  const plan = buildCatalogPilotProductPromotionPlan({
    run: run(1),
    items: [FOUR_ITEMS[1]],
  })

  const operation = plan.operations[0]
  assert.equal(operation.product_values.upc, '00000000000017')
  assert.equal(
    operation.source_product_key,
    'upc:00000000000017|modifier:000',
  )
  assert.equal(operation.identity_values.source_modifier, '000')
})

test('an existing Commander identity updates the same StorePulse product', () => {
  const productId = '33333333-3333-4333-8333-333333333333'
  const identityId = '44444444-4444-4444-8444-444444444444'
  const changed = item({
    index: 0,
    upc: '00000000000017',
    description: 'New Commander description',
    retailPrice: 3.5,
    departmentNumber: '0002',
  })

  const plan = buildCatalogPilotProductPromotionPlan({
    run: run(1),
    items: [changed],
    existingProducts: [{
      id: productId,
      store_id: STORE_ID,
      upc: '00000000000017',
      item_name: 'Old description',
      selling_price: '3.00',
      cost_price: null,
      department: '0001',
      category: null,
      is_active: true,
    }],
    existingIdentities: [{
      id: identityId,
      store_id: STORE_ID,
      product_id: productId,
      source_system: 'verifone_commander',
      source_product_key: 'upc:00000000000017|modifier:000',
      source_upc: '00000000000017',
      source_modifier: '000',
      source_payload_hash: '8'.repeat(64),
    }],
  })

  assert.equal(plan.counts.update_product, 1)
  assert.equal(plan.operations[0].product_id, productId)
  assert.deepEqual(plan.operations[0].product_values, {
    item_name: 'New Commander description',
    selling_price: '3.50',
    department: '0002',
  })
})

test('an unchanged rerun refreshes identity without creating a duplicate product', () => {
  const productId = '33333333-3333-4333-8333-333333333333'
  const selected = FOUR_ITEMS[1]

  const plan = buildCatalogPilotProductPromotionPlan({
    run: run(1),
    items: [selected],
    existingProducts: [{
      id: productId,
      store_id: STORE_ID,
      upc: '00000000000017',
      item_name: 'Commander value B',
      selling_price: '3.00',
      cost_price: null,
      department: '0001',
      category: null,
      is_active: null,
    }],
    existingIdentities: [{
      id: '44444444-4444-4444-8444-444444444444',
      store_id: STORE_ID,
      product_id: productId,
      source_system: 'verifone_commander',
      source_product_key: selected.source_product_key,
      source_upc: selected.source_upc,
      source_modifier: selected.source_modifier,
      source_payload_hash: selected.source_payload_hash,
    }],
  })

  assert.equal(plan.counts.create_product, 0)
  assert.equal(plan.counts.update_product, 0)
  assert.equal(plan.counts.refresh_identity, 1)
  assert.equal(plan.operations[0].product_id, productId)
})

test('an existing StorePulse UPC can receive its first Commander identity', () => {
  const productId = '33333333-3333-4333-8333-333333333333'

  const plan = buildCatalogPilotProductPromotionPlan({
    run: run(1),
    items: [FOUR_ITEMS[1]],
    existingProducts: [{
      id: productId,
      store_id: STORE_ID,
      upc: '00000000000017',
      item_name: 'Commander value B',
      selling_price: '3.00',
      cost_price: null,
      department: '0001',
      category: null,
      is_active: null,
    }],
  })

  assert.equal(plan.operations[0].match_method, 'store_upc')
  assert.equal(plan.operations[0].action, 'refresh_identity')
  assert.equal(plan.operations[0].product_id, productId)
})

test('a different Commander identity already bound to the UPC fails closed', () => {
  const productId = '33333333-3333-4333-8333-333333333333'

  assert.throws(
    () => buildCatalogPilotProductPromotionPlan({
      run: run(1),
      items: [FOUR_ITEMS[1]],
      existingProducts: [{
        id: productId,
        store_id: STORE_ID,
        upc: '00000000000017',
        item_name: 'Existing',
        selling_price: '3.00',
        cost_price: null,
        department: null,
        category: null,
        is_active: true,
      }],
      existingIdentities: [{
        id: '44444444-4444-4444-8444-444444444444',
        store_id: STORE_ID,
        product_id: productId,
        source_system: 'verifone_commander',
        source_product_key: 'upc:00000000000017|modifier:001',
        source_upc: '00000000000017',
        source_modifier: '001',
        source_payload_hash: 'f'.repeat(64),
      }],
    }),
    (error) =>
      error instanceof CatalogPilotPromotionError
      && error.code === 'catalog_pilot_product_identity_conflict',
  )
})

test('non-zero modifiers remain blocked until the canonical product schema supports them', () => {
  const selected = item({
    index: 0,
    upc: '00000000000014',
    modifier: '145',
    description: 'Modifier variant',
    retailPrice: 1.25,
  })

  assert.throws(
    () => buildCatalogPilotProductPromotionPlan({
      run: run(1),
      items: [selected],
    }),
    (error) =>
      error instanceof CatalogPilotPromotionError
      && error.code === 'catalog_pilot_modifier_not_supported',
  )
})

test('the promotion planner accepts at most five products', () => {
  assert.throws(
    () => buildCatalogPilotProductPromotionPlan({
      run: run(6),
      items: [],
    }),
    (error) =>
      error instanceof CatalogPilotPromotionError
      && error.code === 'catalog_pilot_promotion_invalid',
  )
})

test('missing optional source values are not replaced with hardcoded product values', () => {
  const selected = item({
    index: 0,
    upc: '00000000000017',
    description: 'Only proven fields',
    retailPrice: null,
  })

  const plan = buildCatalogPilotProductPromotionPlan({
    run: run(1),
    items: [selected],
  })

  assert.deepEqual(plan.operations[0].product_values, {
    store_id: STORE_ID,
    upc: '00000000000017',
    item_name: 'Only proven fields',
  })

  const serialized = JSON.stringify(plan)
  assert.doesNotMatch(serialized, /_write_template|raw_xml|sessionCookie|uPLUs/)
})
