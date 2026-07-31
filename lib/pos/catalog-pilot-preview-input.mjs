import { createHash } from 'node:crypto'

import {
  COMMANDER_SOURCE_SYSTEM,
  CatalogPilotContractError,
  buildSelectedPilotRunRecords,
  stableCatalogValue,
} from './catalog-pilot-contract.mjs'

export const CATALOG_PILOT_SCHEMA_VERSION = '1'
export const CATALOG_PILOT_NORMALIZER_VERSION = 'catalog-pilot-preview:v1'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/
const STRICT_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const REQUEST_KEYS = Object.freeze([
  'schemaVersion',
  'mode',
  'sourceSystem',
  'sourceStoreNumber',
  'capturedAt',
  'selectedProducts',
  'products',
])

export class CatalogPilotPreviewInputError extends Error {
  constructor(code) {
    super(code)
    this.name = 'CatalogPilotPreviewInputError'
    this.code = code
  }
}

function fail(code) {
  throw new CatalogPilotPreviewInputError(code)
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function nullableText(value, maximum) {
  if (value === null) return null
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) fail('invalid_request')
  return value.normalize('NFC')
}

function strictUtcTimestamp(value) {
  if (typeof value !== 'string' || !STRICT_UTC_TIMESTAMP.test(value)) fail('invalid_request')
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail('invalid_request')
  return value
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('server_identity_invalid')
  return value.toLowerCase()
}

function requestFingerprint(value) {
  return createHash('sha256').update(stableCatalogValue(value), 'utf8').digest('hex')
}

export function normalizeCatalogPilotIdempotencyKey(value) {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value)) fail('idempotency_key_invalid')
  return value
}

export function buildCatalogPilotPreviewPayload({
  body,
  connector,
  ownerId,
  idempotencyKey,
}) {
  if (!isRecord(body) || !exactKeys(body, REQUEST_KEYS)) fail('invalid_request')
  if (!isRecord(connector)) fail('server_identity_invalid')

  const connectorId = uuid(connector.id)
  const storeId = uuid(connector.storeId)
  const normalizedOwnerId = uuid(ownerId)
  const normalizedIdempotencyKey = normalizeCatalogPilotIdempotencyKey(idempotencyKey)

  if (body.schemaVersion !== CATALOG_PILOT_SCHEMA_VERSION) fail('invalid_request')
  if (body.mode !== 'selected_products') fail('invalid_request')
  if (body.sourceSystem !== COMMANDER_SOURCE_SYSTEM) fail('invalid_request')
  if (connector.sourceSystem !== COMMANDER_SOURCE_SYSTEM) fail('connector_source_mismatch')

  const sourceStoreNumber = nullableText(body.sourceStoreNumber, 64)
  const connectorSourceStoreNumber =
    connector.sourceStoreNumber === null || connector.sourceStoreNumber === undefined
      ? null
      : nullableText(connector.sourceStoreNumber, 64)

  if (connectorSourceStoreNumber !== null && sourceStoreNumber !== connectorSourceStoreNumber) {
    fail('source_store_mismatch')
  }

  const capturedAt = strictUtcTimestamp(body.capturedAt)

  let records
  try {
    records = buildSelectedPilotRunRecords({
      storeId,
      ownerId: normalizedOwnerId,
      connectorId,
      sourceStoreNumber,
      capturedAt,
      selectedProducts: body.selectedProducts,
      products: body.products,
    })
  } catch (error) {
    if (error instanceof CatalogPilotContractError) fail(error.code)
    throw error
  }

  for (const item of records.items) {
    if (item.source_values.sourceStoreNumber !== sourceStoreNumber) fail('source_store_mismatch')
    if (Object.keys(item.transaction_evidence).length !== 0) fail('invalid_request')
  }

  const fingerprint = requestFingerprint({
    version: 'catalog-pilot-preview-request:v1',
    connectorId,
    storeId,
    ownerId: normalizedOwnerId,
    idempotencyKey: normalizedIdempotencyKey,
    sourceStoreNumber,
    capturedAt,
    selectedProducts: body.selectedProducts,
    products: body.products,
  })

  const run = Object.freeze({
    ...records.run,
    idempotency_key: normalizedIdempotencyKey,
    request_fingerprint: fingerprint,
    normalizer_version: CATALOG_PILOT_NORMALIZER_VERSION,
    source_schema_version: CATALOG_PILOT_SCHEMA_VERSION,
    metadata: Object.freeze({
      ...records.run.metadata,
      preview_only: true,
      automatic_product_creation: false,
      automatic_publishing_enabled: false,
      raw_pos_payload_retained: false,
    }),
  })

  return Object.freeze({
    run,
    items: records.items,
  })
}
