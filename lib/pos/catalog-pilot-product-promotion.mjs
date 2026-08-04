import {
  COMMANDER_SOURCE_SYSTEM,
  normalizeCatalogPilotProduct,
} from './catalog-pilot-contract.mjs'

export const MAX_CATALOG_PILOT_PROMOTION_PRODUCTS = 5
export const CATALOG_PILOT_SUPPORTED_MODIFIER = '000'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const SOURCE_KEY = /^[A-Za-z0-9._:|+-]{1,256}$/

export class CatalogPilotPromotionError extends Error {
  constructor(code) {
    super(code)
    this.name = 'CatalogPilotPromotionError'
    this.code = code
  }
}

function fail(code) {
  throw new CatalogPilotPromotionError(code)
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredUuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    fail('catalog_pilot_promotion_invalid')
  }
  return value.toLowerCase()
}

function requiredText(value, maximum = 512) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail('catalog_pilot_promotion_invalid')
  }
  return value.normalize('NFC')
}

function optionalText(value, maximum = 512) {
  if (value === null || value === undefined) return null
  return requiredText(value, maximum)
}

function moneyString(value) {
  if (value === null || value === undefined) return null

  const numeric = typeof value === 'string' ? Number(value) : value
  if (
    typeof numeric !== 'number'
    || !Number.isFinite(numeric)
    || numeric < 0
    || numeric > 999999.99
    || Math.abs(Math.round(numeric * 100) - numeric * 100) > 1e-8
  ) {
    fail('catalog_pilot_promotion_invalid')
  }

  return numeric.toFixed(2)
}

function moneyEqual(left, right) {
  if (left === null || left === undefined) return false

  try {
    return moneyString(left) === moneyString(right)
  } catch {
    return false
  }
}

function normalizeRun(run) {
  if (
    !isRecord(run)
    || run.source_system !== COMMANDER_SOURCE_SYSTEM
    || run.import_mode !== 'selected_products'
    || run.status !== 'previewed'
    || run.catalog_complete !== false
    || !Number.isInteger(run.selection_count)
    || !Number.isInteger(run.received_product_count)
    || run.selection_count < 1
    || run.selection_count > MAX_CATALOG_PILOT_PROMOTION_PRODUCTS
    || run.received_product_count !== run.selection_count
  ) {
    fail('catalog_pilot_promotion_invalid')
  }

  return Object.freeze({
    id: requiredUuid(run.id),
    storeId: requiredUuid(run.store_id),
    ownerId: requiredUuid(run.owner_id),
    connectorId: requiredUuid(run.connector_id),
    sourceStoreNumber: requiredText(run.source_store_number, 64),
    selectionCount: run.selection_count,
  })
}

function normalizeExistingProducts(values, storeId) {
  if (!Array.isArray(values)) fail('catalog_pilot_existing_data_invalid')

  const byId = new Map()
  const byUpc = new Map()

  for (const value of values) {
    if (!isRecord(value) || requiredUuid(value.store_id) !== storeId) {
      fail('catalog_pilot_existing_data_invalid')
    }

    const id = requiredUuid(value.id)
    const upc = requiredText(value.upc, 32)

    if (!/^\d{1,32}$/.test(upc) || byId.has(id) || byUpc.has(upc)) {
      fail('catalog_pilot_existing_data_invalid')
    }

    const normalized = Object.freeze({
      id,
      store_id: storeId,
      upc,
      item_name: requiredText(value.item_name, 512),
      selling_price: value.selling_price ?? null,
      cost_price: value.cost_price ?? null,
      department: optionalText(value.department, 128),
      category: optionalText(value.category, 128),
      is_active:
        value.is_active === null || value.is_active === undefined
          ? null
          : Boolean(value.is_active),
    })

    byId.set(id, normalized)
    byUpc.set(upc, normalized)
  }

  return { byId, byUpc }
}

function normalizeExistingIdentities(values, storeId, productsById) {
  if (!Array.isArray(values)) fail('catalog_pilot_existing_data_invalid')

  const bySourceKey = new Map()
  const byProductId = new Map()

  for (const value of values) {
    if (
      !isRecord(value)
      || requiredUuid(value.store_id) !== storeId
      || value.source_system !== COMMANDER_SOURCE_SYSTEM
      || typeof value.source_product_key !== 'string'
      || !SOURCE_KEY.test(value.source_product_key)
      || typeof value.source_payload_hash !== 'string'
      || !SHA256.test(value.source_payload_hash)
    ) {
      fail('catalog_pilot_existing_data_invalid')
    }

    const id = requiredUuid(value.id)
    const productId = requiredUuid(value.product_id)
    const sourceUpc = requiredText(value.source_upc, 32)
    const sourceModifier = requiredText(value.source_modifier, 32)

    if (
      !/^\d{1,32}$/.test(sourceUpc)
      || !/^\d{1,32}$/.test(sourceModifier)
      || !productsById.has(productId)
      || bySourceKey.has(value.source_product_key)
    ) {
      fail('catalog_pilot_existing_data_invalid')
    }

    const normalized = Object.freeze({
      id,
      product_id: productId,
      source_product_key: value.source_product_key,
      source_upc: sourceUpc,
      source_modifier: sourceModifier,
      source_payload_hash: value.source_payload_hash,
    })

    bySourceKey.set(normalized.source_product_key, normalized)

    const productIdentities = byProductId.get(productId) ?? []
    productIdentities.push(normalized)
    byProductId.set(productId, productIdentities)
  }

  return { bySourceKey, byProductId }
}

function mappedProductValues(storeId, product) {
  const values = {
    store_id: storeId,
    upc: product.upc,
    item_name: product.description,
  }

  if (product.retailPrice !== null) {
    values.selling_price = moneyString(product.retailPrice)
  }

  if (product.cost !== null) {
    values.cost_price = moneyString(product.cost)
  }

  const department = product.departmentName ?? product.departmentNumber
  if (department !== null) values.department = department

  const category = product.categoryName ?? product.categoryNumber
  if (category !== null) values.category = category

  if (product.active !== null) values.is_active = product.active

  return Object.freeze(values)
}

function changedProductValues(existing, proposed) {
  const changes = {}

  if (existing.item_name !== proposed.item_name) {
    changes.item_name = proposed.item_name
  }

  if (
    Object.hasOwn(proposed, 'selling_price')
    && !moneyEqual(existing.selling_price, proposed.selling_price)
  ) {
    changes.selling_price = proposed.selling_price
  }

  if (
    Object.hasOwn(proposed, 'cost_price')
    && !moneyEqual(existing.cost_price, proposed.cost_price)
  ) {
    changes.cost_price = proposed.cost_price
  }

  if (
    Object.hasOwn(proposed, 'department')
    && existing.department !== proposed.department
  ) {
    changes.department = proposed.department
  }

  if (
    Object.hasOwn(proposed, 'category')
    && existing.category !== proposed.category
  ) {
    changes.category = proposed.category
  }

  if (
    Object.hasOwn(proposed, 'is_active')
    && existing.is_active !== proposed.is_active
  ) {
    changes.is_active = proposed.is_active
  }

  return Object.freeze(changes)
}

function normalizeItem(item, run) {
  if (
    !isRecord(item)
    || requiredUuid(item.sync_run_id) !== run.id
    || requiredUuid(item.store_id) !== run.storeId
    || item.source_system !== COMMANDER_SOURCE_SYSTEM
    || item.reconciliation_status !== 'ready'
    || typeof item.source_product_key !== 'string'
    || !SOURCE_KEY.test(item.source_product_key)
    || typeof item.source_payload_hash !== 'string'
    || !SHA256.test(item.source_payload_hash)
    || !Number.isInteger(item.record_index)
    || item.record_index < 0
  ) {
    fail('catalog_pilot_promotion_invalid')
  }

  let product
  try {
    product = normalizeCatalogPilotProduct(item.source_values)
  } catch {
    fail('catalog_pilot_promotion_invalid')
  }

  if (
    product.sourceSystem !== COMMANDER_SOURCE_SYSTEM
    || product.sourceStoreNumber !== run.sourceStoreNumber
    || product.sourceProductKey !== item.source_product_key
    || product.upc !== item.source_upc
    || product.modifier !== item.source_modifier
    || product.payloadHash !== item.source_payload_hash
  ) {
    fail('catalog_pilot_source_identity_mismatch')
  }

  if (product.modifier !== CATALOG_PILOT_SUPPORTED_MODIFIER) {
    fail('catalog_pilot_modifier_not_supported')
  }

  return Object.freeze({
    id: requiredUuid(item.id),
    recordIndex: item.record_index,
    sourceProductKey: product.sourceProductKey,
    sourcePayloadHash: product.payloadHash,
    product,
  })
}

function operationForItem({
  item,
  run,
  productsById,
  productsByUpc,
  identitiesBySourceKey,
  identitiesByProductId,
}) {
  const proposed = mappedProductValues(run.storeId, item.product)
  const existingIdentity = identitiesBySourceKey.get(item.sourceProductKey) ?? null

  let existingProduct = null
  let matchMethod = null

  if (existingIdentity) {
    existingProduct = productsById.get(existingIdentity.product_id) ?? null
    if (!existingProduct) fail('catalog_pilot_existing_data_invalid')
    matchMethod = 'source_identity'
  } else {
    existingProduct = productsByUpc.get(item.product.upc) ?? null
    matchMethod = existingProduct ? 'store_upc' : 'new_product'
  }

  if (existingProduct) {
    const productIdentities = identitiesByProductId.get(existingProduct.id) ?? []
    const conflict = productIdentities.some(
      (identity) => identity.source_product_key !== item.sourceProductKey,
    )
    if (conflict) fail('catalog_pilot_product_identity_conflict')
  }

  let action
  let productValues
  let productId = null

  if (!existingProduct) {
    action = 'create_product'
    productValues = proposed
  } else {
    productId = existingProduct.id
    const changes = changedProductValues(existingProduct, proposed)
    action = Object.keys(changes).length > 0
      ? 'update_product'
      : 'refresh_identity'
    productValues = changes
  }

  const identityValues = Object.freeze({
    store_id: run.storeId,
    product_id: productId,
    source_system: COMMANDER_SOURCE_SYSTEM,
    source_product_key: item.sourceProductKey,
    source_upc: item.product.upc,
    source_modifier: item.product.modifier,
    source_payload_hash: item.sourcePayloadHash,
    metadata: Object.freeze({
      source_store_number: run.sourceStoreNumber,
      last_source_values: item.product,
      pilot_selected_product: true,
    }),
  })

  const historyEventType = {
    create_product: 'pos_catalog_product_created',
    update_product: 'pos_catalog_product_updated',
    refresh_identity: 'pos_catalog_product_observed',
  }[action]

  return Object.freeze({
    action,
    match_method: matchMethod,
    sync_item_id: item.id,
    source_product_key: item.sourceProductKey,
    product_id: productId,
    product_values: productValues,
    identity_values: identityValues,
    history: Object.freeze({
      event_type: historyEventType,
      changes: Object.freeze({
        product_fields: productValues,
      }),
      metadata: Object.freeze({
        source_product_key: item.sourceProductKey,
        source_payload_hash: item.sourcePayloadHash,
        selected_products_pilot: true,
      }),
    }),
  })
}

export function buildCatalogPilotProductPromotionPlan({
  run,
  items,
  existingProducts = [],
  existingIdentities = [],
} = {}) {
  const normalizedRun = normalizeRun(run)

  if (
    !Array.isArray(items)
    || items.length !== normalizedRun.selectionCount
  ) {
    fail('catalog_pilot_promotion_invalid')
  }

  const products = normalizeExistingProducts(
    existingProducts,
    normalizedRun.storeId,
  )
  const identities = normalizeExistingIdentities(
    existingIdentities,
    normalizedRun.storeId,
    products.byId,
  )

  const normalizedItems = items
    .map((item) => normalizeItem(item, normalizedRun))
    .sort((left, right) => left.recordIndex - right.recordIndex)

  const recordIndexes = new Set()
  const sourceKeys = new Set()

  for (const item of normalizedItems) {
    if (
      recordIndexes.has(item.recordIndex)
      || sourceKeys.has(item.sourceProductKey)
    ) {
      fail('catalog_pilot_promotion_invalid')
    }

    recordIndexes.add(item.recordIndex)
    sourceKeys.add(item.sourceProductKey)
  }

  const operations = normalizedItems.map((item) =>
    operationForItem({
      item,
      run: normalizedRun,
      productsById: products.byId,
      productsByUpc: products.byUpc,
      identitiesBySourceKey: identities.bySourceKey,
      identitiesByProductId: identities.byProductId,
    }),
  )

  const counts = operations.reduce(
    (result, operation) => {
      result[operation.action] += 1
      return result
    },
    {
      create_product: 0,
      update_product: 0,
      refresh_identity: 0,
    },
  )

  return Object.freeze({
    ok: true,
    preview_only: false,
    catalog_complete: false,
    selected_products_only: true,
    sync_run_id: normalizedRun.id,
    store_id: normalizedRun.storeId,
    selection_count: normalizedRun.selectionCount,
    operation_count: operations.length,
    counts: Object.freeze(counts),
    operations: Object.freeze(operations),
  })
}
