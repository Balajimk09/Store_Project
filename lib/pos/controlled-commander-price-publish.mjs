export const COMMANDER_PRICE_ACTIVE_STATUSES = Object.freeze([
  'pending',
  'claimed',
  'sending',
  'verifying',
])

const JOB_STATUSES = new Set([
  ...COMMANDER_PRICE_ACTIVE_STATUSES,
  'completed',
  'failed',
  'cancelled',
])
const FAILURE_CODES = new Set([
  'commander_auth_failed',
  'commander_unreachable',
  'commander_tls_failed',
  'plu_not_found',
  'plu_identity_mismatch',
  'update_rejected',
  'price_conflict',
  'verification_failed',
  'job_expired',
  'internal_connector_error',
])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PRICE = /^(?:0|[1-9]\d*)\.\d{2}$/
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{16,128}$/
const MAX_BODY_BYTES = 4096
const COMMANDER_SOURCE_SYSTEM = 'commander'
const MAX_IDENTITIES = 100

export class CommanderPricePublishError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function fail(code) {
  throw new CommanderPricePublishError(code)
}

function isRecord(value) {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false
  const received = Object.keys(value)
  return received.length === keys.length && received.every((key) => keys.includes(key))
}

function uuid(value, code) {
  if (typeof value !== 'string' || !UUID.test(value)) fail(code)
  return value.toLowerCase()
}

function price(value, code) {
  if (typeof value !== 'string' || !PRICE.test(value)) fail(code)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 999999.99) fail(code)
  return parsed.toFixed(2)
}

function timestamp(value, nullable = false) {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || value.length > 64) fail('publish_unavailable')
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) fail('publish_unavailable')
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const offsetHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3))
  const offsetMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6))
  if (
    month < 1 || month > 12 || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59
    || offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)
    || !Number.isFinite(Date.parse(value))
  ) fail('publish_unavailable')
  return value
}

export function normalizeCommanderPriceRequest(value) {
  const keys = [
    'store_id',
    'product_id',
    'expected_price',
    'requested_price',
    'idempotency_key',
  ]
  if (!exactKeys(value, keys)) fail('invalid_request')
  if (typeof value.idempotency_key !== 'string' || !IDEMPOTENCY.test(value.idempotency_key)) fail('invalid_request')

  const expectedPrice = price(value.expected_price, 'invalid_price')
  const requestedPrice = price(value.requested_price, 'invalid_price')
  if (expectedPrice === requestedPrice) fail('price_unchanged')

  return Object.freeze({
    storeId: uuid(value.store_id, 'invalid_store'),
    productId: uuid(value.product_id, 'invalid_product'),
    expectedPrice,
    requestedPrice,
    idempotencyKey: value.idempotency_key,
  })
}

export async function readBoundedCommanderPriceJson(request) {
  const contentType = request?.headers?.get?.('content-type')?.trim() ?? ''
  if (!/^application\/json(?:\s*;\s*charset=[A-Za-z0-9._-]+)?$/i.test(contentType)) fail('unsupported_media_type')
  const lengthHeader = request.headers.get('content-length')
  if (lengthHeader !== null) {
    if (!/^\d+$/.test(lengthHeader)) fail('invalid_request')
    const length = Number(lengthHeader)
    if (!Number.isSafeInteger(length) || length > MAX_BODY_BYTES) fail('payload_too_large')
  }
  if (!request.body) fail('invalid_request')
  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        try { await reader.cancel() } catch {}
        fail('payload_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (total === 0) fail('invalid_request')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    fail('invalid_request')
  }
}

function normalizeRequestedJob(row) {
  if (!isRecord(row)) fail('publish_unavailable')
  const required = ['job_id', 'status', 'expected_price', 'requested_price', 'created_at']
  if (!exactKeys(row, required) || !JOB_STATUSES.has(row.status)) fail('publish_unavailable')
  return Object.freeze({
    id: uuid(row.job_id, 'publish_unavailable'),
    status: row.status,
    expected_price: price(row.expected_price, 'publish_unavailable'),
    requested_price: price(row.requested_price, 'publish_unavailable'),
    created_at: timestamp(row.created_at),
    completed_at: null,
    failed_at: null,
    failure_code: null,
  })
}

export async function requestCommanderPriceUpdate({ client, userId, input } = {}) {
  if (!client || typeof client.rpc !== 'function') fail('publish_unavailable')
  uuid(userId, 'unauthorized')
  const request = normalizeCommanderPriceRequest(input)
  const { data, error } = await client.rpc('request_commander_price_update', {
    p_store_id: request.storeId,
    p_product_id: request.productId,
    p_expected_price: request.expectedPrice,
    p_requested_price: request.requestedPrice,
    p_idempotency_key: request.idempotencyKey,
  })
  if (error) {
    const code = typeof error.code === 'string' ? error.code : ''
    if (code === '42501') fail('forbidden')
    if (code === '23505') fail('publish_already_active')
    if (code === '22023' || code === '23514') fail('publish_conflict')
    fail('publish_unavailable')
  }
  const row = Array.isArray(data) ? data[0] : data
  return normalizeRequestedJob(row)
}

function normalizeJobRow(row) {
  if (!isRecord(row)) fail('publish_unavailable')
  const required = [
    'id',
    'store_id',
    'product_id',
    'status',
    'expected_price',
    'requested_price',
    'created_at',
    'completed_at',
    'failed_at',
    'audit_metadata',
  ]
  if (!exactKeys(row, required) || !JOB_STATUSES.has(row.status)) fail('publish_unavailable')
  const metadata = isRecord(row.audit_metadata) ? row.audit_metadata : {}
  const failureCode = typeof metadata.failure_code === 'string' && FAILURE_CODES.has(metadata.failure_code)
    ? metadata.failure_code
    : null
  return Object.freeze({
    id: uuid(row.id, 'publish_unavailable'),
    store_id: uuid(row.store_id, 'publish_unavailable'),
    product_id: uuid(row.product_id, 'publish_unavailable'),
    status: row.status,
    expected_price: price(String(row.expected_price), 'publish_unavailable'),
    requested_price: price(String(row.requested_price), 'publish_unavailable'),
    created_at: timestamp(row.created_at),
    completed_at: timestamp(row.completed_at, true),
    failed_at: timestamp(row.failed_at, true),
    failure_code: failureCode,
  })
}

export async function getCommanderPriceJob({ client, userId, storeId, jobId } = {}) {
  if (!client || typeof client.from !== 'function') fail('publish_unavailable')
  uuid(userId, 'unauthorized')
  const normalizedStoreId = uuid(storeId, 'invalid_store')
  const normalizedJobId = uuid(jobId, 'invalid_job')

  const { data: store, error: storeError } = await client
    .from('stores')
    .select('id')
    .eq('id', normalizedStoreId)
    .eq('owner_id', userId)
    .maybeSingle()
  if (storeError) fail('publish_unavailable')
  if (!store) fail('forbidden')

  const { data, error } = await client
    .from('pos_publish_jobs')
    .select('id, store_id, product_id, status, expected_price, requested_price, created_at, completed_at, failed_at, audit_metadata')
    .eq('id', normalizedJobId)
    .eq('store_id', normalizedStoreId)
    .maybeSingle()
  if (error) fail('publish_unavailable')
  if (!data) fail('job_not_found')
  return normalizeJobRow(data)
}

export async function listCommanderPriceIdentities({ client, userId, storeId } = {}) {
  if (!client || typeof client.from !== 'function') fail('publish_unavailable')
  uuid(userId, 'unauthorized')
  const normalizedStoreId = uuid(storeId, 'invalid_store')
  const { data: store, error: storeError } = await client
    .from('stores')
    .select('id')
    .eq('id', normalizedStoreId)
    .eq('owner_id', userId)
    .maybeSingle()
  if (storeError) fail('publish_unavailable')
  if (!store) fail('forbidden')

  const { data, error } = await client
    .from('product_source_identities')
    .select('product_id, source_product_key, source_upc, source_modifier')
    .eq('store_id', normalizedStoreId)
    .eq('source_system', COMMANDER_SOURCE_SYSTEM)
    .order('source_product_key', { ascending: true })
    .limit(MAX_IDENTITIES)
  if (error || !Array.isArray(data)) fail('publish_unavailable')

  const seen = new Set()
  return Object.freeze(data.map((row) => {
    if (!isRecord(row) || !exactKeys(row, ['product_id', 'source_product_key', 'source_upc', 'source_modifier'])) fail('publish_unavailable')
    const productId = uuid(row.product_id, 'publish_unavailable')
    if (typeof row.source_upc !== 'string' || !/^\d{14}$/.test(row.source_upc)
      || typeof row.source_modifier !== 'string' || !/^\d{3}$/.test(row.source_modifier)
      || row.source_product_key !== `${row.source_upc}/${row.source_modifier}`) {
      fail('publish_unavailable')
    }
    if (seen.has(row.source_product_key)) fail('publish_unavailable')
    seen.add(row.source_product_key)
    return Object.freeze({ product_id: productId, source_product_key: row.source_product_key })
  }))
}

// Compatibility aliases keep any in-flight client bundle on the same bounded path.
export const CONTROLLED_COMMANDER_ACTIVE_STATUSES = COMMANDER_PRICE_ACTIVE_STATUSES
export const ControlledCommanderPricePublishError = CommanderPricePublishError
export const normalizeControlledCommanderPriceRequest = normalizeCommanderPriceRequest
export const readBoundedControlledPriceJson = readBoundedCommanderPriceJson
export const requestControlledCommanderPriceUpdate = requestCommanderPriceUpdate
export const getControlledCommanderPriceJob = getCommanderPriceJob
