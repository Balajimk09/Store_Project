const JOB_STATUSES = new Set([
  'pending',
  'claimed',
  'sending',
  'verifying',
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
  'source_identity_missing',
  'stale_expected_price',
])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PRICE = /^(?:0|[1-9]\d*)\.\d{2}$/
const PCODE = /^\d{1,16}$/
const SYSID = /^\d{1,16}$/
const SELLING_UNIT = /^(?:0|[1-9]\d{0,5})\.\d{3}$/
const QUANTITY = /^(?:0|[1-9]\d{0,5})\.\d{2}$/
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{16,128}$/
const MAX_BODY_BYTES = 8192
const MAX_SYSIDS = 16
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u
const COMMANDER_SOURCE_SYSTEM = 'commander'
const NATIVE_SIMPLE_CREATE_V1_PROFILE = 'native_simple_create_v1'

export class CommanderProductPublishError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function fail(code) {
  throw new CommanderProductPublishError(code)
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

function fixedDecimal(value, pattern, code) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(code)
  return value
}

function description(value, code) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512 || CONTROL.test(value)) fail(code)
  return value.normalize('NFC')
}

function departmentKey(value, code) {
  if (typeof value !== 'string' || !SYSID.test(value)) fail(code)
  return value
}

function departmentName(value, code, nullable = false) {
  if (nullable && value === null) return null
  if (typeof value !== 'string') fail(code)
  const normalized = value.trim().normalize('NFC')
  if (normalized.length < 1 || normalized.length > 256 || CONTROL.test(normalized)) fail(code)
  return normalized
}

function sysid(value, code) {
  if (typeof value !== 'string' || !SYSID.test(value)) fail(code)
  return value
}

function sysidArray(value, code) {
  if (!Array.isArray(value) || value.length > MAX_SYSIDS) fail(code)
  const values = value.map((entry) => sysid(entry, code))
  if (new Set(values).size !== values.length) fail(code)
  return Object.freeze(values)
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

export function normalizeCommanderProductRequest(value) {
  const keys = [
    'store_id',
    'product_id',
    'requested_description',
    'requested_department',
    'requested_price',
    'requested_payment_product_code',
    'requested_selling_unit',
    'requested_max_qty_per_trans',
    'requested_taxable_rebate',
    'requested_tax_category_id',
    'requested_age_restriction_id',
    'idempotency_key',
  ]
  if (!exactKeys(value, keys)) fail('invalid_request')
  if (typeof value.idempotency_key !== 'string' || !IDEMPOTENCY.test(value.idempotency_key)) fail('invalid_request')

  return Object.freeze({
    storeId: uuid(value.store_id, 'invalid_store'),
    productId: uuid(value.product_id, 'invalid_product'),
    requestedDescription: description(value.requested_description, 'invalid_product'),
    requestedDepartment: departmentName(value.requested_department, 'invalid_product', true),
    requestedPrice: price(value.requested_price, 'invalid_price'),
    requestedPaymentProductCode: sysid(value.requested_payment_product_code, 'invalid_product'),
    requestedSellingUnit: fixedDecimal(value.requested_selling_unit, SELLING_UNIT, 'invalid_product'),
    requestedMaxQtyPerTrans: fixedDecimal(value.requested_max_qty_per_trans, QUANTITY, 'invalid_product'),
    requestedTaxableRebate: fixedDecimal(value.requested_taxable_rebate, QUANTITY, 'invalid_product'),
    requestedTaxCategoryId: value.requested_tax_category_id === null
      ? null
      : uuid(value.requested_tax_category_id, 'invalid_product'),
    requestedAgeRestrictionId: value.requested_age_restriction_id === null
      ? null
      : uuid(value.requested_age_restriction_id, 'invalid_product'),
    idempotencyKey: value.idempotency_key,
  })
}

export async function readBoundedCommanderProductJson(request) {
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

async function requireOwnedStore(client, userId, storeId) {
  const { data: store, error: storeError } = await client
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', userId)
    .maybeSingle()
  if (storeError) fail('publish_unavailable')
  if (!store) fail('forbidden')
}

function contextPrice(value) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/.exec(text)
  if (!match) fail('publish_unavailable')
  const whole = Number(match[1])
  const fraction = match[2] ?? ''
  if (!Number.isSafeInteger(whole) || whole > 999999 || /[1-9]/.test(fraction.slice(2))) fail('publish_unavailable')
  return `${whole}.${(fraction.slice(0, 2) + '00').slice(0, 2)}`
}

function storedJobPrice(value) {
  const normalized = contextPrice(value)
  if (normalized === '0.00') fail('publish_unavailable')
  return normalized
}

export async function getCommanderProductContext({ client, userId, storeId, productId } = {}) {
  if (!client || typeof client.rpc !== 'function') fail('publish_unavailable')
  uuid(userId, 'unauthorized')
  const normalizedStoreId = uuid(storeId, 'invalid_store')
  const normalizedProductId = uuid(productId, 'invalid_product')
  const { data, error } = await client.rpc('get_commander_full_product_context', {
    p_store_id: normalizedStoreId,
    p_product_id: normalizedProductId,
  })
  if (error) {
    if (typeof error.code === 'string' && error.code === '42501') fail('forbidden')
    fail('publish_unavailable')
  }
  const rows = Array.isArray(data) ? data : data === null ? [] : [data]
  if (rows.length === 0) return null
  if (rows.length !== 1) fail('publish_unavailable')
  const context = rows[0]
  const keys = [
    'product_id',
    'source_product_key',
    'source_upc',
    'source_modifier',
    'commander_description',
    'commander_department_key',
    'commander_department_name',
    'commander_price',
    'commander_payment_product_code',
    'commander_selling_unit',
    'commander_max_qty_per_trans',
    'commander_taxable_rebate',
    'commander_tax_rate_ids',
    'commander_id_check_ids',
    'commander_flag_ids',
    'canonical_description',
    'canonical_department',
    'canonical_price',
    'observed_at',
  ]
  if (
    !exactKeys(context, keys)
    || uuid(context.product_id, 'publish_unavailable') !== normalizedProductId
    || typeof context.source_upc !== 'string' || !/^\d{14}$/.test(context.source_upc)
    || typeof context.source_modifier !== 'string' || !/^\d{3}$/.test(context.source_modifier)
    || context.source_product_key !== `${context.source_upc}/${context.source_modifier}`
  ) fail('publish_unavailable')

  return Object.freeze({
    product_id: normalizedProductId,
    source_product_key: context.source_product_key,
    source_upc: context.source_upc,
    source_modifier: context.source_modifier,
    commander_description: description(context.commander_description, 'publish_unavailable'),
    commander_department_key: departmentKey(context.commander_department_key, 'publish_unavailable'),
    commander_department_name: context.commander_department_name === null ? null : departmentName(context.commander_department_name, 'publish_unavailable'),
    commander_price: contextPrice(context.commander_price),
    commander_payment_product_code: sysid(context.commander_payment_product_code, 'publish_unavailable'),
    commander_selling_unit: fixedDecimal(context.commander_selling_unit, SELLING_UNIT, 'publish_unavailable'),
    commander_max_qty_per_trans: fixedDecimal(context.commander_max_qty_per_trans, QUANTITY, 'publish_unavailable'),
    commander_taxable_rebate: fixedDecimal(context.commander_taxable_rebate, QUANTITY, 'publish_unavailable'),
    commander_tax_rate_ids: sysidArray(context.commander_tax_rate_ids, 'publish_unavailable'),
    commander_id_check_ids: sysidArray(context.commander_id_check_ids, 'publish_unavailable'),
    commander_flag_ids: sysidArray(context.commander_flag_ids, 'publish_unavailable'),
    canonical_description: description(context.canonical_description, 'publish_unavailable'),
    canonical_department: context.canonical_department === null ? null : departmentName(context.canonical_department, 'publish_unavailable'),
    canonical_price: contextPrice(context.canonical_price),
    observed_at: timestamp(context.observed_at),
  })
}

async function getCurrentCommanderMasterDataRun(client, storeId) {
  const { data, error } = await client
    .from('pos_catalog_source_master_data_runs')
    .select('id')
    .eq('store_id', storeId)
    .eq('source_system', COMMANDER_SOURCE_SYSTEM)
    .order('collected_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) fail('master_data_mapping_unavailable')
  if (!data || !isRecord(data)) fail('master_data_mapping_unavailable')
  return uuid(data.id, 'master_data_mapping_unavailable')
}

async function resolveMappedCommanderIds({ client, storeId, currentRunId, canonicalId, entityType, canonicalColumn, sourceTable, sourceColumn } = {}) {
  if (canonicalId === null) return Object.freeze([])
  const normalizedRunId = currentRunId ?? await getCurrentCommanderMasterDataRun(client, storeId)
  const { data: mappings, error: mappingError } = await client
    .from('pos_catalog_source_master_data_mappings')
    .select('source_key')
    .eq('store_id', storeId)
    .eq('source_system', COMMANDER_SOURCE_SYSTEM)
    .eq('entity_type', entityType)
    .eq('source_context_key', '')
    .eq('status', 'mapped')
    .eq(canonicalColumn, canonicalId)
  if (mappingError || !Array.isArray(mappings)) fail('master_data_mapping_unavailable')
  const mappingKeys = [...new Set(mappings.map((mapping) => {
    if (!isRecord(mapping)) fail('master_data_mapping_unavailable')
    return sysid(mapping.source_key, 'master_data_mapping_unavailable')
  }))]
  if (mappingKeys.length === 0) fail('master_data_mapping_unavailable')

  const { data: currentRows, error: sourceError } = await client
    .from(sourceTable)
    .select(sourceColumn)
    .eq('store_id', storeId)
    .eq('source_system', COMMANDER_SOURCE_SYSTEM)
    .eq('last_master_data_run_id', normalizedRunId)
    .eq('is_present', true)
    .in(sourceColumn, mappingKeys)
  if (sourceError || !Array.isArray(currentRows)) fail('master_data_mapping_unavailable')
  const currentKeys = [...new Set(currentRows.map((row) => {
    if (!isRecord(row)) fail('master_data_mapping_unavailable')
    return sysid(row[sourceColumn], 'master_data_mapping_unavailable')
  }))]
  if (currentKeys.length === 0) fail('master_data_mapping_unavailable')
  if (currentKeys.length !== 1) fail('master_data_mapping_ambiguous')
  return Object.freeze(currentKeys)
}

async function resolveCurrentCommanderProductCode({ client, storeId, currentRunId, sourceKey } = {}) {
  const normalizedSourceKey = sysid(sourceKey, 'invalid_product')
  const { data, error } = await client
    .from('pos_catalog_source_product_codes')
    .select('source_product_code_key')
    .eq('store_id', storeId)
    .eq('source_system', COMMANDER_SOURCE_SYSTEM)
    .eq('last_master_data_run_id', currentRunId)
    .eq('is_present', true)
    .eq('source_product_code_key', normalizedSourceKey)
    .limit(2)
  if (error || !Array.isArray(data)) fail('master_data_mapping_unavailable')
  const keys = [...new Set(data.map((row) => {
    if (!isRecord(row)) fail('master_data_mapping_unavailable')
    return sysid(row.source_product_code_key, 'master_data_mapping_unavailable')
  }))]
  if (keys.length === 0) fail('master_data_mapping_unavailable')
  if (keys.length !== 1) fail('master_data_mapping_ambiguous')
  return keys[0]
}

async function resolveCommanderCreateDepartment({ client, storeId, department } = {}) {
  const normalizedDepartment = departmentName(department, 'master_data_mapping_unavailable')
  const currentRunId = await getCurrentCommanderMasterDataRun(client, storeId)
  const { data: departments, error: departmentError } = await client
    .from('store_departments')
    .select('id')
    .eq('store_id', storeId)
    .eq('name', normalizedDepartment)
    .limit(2)
  if (departmentError || !Array.isArray(departments) || departments.length === 0) fail('master_data_mapping_unavailable')
  if (departments.length !== 1 || !isRecord(departments[0])) fail('master_data_mapping_ambiguous')
  const canonicalDepartmentId = uuid(departments[0].id, 'master_data_mapping_unavailable')

  const { data: mappings, error: mappingError } = await client
    .from('pos_catalog_source_master_data_mappings')
    .select('source_key')
    .eq('store_id', storeId)
    .eq('source_system', COMMANDER_SOURCE_SYSTEM)
    .eq('entity_type', 'department')
    .eq('source_context_key', '')
    .eq('status', 'mapped')
    .eq('canonical_department_id', canonicalDepartmentId)
    .limit(2)
  if (mappingError || !Array.isArray(mappings) || mappings.length === 0) fail('master_data_mapping_unavailable')
  const sourceDepartmentKeys = [...new Set(mappings.map((mapping) => {
    if (!isRecord(mapping)) fail('master_data_mapping_unavailable')
    return departmentKey(mapping.source_key, 'master_data_mapping_unavailable')
  }))]
  if (sourceDepartmentKeys.length !== 1) fail('master_data_mapping_ambiguous')

  const { data: definitions, error: definitionError } = await client
    .from('pos_catalog_source_department_definitions')
    .select('source_department_key,source_product_code_key,source_values')
    .eq('store_id', storeId)
    .eq('source_system', COMMANDER_SOURCE_SYSTEM)
    .eq('last_master_data_run_id', currentRunId)
    .eq('is_present', true)
    .eq('source_department_key', sourceDepartmentKeys[0])
    .limit(2)
  if (definitionError || !Array.isArray(definitions) || definitions.length === 0) fail('master_data_mapping_unavailable')
  if (definitions.length !== 1 || !isRecord(definitions[0]) || !isRecord(definitions[0].source_values)) {
    fail('master_data_mapping_ambiguous')
  }
  const definition = definitions[0]
  if (departmentKey(definition.source_department_key, 'master_data_mapping_unavailable') !== sourceDepartmentKeys[0]) {
    fail('master_data_mapping_unavailable')
  }
  const paymentProductCode = await resolveCurrentCommanderProductCode({
    client,
    storeId,
    currentRunId,
    sourceKey: definition.source_product_code_key,
  })
  return Object.freeze({
    paymentProductCode,
    maxQtyPerTrans: fixedDecimal(
      definition.source_values.maximum_quantity_per_transaction,
      QUANTITY,
      'master_data_mapping_unavailable',
    ),
  })
}

async function resolveCommanderCreateDefaults({ privilegedClient, storeId } = {}) {
  const { data, error } = await privilegedClient
    .from('pos_source_create_profiles')
    .select('create_profile_version')
    .eq('store_id', storeId)
    .eq('source_system', COMMANDER_SOURCE_SYSTEM)
    .maybeSingle()
  if (error) fail('publish_unavailable')
  if (!isRecord(data)) fail('commander_create_profile_missing')
  if (data.create_profile_version !== NATIVE_SIMPLE_CREATE_V1_PROFILE) fail('commander_create_profile_invalid')
  return Object.freeze({
    modifier: '000',
    sellingUnit: '1.000',
    taxableRebate: '0.00',
  })
}

export async function resolveCommanderProductMasterData({ client, storeId, paymentProductCode, taxCategoryId, ageRestrictionId } = {}) {
  if (!client || typeof client.from !== 'function') fail('publish_unavailable')
  const normalizedStoreId = uuid(storeId, 'invalid_store')
  const normalizedPaymentProductCode = sysid(paymentProductCode, 'invalid_product')
  const normalizedTaxCategoryId = taxCategoryId === null ? null : uuid(taxCategoryId, 'invalid_product')
  const normalizedAgeRestrictionId = ageRestrictionId === null ? null : uuid(ageRestrictionId, 'invalid_product')
  const currentRunId = await getCurrentCommanderMasterDataRun(client, normalizedStoreId)
  const [resolvedPaymentProductCode, taxRateIds, idCheckIds] = await Promise.all([
    resolveCurrentCommanderProductCode({
      client,
      storeId: normalizedStoreId,
      currentRunId,
      sourceKey: normalizedPaymentProductCode,
    }),
    resolveMappedCommanderIds({
      client,
      storeId: normalizedStoreId,
      currentRunId,
      canonicalId: normalizedTaxCategoryId,
      entityType: 'tax',
      canonicalColumn: 'canonical_tax_category_id',
      sourceTable: 'pos_catalog_source_tax_definitions',
      sourceColumn: 'source_tax_key',
    }),
    resolveMappedCommanderIds({
      client,
      storeId: normalizedStoreId,
      currentRunId,
      canonicalId: normalizedAgeRestrictionId,
      entityType: 'age_validation',
      canonicalColumn: 'canonical_age_restriction_id',
      sourceTable: 'pos_catalog_source_age_validations',
      sourceColumn: 'source_age_validation_key',
    }),
  ])
  return Object.freeze({ paymentProductCode: resolvedPaymentProductCode, taxRateIds, idCheckIds })
}

export async function requestCommanderProductUpdate({ client, userId, input } = {}) {
  if (!client || typeof client.rpc !== 'function') fail('publish_unavailable')
  const normalizedUserId = uuid(userId, 'unauthorized')
  const request = normalizeCommanderProductRequest(input)

  const context = await getCommanderProductContext({
    client,
    userId: normalizedUserId,
    storeId: request.storeId,
    productId: request.productId,
  })
  if (!context) fail('publish_unavailable')
  const masterData = await resolveCommanderProductMasterData({
    client,
    storeId: request.storeId,
    paymentProductCode: request.requestedPaymentProductCode,
    taxCategoryId: request.requestedTaxCategoryId,
    ageRestrictionId: request.requestedAgeRestrictionId,
  })
  if (
    context.commander_description === request.requestedDescription
    && request.requestedDepartment === null
    && context.commander_price === request.requestedPrice
    && context.commander_payment_product_code === request.requestedPaymentProductCode
    && context.commander_selling_unit === request.requestedSellingUnit
    && context.commander_max_qty_per_trans === request.requestedMaxQtyPerTrans
    && context.commander_taxable_rebate === request.requestedTaxableRebate
    && context.commander_tax_rate_ids.join('\u0000') === masterData.taxRateIds.join('\u0000')
    && context.commander_id_check_ids.join('\u0000') === masterData.idCheckIds.join('\u0000')
  ) fail('product_unchanged')

  const { data, error } = await client.rpc('request_commander_product_update', {
    p_store_id: request.storeId,
    p_product_id: request.productId,
    p_expected_description: context.commander_description,
    p_requested_description: request.requestedDescription,
    p_expected_department: context.commander_department_key,
    p_requested_department_name: request.requestedDepartment,
    p_expected_price: context.commander_price,
    p_requested_price: request.requestedPrice,
    p_expected_payment_product_code: context.commander_payment_product_code,
    p_requested_payment_product_code: masterData.paymentProductCode,
    p_expected_selling_unit: context.commander_selling_unit,
    p_requested_selling_unit: request.requestedSellingUnit,
    p_expected_max_qty_per_trans: context.commander_max_qty_per_trans,
    p_requested_max_qty_per_trans: request.requestedMaxQtyPerTrans,
    p_expected_taxable_rebate: context.commander_taxable_rebate,
    p_requested_taxable_rebate: request.requestedTaxableRebate,
    p_expected_tax_rate_ids: context.commander_tax_rate_ids,
    p_requested_tax_rate_ids: masterData.taxRateIds,
    p_expected_id_check_ids: context.commander_id_check_ids,
    p_requested_id_check_ids: masterData.idCheckIds,
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

function canonicalCreateProduct(row) {
  if (!isRecord(row)) fail('commander_create_payload_invalid')
  const keys = ['id', 'store_id', 'upc', 'item_name', 'department', 'selling_price']
  if (keys.some((key) => !Object.hasOwn(row, key))) fail('commander_create_payload_invalid')
  if (typeof row.upc !== 'string' || !/^\d{14}$/.test(row.upc)) fail('commander_create_payload_invalid')
  return Object.freeze({
    id: uuid(row.id, 'commander_create_payload_invalid'),
    storeId: uuid(row.store_id, 'commander_create_payload_invalid'),
    upc: row.upc,
    description: description(row.item_name, 'commander_create_payload_invalid'),
    department: departmentName(row.department, 'commander_department_mapping_missing'),
    price: contextPrice(row.selling_price),
  })
}

async function loadCanonicalCreateProduct({ client, userId, storeId, productId }) {
  await requireOwnedStore(client, userId, storeId)
  const { data, error } = await client
    .from('products')
    .select('id, store_id, upc, item_name, department, selling_price')
    .eq('id', productId)
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) fail('publish_unavailable')
  if (!data) fail('invalid_product')
  return canonicalCreateProduct(data)
}

async function hasCommanderSourceIdentity({ client, storeId, productId }) {
  const { data, error } = await client
    .from('product_source_identities')
    .select('id')
    .eq('store_id', storeId)
    .eq('product_id', productId)
    .eq('source_system', COMMANDER_SOURCE_SYSTEM)
    .limit(2)
  if (error || !Array.isArray(data)) fail('publish_unavailable')
  if (data.length > 1) fail('publish_conflict')
  return data.length === 1
}

export async function hasCommanderProductSourceIdentity({ client, userId, storeId, productId } = {}) {
  if (!client || typeof client.from !== 'function') fail('publish_unavailable')
  const normalizedUserId = uuid(userId, 'unauthorized')
  const normalizedStoreId = uuid(storeId, 'invalid_store')
  const normalizedProductId = uuid(productId, 'invalid_product')
  await requireOwnedStore(client, normalizedUserId, normalizedStoreId)
  return await hasCommanderSourceIdentity({ client, storeId: normalizedStoreId, productId: normalizedProductId })
}

export function normalizeCreateRequest(value) {
  const keys = [
    'store_id',
    'product_id',
    'requested_tax_category_id',
    'requested_age_restriction_id',
    'idempotency_key',
  ]
  if (!exactKeys(value, keys)) fail('invalid_request')
  if (typeof value.idempotency_key !== 'string' || !IDEMPOTENCY.test(value.idempotency_key)) fail('invalid_request')

  return Object.freeze({
    storeId: uuid(value.store_id, 'invalid_store'),
    productId: uuid(value.product_id, 'invalid_product'),
    requestedTaxCategoryId: value.requested_tax_category_id === null
      ? null
      : uuid(value.requested_tax_category_id, 'invalid_product'),
    requestedAgeRestrictionId: value.requested_age_restriction_id === null
      ? null
      : uuid(value.requested_age_restriction_id, 'invalid_product'),
    idempotencyKey: value.idempotency_key,
  })
}

/** Queues only a server-resolved Commander native-simple-create job. */
export async function requestCommanderProductCreate({ client, privilegedClient, userId, input } = {}) {
  if (!client || typeof client.rpc !== 'function' || typeof client.from !== 'function') fail('publish_unavailable')
  if (!privilegedClient || typeof privilegedClient.rpc !== 'function' || typeof privilegedClient.from !== 'function') fail('publish_unavailable')
  const normalizedUserId = uuid(userId, 'unauthorized')
  const request = normalizeCreateRequest(input)
  const [product, linked] = await Promise.all([
    loadCanonicalCreateProduct({ client, userId: normalizedUserId, storeId: request.storeId, productId: request.productId }),
    hasCommanderSourceIdentity({ client, storeId: request.storeId, productId: request.productId }),
  ])
  if (product.id !== request.productId || product.storeId !== request.storeId) fail('invalid_product')
  if (linked) fail('publish_conflict')
  const department = await resolveCommanderCreateDepartment({
    client,
    storeId: request.storeId,
    department: product.department,
  })
  const createDefaults = await resolveCommanderCreateDefaults({ privilegedClient, storeId: request.storeId })
  const masterData = await resolveCommanderProductMasterData({
    client,
    storeId: request.storeId,
    paymentProductCode: department.paymentProductCode,
    taxCategoryId: request.requestedTaxCategoryId,
    ageRestrictionId: request.requestedAgeRestrictionId,
  })
  const { data, error } = await privilegedClient.rpc('request_commander_product_create', {
    p_store_id: request.storeId,
    p_requested_by: normalizedUserId,
    p_product_id: request.productId,
    p_upc: product.upc,
    p_modifier: createDefaults.modifier,
    p_description: product.description,
    p_price: product.price,
    p_department_name: product.department,
    p_payment_product_code: masterData.paymentProductCode,
    p_selling_unit: createDefaults.sellingUnit,
    p_max_qty_per_trans: department.maxQtyPerTrans,
    p_taxable_rebate: createDefaults.taxableRebate,
    p_tax_rate_ids: masterData.taxRateIds,
    p_id_check_ids: masterData.idCheckIds,
    p_idempotency_key: request.idempotencyKey,
  })
  if (error) {
    const code = typeof error.code === 'string' ? error.code : ''
    const message = typeof error.message === 'string' ? error.message : ''
    if (code === '42501') fail('forbidden')
    if (code === '23505') fail('publish_already_active')
    if (code === '22023' || code === '23514') {
      fail(
        message === 'commander_create_profile_missing'
          ? 'commander_create_profile_missing'
          : message === 'commander_create_profile_invalid'
            ? 'commander_create_profile_invalid'
            : message === 'commander_department_mapping_missing'
              ? 'master_data_mapping_unavailable'
              : message === 'commander_department_mapping_ambiguous'
                ? 'master_data_mapping_ambiguous'
                : 'commander_create_payload_invalid',
      )
    }
    fail('publish_unavailable')
  }
  const row = Array.isArray(data) ? data[0] : data
  return normalizeRequestedJob(row)
}

export async function getCommanderProductJob({ client, userId, storeId, jobId } = {}) {
  if (!client || typeof client.from !== 'function') fail('publish_unavailable')
  uuid(userId, 'unauthorized')
  const normalizedStoreId = uuid(storeId, 'invalid_store')
  const normalizedJobId = uuid(jobId, 'invalid_job')
  await requireOwnedStore(client, userId, normalizedStoreId)

  const { data, error } = await client
    .from('pos_publish_jobs')
    .select('id, store_id, product_id, operation, status, expected_price, requested_price, created_at, completed_at, failed_at, audit_metadata')
    .eq('id', normalizedJobId)
    .eq('store_id', normalizedStoreId)
    .maybeSingle()
  if (error) fail('publish_unavailable')
  if (!data || !isRecord(data)) fail('job_not_found')
  if (data.operation !== 'update_product' && data.operation !== 'create_product') fail('job_not_found')
  const metadata = isRecord(data.audit_metadata) ? data.audit_metadata : {}
  const failureCode = typeof metadata.failure_code === 'string' && FAILURE_CODES.has(metadata.failure_code) ? metadata.failure_code : null
  return Object.freeze({
    id: uuid(data.id, 'publish_unavailable'),
    status: (() => {
      if (!JOB_STATUSES.has(data.status)) fail('publish_unavailable')
      return data.status
    })(),
    expected_price: storedJobPrice(data.expected_price),
    requested_price: storedJobPrice(data.requested_price),
    created_at: timestamp(data.created_at),
    completed_at: timestamp(data.completed_at, true),
    failed_at: timestamp(data.failed_at, true),
    failure_code: failureCode,
    operation: data.operation,
  })
}
