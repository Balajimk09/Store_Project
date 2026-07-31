import { createHash } from 'node:crypto'

export const MAX_SELECTED_PRODUCTS = 10
export const COMMANDER_SOURCE_SYSTEM = 'verifone_commander'

const SAFE_SOURCE_KEY = /^[A-Za-z0-9._:|+-]{1,256}$/
const SHA256 = /^[0-9a-f]{64}$/
const PRODUCT_KEYS = Object.freeze([
  'sourceSystem',
  'sourceStoreNumber',
  'sourceProductKey',
  'upc',
  'modifier',
  'description',
  'retailPrice',
  'cost',
  'departmentNumber',
  'departmentName',
  'categoryNumber',
  'categoryName',
  'taxNumber',
  'taxName',
  'ageRestriction',
  'active',
  'payloadHash',
])

export class CatalogPilotContractError extends Error {
  constructor(code) {
    super(code)
    this.name = 'CatalogPilotContractError'
    this.code = code
  }
}

function fail(code) {
  throw new CatalogPilotContractError(code)
}

function nullableText(value, maximum) {
  if (value === null || value === undefined) return null
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) fail('catalog_product_invalid')
  return value.normalize('NFC')
}

function nullableMoney(value) {
  if (value === null || value === undefined) return null
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 999999.99 ||
    Math.abs(Math.round(value * 100) - value * 100) > 1e-8
  ) fail('catalog_product_invalid')
  return value
}

export function stableCatalogValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableCatalogValue(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableCatalogValue(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function normalizeCommanderSelectedIdentity(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['upc', 'modifier'].includes(key))
  ) fail('selected_identity_invalid')

  const upc = nullableText(value.upc, 32)
  const modifier = nullableText(value.modifier, 32)

  if (!/^\d{1,32}$/.test(upc ?? '') || !/^\d{1,32}$/.test(modifier ?? '')) {
    fail('selected_identity_invalid')
  }

  return Object.freeze({
    upc,
    modifier,
    sourceProductKey: `upc:${upc}|modifier:${modifier}`,
  })
}

export function validateSelectedProductSet(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_SELECTED_PRODUCTS) {
    fail('selected_product_set_invalid')
  }

  const normalized = values.map(normalizeCommanderSelectedIdentity)
  const keys = new Set()

  for (const item of normalized) {
    if (keys.has(item.sourceProductKey)) fail('duplicate_source_product_key')
    keys.add(item.sourceProductKey)
  }

  return Object.freeze(normalized)
}

export function normalizeCatalogPilotProduct(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== PRODUCT_KEYS.length ||
    PRODUCT_KEYS.some((key) => !Object.hasOwn(input, key))
  ) fail('catalog_product_invalid')

  if (input.sourceSystem !== COMMANDER_SOURCE_SYSTEM) fail('catalog_product_invalid')
  if (typeof input.sourceProductKey !== 'string' || !SAFE_SOURCE_KEY.test(input.sourceProductKey)) {
    fail('catalog_product_invalid')
  }
  if (typeof input.description !== 'string' || input.description.length < 1 || input.description.length > 512) {
    fail('catalog_product_invalid')
  }
  if (typeof input.payloadHash !== 'string' || !SHA256.test(input.payloadHash)) {
    fail('catalog_product_invalid')
  }
  if (input.active !== null && typeof input.active !== 'boolean') fail('catalog_product_invalid')

  const upc = nullableText(input.upc, 32)
  const modifier = nullableText(input.modifier, 32)
  if (upc !== null && !/^\d{1,32}$/.test(upc)) fail('catalog_product_invalid')
  if (modifier !== null && !/^\d{1,32}$/.test(modifier)) fail('catalog_product_invalid')

  const normalized = {
    sourceSystem: COMMANDER_SOURCE_SYSTEM,
    sourceStoreNumber: nullableText(input.sourceStoreNumber, 64),
    sourceProductKey: input.sourceProductKey,
    upc,
    modifier,
    description: nullableText(input.description, 512),
    retailPrice: nullableMoney(input.retailPrice),
    cost: nullableMoney(input.cost),
    departmentNumber: nullableText(input.departmentNumber, 64),
    departmentName: nullableText(input.departmentName, 128),
    categoryNumber: nullableText(input.categoryNumber, 64),
    categoryName: nullableText(input.categoryName, 128),
    taxNumber: nullableText(input.taxNumber, 64),
    taxName: nullableText(input.taxName, 128),
    ageRestriction: nullableText(input.ageRestriction, 128),
    active: input.active,
    payloadHash: input.payloadHash,
  }

  if (upc !== null && modifier !== null) {
    const expected = `upc:${upc}|modifier:${modifier}`
    if (normalized.sourceProductKey !== expected) fail('source_identity_mismatch')
  }

  return Object.freeze(normalized)
}

export function canonicalSelectedCatalogHash({
  sourceSystem,
  sourceStoreNumber = null,
  selectedProducts,
  products,
}) {
  if (sourceSystem !== COMMANDER_SOURCE_SYSTEM) fail('catalog_invalid')
  const selection = validateSelectedProductSet(selectedProducts)
  if (!Array.isArray(products) || products.length > selection.length) fail('catalog_invalid')

  const normalizedProducts = products.map(normalizeCatalogPilotProduct)
  const selectedKeys = new Set(selection.map((item) => item.sourceProductKey))
  const productKeys = new Set()

  for (const product of normalizedProducts) {
    if (!selectedKeys.has(product.sourceProductKey)) fail('unselected_product_returned')
    if (productKeys.has(product.sourceProductKey)) fail('duplicate_source_product_key')
    productKeys.add(product.sourceProductKey)
  }

  const canonical = {
    version: 'selected-products:v1',
    sourceSystem,
    sourceStoreNumber,
    catalogComplete: false,
    selectedProducts: [...selection].sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey)),
    products: [...normalizedProducts].sort((a, b) => a.sourceProductKey.localeCompare(b.sourceProductKey)),
  }

  return createHash('sha256')
    .update(stableCatalogValue(canonical), 'utf8')
    .digest('hex')
}

export function buildSelectedPilotRunRecords({
  storeId,
  ownerId,
  connectorId,
  sourceStoreNumber,
  capturedAt,
  selectedProducts,
  products,
  transactionEvidenceBySourceKey = {},
}) {
  if (![storeId, ownerId, connectorId].every((value) => typeof value === 'string' && value.length > 0)) {
    fail('catalog_invalid')
  }

  const selection = validateSelectedProductSet(selectedProducts)
  const normalizedProducts = products.map(normalizeCatalogPilotProduct)
  const catalogHash = canonicalSelectedCatalogHash({
    sourceSystem: COMMANDER_SOURCE_SYSTEM,
    sourceStoreNumber,
    selectedProducts: selection.map(({ upc, modifier }) => ({ upc, modifier })),
    products: normalizedProducts,
  })
  const selectionHash = createHash('sha256')
    .update(stableCatalogValue(selection), 'utf8')
    .digest('hex')

  const items = normalizedProducts.map((product, recordIndex) => ({
    store_id: storeId,
    record_index: recordIndex,
    source_system: COMMANDER_SOURCE_SYSTEM,
    source_product_key: product.sourceProductKey,
    source_upc: product.upc,
    source_modifier: product.modifier,
    source_payload_hash: product.payloadHash,
    source_values: product,
    reconciliation_status: 'ready',
    proposed_changes: {},
    conflict_fields: [],
    validation_errors: [],
    transaction_evidence:
      transactionEvidenceBySourceKey[product.sourceProductKey] &&
      typeof transactionEvidenceBySourceKey[product.sourceProductKey] === 'object'
        ? transactionEvidenceBySourceKey[product.sourceProductKey]
        : {},
  }))

  return Object.freeze({
    run: Object.freeze({
      store_id: storeId,
      owner_id: ownerId,
      connector_id: connectorId,
      source_system: COMMANDER_SOURCE_SYSTEM,
      source_store_number: sourceStoreNumber ?? null,
      import_mode: 'selected_products',
      status: 'previewed',
      catalog_complete: false,
      captured_at: capturedAt,
      selection_count: selection.length,
      received_product_count: normalizedProducts.length,
      ready_count: normalizedProducts.length,
      catalog_hash: catalogHash,
      selection_hash: selectionHash,
      submitted_by_type: 'connector',
      submitted_by_connector_id: connectorId,
      metadata: {
        selected_source_product_keys: selection.map((item) => item.sourceProductKey),
        missing_selected_count: selection.length - normalizedProducts.length,
      },
    }),
    items: Object.freeze(items.map(Object.freeze)),
  })
}
