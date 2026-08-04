import { createHash } from 'node:crypto'

import {
  COMMANDER_SOURCE_SYSTEM,
  normalizeCatalogPilotProduct,
  stableCatalogValue,
  validateSelectedProductSet,
} from './catalog-pilot-contract.mjs'

export const CATALOG_PILOT_SNAPSHOT_SCHEMA_VERSION = '1'
export const CATALOG_PILOT_SNAPSHOT_MODE = 'selected_products_snapshot'
export const CATALOG_PILOT_SNAPSHOT_MAX_PRODUCTS = 5
export const CATALOG_PILOT_SNAPSHOT_MAX_BYTES = 64 * 1024

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const STRICT_UTC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SNAPSHOT_KEYS = Object.freeze([
  'schemaVersion',
  'mode',
  'sourceSystem',
  'sourceStoreNumber',
  'storeId',
  'ownerId',
  'capturedAt',
  'selectedProducts',
  'products',
  'snapshotHash',
])

export class CatalogPilotSnapshotError extends Error {
  constructor(code) {
    super(code)
    this.name = 'CatalogPilotSnapshotError'
    this.code = code
  }
}

function fail(code) {
  throw new CatalogPilotSnapshotError(code)
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index])
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    fail('catalog_pilot_snapshot_invalid')
  }
  return value.toLowerCase()
}

function safeText(value, maximum) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail('catalog_pilot_snapshot_invalid')
  }
  return value.normalize('NFC')
}

function strictCapturedAt(value) {
  const normalized = value instanceof Date ? value.toISOString() : value
  if (
    typeof normalized !== 'string'
    || !STRICT_UTC_TIMESTAMP.test(normalized)
  ) {
    fail('catalog_pilot_snapshot_invalid')
  }

  const parsed = new Date(normalized)
  if (
    !Number.isFinite(parsed.getTime())
    || parsed.toISOString() !== normalized
  ) {
    fail('catalog_pilot_snapshot_invalid')
  }

  return normalized
}

function canonicalWithoutHash(value) {
  return {
    schemaVersion: value.schemaVersion,
    mode: value.mode,
    sourceSystem: value.sourceSystem,
    sourceStoreNumber: value.sourceStoreNumber,
    storeId: value.storeId,
    ownerId: value.ownerId,
    capturedAt: value.capturedAt,
    selectedProducts: value.selectedProducts,
    products: value.products,
  }
}

function snapshotHash(value) {
  return createHash('sha256')
    .update(
      stableCatalogValue({
        version: 'catalog-pilot-snapshot:v1',
        snapshot: canonicalWithoutHash(value),
      }),
      'utf8',
    )
    .digest('hex')
}

function normalizeSelection(values) {
  let selection
  try {
    selection = validateSelectedProductSet(values)
  } catch {
    fail('catalog_pilot_snapshot_invalid')
  }

  if (
    selection.length < 1
    || selection.length > CATALOG_PILOT_SNAPSHOT_MAX_PRODUCTS
    || selection.some((item) => item.modifier !== '000')
  ) {
    fail('catalog_pilot_snapshot_invalid')
  }

  return selection.map(({ upc, modifier }) =>
    Object.freeze({ upc, modifier }),
  )
}

function normalizeProducts(values, selection) {
  if (!Array.isArray(values) || values.length !== selection.length) {
    fail('catalog_pilot_snapshot_invalid')
  }

  const selectedKeys = new Set(
    selection.map(({ upc, modifier }) => `upc:${upc}|modifier:${modifier}`),
  )
  const seen = new Set()

  const products = values.map((value) => {
    let product
    try {
      product = normalizeCatalogPilotProduct(value)
    } catch {
      fail('catalog_pilot_snapshot_invalid')
    }

    if (
      product.sourceSystem !== COMMANDER_SOURCE_SYSTEM
      || product.modifier !== '000'
      || !selectedKeys.has(product.sourceProductKey)
      || seen.has(product.sourceProductKey)
    ) {
      fail('catalog_pilot_snapshot_invalid')
    }

    seen.add(product.sourceProductKey)
    return product
  })

  if (seen.size !== selectedKeys.size) {
    fail('catalog_pilot_snapshot_invalid')
  }

  return products
}

export function createCatalogPilotSnapshot({
  storeId,
  ownerId,
  sourceStoreNumber,
  capturedAt,
  selectedProducts,
  products,
} = {}) {
  const selection = normalizeSelection(selectedProducts)
  const normalizedProducts = normalizeProducts(products, selection)

  const withoutHash = Object.freeze({
    schemaVersion: CATALOG_PILOT_SNAPSHOT_SCHEMA_VERSION,
    mode: CATALOG_PILOT_SNAPSHOT_MODE,
    sourceSystem: COMMANDER_SOURCE_SYSTEM,
    sourceStoreNumber: safeText(sourceStoreNumber, 64),
    storeId: uuid(storeId),
    ownerId: uuid(ownerId),
    capturedAt: strictCapturedAt(capturedAt),
    selectedProducts: Object.freeze(selection),
    products: Object.freeze(normalizedProducts),
  })

  return Object.freeze({
    ...withoutHash,
    snapshotHash: snapshotHash(withoutHash),
  })
}

export function serializeCatalogPilotSnapshot(snapshot) {
  const normalized = validateCatalogPilotSnapshot(snapshot)
  let text

  try {
    text = `${JSON.stringify(normalized, null, 2)}\n`
  } catch {
    fail('catalog_pilot_snapshot_invalid')
  }

  if (
    Buffer.byteLength(text, 'utf8') > CATALOG_PILOT_SNAPSHOT_MAX_BYTES
    || /(?:_write_template|sessionCookie|session_cookie|raw_xml|<domain:PLU|commander_password|connector_token)/i.test(
      text,
    )
  ) {
    fail('catalog_pilot_snapshot_invalid')
  }

  return text
}

export function parseCatalogPilotSnapshot(text) {
  if (
    typeof text !== 'string'
    || text.length < 1
    || Buffer.byteLength(text, 'utf8') > CATALOG_PILOT_SNAPSHOT_MAX_BYTES
  ) {
    fail('catalog_pilot_snapshot_invalid')
  }

  let value
  try {
    value = JSON.parse(text)
  } catch {
    fail('catalog_pilot_snapshot_invalid')
  }

  return validateCatalogPilotSnapshot(value)
}

export function validateCatalogPilotSnapshot(value) {
  if (
    !exactKeys(value, SNAPSHOT_KEYS)
    || value.schemaVersion !== CATALOG_PILOT_SNAPSHOT_SCHEMA_VERSION
    || value.mode !== CATALOG_PILOT_SNAPSHOT_MODE
    || value.sourceSystem !== COMMANDER_SOURCE_SYSTEM
    || typeof value.snapshotHash !== 'string'
    || !SHA256.test(value.snapshotHash)
  ) {
    fail('catalog_pilot_snapshot_invalid')
  }

  const normalized = createCatalogPilotSnapshot({
    storeId: value.storeId,
    ownerId: value.ownerId,
    sourceStoreNumber: value.sourceStoreNumber,
    capturedAt: value.capturedAt,
    selectedProducts: value.selectedProducts,
    products: value.products,
  })

  if (normalized.snapshotHash !== value.snapshotHash) {
    fail('catalog_pilot_snapshot_hash_mismatch')
  }

  return normalized
}

export function catalogPilotSnapshotToPreviewBody(snapshot) {
  const normalized = validateCatalogPilotSnapshot(snapshot)

  return Object.freeze({
    schemaVersion: CATALOG_PILOT_SNAPSHOT_SCHEMA_VERSION,
    mode: 'selected_products',
    sourceSystem: COMMANDER_SOURCE_SYSTEM,
    sourceStoreNumber: normalized.sourceStoreNumber,
    capturedAt: normalized.capturedAt,
    selectedProducts: normalized.selectedProducts,
    products: normalized.products,
  })
}

export function catalogPilotSnapshotIdempotencyKey(snapshot) {
  const normalized = validateCatalogPilotSnapshot(snapshot)
  return `catalog-snapshot:${normalized.snapshotHash}`
}
