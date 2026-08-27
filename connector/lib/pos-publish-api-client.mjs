import { PUBLISH_FAILURE_CODES, PosPublishError, assertFailureCode, safeFailureMessage } from './pos-publish-errors.mjs'

const CLAIM_PATH = '/functions/v1/claim-pos-publish-job'
const REPORT_PATH = '/functions/v1/report-pos-publish-job-status'
const MAX_RESPONSE_BYTES = 64 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PRICE_PATTERN = /^(?:0|[1-9]\d*)\.\d{2}$/
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=[A-Za-z0-9._-]+)?$/i
const HTTP_LOOPBACK_URL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?\/?$/i
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const NO_CONTENT = Symbol('no_content')

export const CANONICAL_UPC_LENGTH = 14
const CANONICAL_UPC_PATTERN = /^[0-9]{14}$/

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function assertSafeRecord(value, keys, code) {
  if (!isPlainRecord(value)) throw new PosPublishError(code)
  const received = Object.keys(value)
  if (received.some((key) => DANGEROUS_KEYS.has(key)) || received.length !== keys.length || received.some((key) => !keys.includes(key))) {
    throw new PosPublishError(code)
  }
}

function assertUuid(value, code) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new PosPublishError(code)
  return value.toLowerCase()
}

export function assertCanonicalUpc(value, code = 'api_response_invalid') {
  if (typeof value !== 'string' || !CANONICAL_UPC_PATTERN.test(value)) {
    throw new PosPublishError(code)
  }
  return value
}

export function assertDecimalPrice(value, code = 'api_response_invalid') {
  if (typeof value !== 'string' || !PRICE_PATTERN.test(value) || !Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 999999.99) {
    throw new PosPublishError(code)
  }
  return value
}

function assertDescription(value, code = 'api_response_invalid') {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new PosPublishError(code)
  }
  return value
}

function assertDepartment(value, code = 'api_response_invalid') {
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value)) throw new PosPublishError(code)
  return value
}

function assertModifier(value, code = 'api_response_invalid') {
  if (
    typeof value !== 'string'
    || !/^\d{3}$/.test(value)
  ) {
    throw new PosPublishError(code)
  }

  return value
}

export function assertRfc3339Timestamp(value, code = 'api_response_invalid') {
  if (typeof value !== 'string') throw new PosPublishError(code)
  const match = RFC3339_PATTERN.exec(value)
  if (!match) throw new PosPublishError(code)
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
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 || offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0) || !Number.isFinite(Date.parse(value))) {
    throw new PosPublishError(code)
  }
  return value
}

function assertBaseUrl(value) {
  if (typeof value !== 'string') throw new PosPublishError('api_url_invalid')
  let url
  try { url = new URL(value) } catch { throw new PosPublishError('api_url_invalid') }
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new PosPublishError('api_url_invalid')
  if (url.protocol === 'http:') {
    const literal = HTTP_LOOPBACK_URL.exec(value)
    if (!literal || (literal[2] !== undefined && (Number(literal[2]) < 1 || Number(literal[2]) > 65535))) {
      throw new PosPublishError('api_url_invalid')
    }
    return url
  }
  if (url.protocol !== 'https:') throw new PosPublishError('api_url_invalid')
  return url
}

function assertJsonResponse(response) {
  const contentType = response.headers?.get('content-type')?.trim() ?? ''
  if (!JSON_CONTENT_TYPE.test(contentType)) throw new PosPublishError('api_response_invalid')
}

async function readBoundedJson(response, maxBytes) {
  assertJsonResponse(response)
  const contentLength = response.headers?.get('content-length')
  if (contentLength !== null && contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)) || Number(contentLength) > maxBytes) {
      throw new PosPublishError(contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes ? 'api_response_too_large' : 'api_response_invalid')
    }
  }
  if (!response.body) throw new PosPublishError('api_response_invalid')
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        try { await reader.cancel() } catch {}
        throw new PosPublishError('api_response_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (total === 0) throw new PosPublishError('api_response_invalid')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new PosPublishError('api_response_invalid') }
}


function assertProductSysid(
  value,
  code = 'api_response_invalid',
) {
  if (
    typeof value !== 'string'
    || !/^\d{1,16}$/.test(value)
  ) {
    throw new PosPublishError(code)
  }

  return value
}

function assertProductDecimal(
  value,
  fractionDigits,
  code = 'api_response_invalid',
) {
  if (typeof value !== 'string') {
    throw new PosPublishError(code)
  }

  const pattern =
    new RegExp(
      `^(?:0|[1-9]\\d{0,5})(?:\\.\\d{1,${fractionDigits}})?$`,
    )

  if (!pattern.test(value)) {
    throw new PosPublishError(code)
  }

  const amount = Number(value)

  if (
    !Number.isFinite(amount)
    || amount < 0
  ) {
    throw new PosPublishError(code)
  }

  return amount.toFixed(
    fractionDigits,
  )
}

function assertProductMoneyAllowZero(
  value,
  code = 'api_response_invalid',
) {
  if (
    typeof value !== 'string'
    || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)
  ) {
    throw new PosPublishError(code)
  }

  const amount = Number(value)

  if (
    !Number.isFinite(amount)
    || amount < 0
    || amount > 999999.99
  ) {
    throw new PosPublishError(code)
  }

  return amount.toFixed(2)
}

function assertProductSysidList(
  value,
  code = 'api_response_invalid',
) {
  if (
    !Array.isArray(value)
    || value.length > 16
  ) {
    throw new PosPublishError(code)
  }

  const result =
    value.map(
      item =>
        assertProductSysid(
          item,
          code,
        ),
    )

  if (
    new Set(result).size
    !== result.length
  ) {
    throw new PosPublishError(code)
  }

  return result
}

function sameProductContractValue(
  left,
  right,
) {
  if (
    Array.isArray(left)
    || Array.isArray(right)
  ) {
    return (
      Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every(
        (item, index) =>
          item === right[index],
      )
    )
  }

  return left === right
}

export function validateClaimResponse(value) {
  if (isPlainRecord(value) && value.operation === 'create_product') {
    const keys = ['job_id', 'operation', 'product_id', 'upc', 'modifier', 'description', 'department', 'price', 'payment_product_code', 'selling_unit', 'max_qty_per_trans', 'taxable_rebate', 'tax_rate_ids', 'id_check_ids', 'flag_ids', 'attempt', 'claimed_at']
    assertSafeRecord(value, keys, 'api_response_invalid')
    const result = {
      job_id: assertUuid(value.job_id, 'api_response_invalid'), operation: 'create_product', product_id: assertUuid(value.product_id, 'api_response_invalid'),
      upc: assertCanonicalUpc(value.upc), modifier: assertModifier(value.modifier), description: assertDescription(value.description), department: assertDepartment(value.department),
      price: assertDecimalPrice(value.price), payment_product_code: assertProductSysid(value.payment_product_code), selling_unit: assertProductDecimal(value.selling_unit, 3),
      max_qty_per_trans: assertProductDecimal(value.max_qty_per_trans, 2), taxable_rebate: assertProductMoneyAllowZero(value.taxable_rebate),
      tax_rate_ids: assertProductSysidList(value.tax_rate_ids), id_check_ids: assertProductSysidList(value.id_check_ids), flag_ids: assertProductSysidList(value.flag_ids),
      attempt: value.attempt, claimed_at: assertRfc3339Timestamp(value.claimed_at),
    }
    if (!Number.isSafeInteger(result.attempt) || result.attempt < 1 || result.tax_rate_ids.length === 0 || result.id_check_ids.length === 0 || result.flag_ids.length === 0) throw new PosPublishError('api_response_invalid')
    return result
  }
  const legacyKeys = [
    'job_id',
    'operation',
    'product_id',
    'upc',
    'modifier',
    'expected_price',
    'price',
    'attempt',
    'claimed_at',
  ]

  const productV1Keys = [
    'job_id',
    'operation',
    'product_id',
    'upc',
    'modifier',
    'expected_description',
    'description',
    'expected_department',
    'department',
    'expected_price',
    'price',
    'attempt',
    'claimed_at',
  ]

  const productV2Keys = [
    'job_id',
    'operation',
    'product_id',
    'upc',
    'modifier',

    'expected_description',
    'description',

    'expected_department',
    'department',

    'expected_price',
    'price',

    'expected_payment_product_code',
    'payment_product_code',

    'expected_selling_unit',
    'selling_unit',

    'expected_max_qty_per_trans',
    'max_qty_per_trans',

    'expected_taxable_rebate',
    'taxable_rebate',

    'expected_tax_rate_ids',
    'tax_rate_ids',

    'expected_id_check_ids',
    'id_check_ids',

    'attempt',
    'claimed_at',
  ]

  if (!isPlainRecord(value)) {
    throw new PosPublishError(
      'api_response_invalid',
    )
  }

  const received =
    Object.keys(value)

  const exactShape = expected =>
    received.length === expected.length
    && received.every(
      key => expected.includes(key),
    )

  const legacy =
    exactShape(legacyKeys)

  const productV1 =
    exactShape(productV1Keys)

  const productV2 =
    exactShape(productV2Keys)

  if (
    !legacy
    && !productV1
    && !productV2
  ) {
    throw new PosPublishError(
      'api_response_invalid',
    )
  }

  const base = {
    job_id:
      assertUuid(
        value.job_id,
        'api_response_invalid',
      ),

    operation:
      value.operation,

    product_id:
      assertUuid(
        value.product_id,
        'api_response_invalid',
      ),

    upc:
      assertCanonicalUpc(
        value.upc,
      ),

    modifier:
      assertModifier(
        value.modifier,
      ),

    expected_price:
      assertDecimalPrice(
        value.expected_price,
      ),

    price:
      assertDecimalPrice(
        value.price,
      ),

    attempt:
      value.attempt,

    claimed_at:
      assertRfc3339Timestamp(
        value.claimed_at,
      ),
  }

  if (
    !Number.isSafeInteger(base.attempt)
    || base.attempt < 1
  ) {
    throw new PosPublishError(
      'api_response_invalid',
    )
  }

  if (
    base.operation === 'update_price'
  ) {
    if (
      base.expected_price === base.price
    ) {
      throw new PosPublishError(
        'api_response_invalid',
      )
    }

    if (productV1) {
      const extra = [
        value.expected_description,
        value.description,
        value.expected_department,
        value.department,
      ]

      if (
        extra.some(
          item => item !== null,
        )
      ) {
        throw new PosPublishError(
          'api_response_invalid',
        )
      }
    }

    if (productV2) {
      const productFields = [
        value.expected_description,
        value.description,
        value.expected_department,
        value.department,
        value.expected_payment_product_code,
        value.payment_product_code,
        value.expected_selling_unit,
        value.selling_unit,
        value.expected_max_qty_per_trans,
        value.max_qty_per_trans,
        value.expected_taxable_rebate,
        value.taxable_rebate,
        value.expected_tax_rate_ids,
        value.tax_rate_ids,
        value.expected_id_check_ids,
        value.id_check_ids,
      ]

      if (
        productFields.some(
          item => item !== null,
        )
      ) {
        throw new PosPublishError(
          'api_response_invalid',
        )
      }
    }

    return base
  }

  if (
    base.operation === 'update_product'
    && productV1
  ) {
    const expectedDescription =
      assertDescription(
        value.expected_description,
      )

    const description =
      assertDescription(
        value.description,
      )

    const expectedDepartment =
      assertDepartment(
        value.expected_department,
      )

    const department =
      assertDepartment(
        value.department,
      )

    if (
      expectedDescription === description
      && expectedDepartment === department
      && base.expected_price === base.price
    ) {
      throw new PosPublishError(
        'api_response_invalid',
      )
    }

    return {
      ...base,

      operation:
        'update_product',

      expected_description:
        expectedDescription,

      description,

      expected_department:
        expectedDepartment,

      department,
    }
  }

  if (
    base.operation === 'update_product'
    && productV2
  ) {
    const expectedState = {
      description:
        assertDescription(
          value.expected_description,
        ),

      department:
        assertDepartment(
          value.expected_department,
        ),

      price:
        base.expected_price,

      payment_product_code:
        assertProductSysid(
          value.expected_payment_product_code,
        ),

      selling_unit:
        assertProductDecimal(
          value.expected_selling_unit,
          3,
        ),

      max_qty_per_trans:
        assertProductDecimal(
          value.expected_max_qty_per_trans,
          2,
        ),

      taxable_rebate:
        assertProductMoneyAllowZero(
          value.expected_taxable_rebate,
        ),

      tax_rate_ids:
        assertProductSysidList(
          value.expected_tax_rate_ids,
        ),

      id_check_ids:
        assertProductSysidList(
          value.expected_id_check_ids,
        ),
    }

    const requestedState = {
      description:
        assertDescription(
          value.description,
        ),

      department:
        assertDepartment(
          value.department,
        ),

      price:
        base.price,

      payment_product_code:
        assertProductSysid(
          value.payment_product_code,
        ),

      selling_unit:
        assertProductDecimal(
          value.selling_unit,
          3,
        ),

      max_qty_per_trans:
        assertProductDecimal(
          value.max_qty_per_trans,
          2,
        ),

      taxable_rebate:
        assertProductMoneyAllowZero(
          value.taxable_rebate,
        ),

      tax_rate_ids:
        assertProductSysidList(
          value.tax_rate_ids,
        ),

      id_check_ids:
        assertProductSysidList(
          value.id_check_ids,
        ),
    }

    const changed =
      Object.keys(expectedState)
        .some(
          key =>
            !sameProductContractValue(
              expectedState[key],
              requestedState[key],
            ),
        )

    if (!changed) {
      throw new PosPublishError(
        'api_response_invalid',
      )
    }

    return {
      ...base,

      operation:
        'update_product',

      expected_description:
        expectedState.description,

      description:
        requestedState.description,

      expected_department:
        expectedState.department,

      department:
        requestedState.department,

      expected_payment_product_code:
        expectedState.payment_product_code,

      payment_product_code:
        requestedState.payment_product_code,

      expected_selling_unit:
        expectedState.selling_unit,

      selling_unit:
        requestedState.selling_unit,

      expected_max_qty_per_trans:
        expectedState.max_qty_per_trans,

      max_qty_per_trans:
        requestedState.max_qty_per_trans,

      expected_taxable_rebate:
        expectedState.taxable_rebate,

      taxable_rebate:
        requestedState.taxable_rebate,

      expected_tax_rate_ids:
        expectedState.tax_rate_ids,

      tax_rate_ids:
        requestedState.tax_rate_ids,

      expected_id_check_ids:
        expectedState.id_check_ids,

      id_check_ids:
        requestedState.id_check_ids,
    }
  }

  throw new PosPublishError(
    'api_response_invalid',
  )
}

export function validateReportPayload(payload) {
  try {
    if (!isPlainRecord(payload)) {
      throw new PosPublishError(
        'report_payload_invalid',
      )
    }

    const jobId =
      assertUuid(
        payload.job_id,
        'report_payload_invalid',
      )

    const createOperation = payload.operation === 'create_product'
    if (createOperation && payload.status !== 'completed' && payload.status !== 'sending' && payload.status !== 'verifying' && payload.status !== 'failed') throw new PosPublishError('report_payload_invalid')
    if (
      payload.status === 'sending'
      || payload.status === 'verifying'
    ) {
      assertSafeRecord(
        payload,
        createOperation ? ['job_id', 'status', 'operation'] : [
          'job_id',
          'status',
        ],
        'report_payload_invalid',
      )

      return {
        job_id: jobId,
        status: payload.status,
        ...(createOperation ? { operation: 'create_product' } : {}),
      }
    }

    if (
      payload.status === 'completed'
    ) {
      assertSafeRecord(
        payload,
        createOperation ? ['job_id', 'status', 'operation', 'verification'] : [
          'job_id',
          'status',
          'verification',
        ],
        'report_payload_invalid',
      )

      if (
        !isPlainRecord(
          payload.verification,
        )
      ) {
        throw new PosPublishError(
          'report_payload_invalid',
        )
      }

      const keys =
        Object.keys(
          payload.verification,
        )

      const priceKeys = [
        'upc',
        'modifier',
        'price',
      ]

      const productV1Keys = [
        'upc',
        'modifier',
        'description',
        'department',
        'price',
      ]

      const productV2Keys = [
        'upc',
        'modifier',
        'description',
        'department',
        'price',

        'payment_product_code',
        'selling_unit',
        'maximum_quantity_per_transaction',
        'taxable_rebate',

        'tax_rate_ids',
        'id_check_ids',
      ]

      const createKeys = [...productV2Keys, 'flag_ids']

      const exact =
        expected =>
          keys.length === expected.length
          && keys.every(
            key =>
              expected.includes(key),
          )

      const priceOnly =
        exact(priceKeys)

      const productV1 =
        exact(productV1Keys)

      const productV2 =
        exact(productV2Keys)
      const createV1 = createOperation && exact(createKeys)

      if (
        !priceOnly
        && !productV1
        && !productV2 && !createV1
      ) {
        throw new PosPublishError(
          'report_payload_invalid',
        )
      }

      const verification = {
        upc:
          assertCanonicalUpc(
            payload.verification.upc,
            'report_payload_invalid',
          ),

        modifier:
          assertModifier(
            payload.verification.modifier,
            'report_payload_invalid',
          ),

        ...(productV1 || productV2 || createV1
          ? {
              description:
                assertDescription(
                  payload.verification.description,
                  'report_payload_invalid',
                ),

              department:
                assertDepartment(
                  payload.verification.department,
                  'report_payload_invalid',
                ),
            }
          : {}),

        price:
          assertDecimalPrice(
            payload.verification.price,
            'report_payload_invalid',
          ),

        ...(productV2 || createV1
          ? {
              payment_product_code:
                assertProductSysid(
                  payload.verification.payment_product_code,
                  'report_payload_invalid',
                ),

              selling_unit:
                assertProductDecimal(
                  payload.verification.selling_unit,
                  3,
                  'report_payload_invalid',
                ),

              maximum_quantity_per_transaction:
                assertProductDecimal(
                  payload.verification.maximum_quantity_per_transaction,
                  2,
                  'report_payload_invalid',
                ),

              taxable_rebate:
                assertProductMoneyAllowZero(
                  payload.verification.taxable_rebate,
                  'report_payload_invalid',
                ),

              tax_rate_ids:
                assertProductSysidList(
                  payload.verification.tax_rate_ids,
                  'report_payload_invalid',
                ),

              id_check_ids:
                assertProductSysidList(
                  payload.verification.id_check_ids,
                  'report_payload_invalid',
                ),
            }
          : {}),
        ...(createV1 ? { flag_ids: assertProductSysidList(payload.verification.flag_ids, 'report_payload_invalid') } : {}),
      }

      return {
        job_id: jobId,
        status: 'completed',
        verification,
        ...(createOperation ? { operation: 'create_product' } : {}),
      }
    }

    if (payload.status === 'failed') {
      assertSafeRecord(
        payload,
        createOperation ? ['job_id', 'status', 'operation', 'error_code', 'error_message'] : [
          'job_id',
          'status',
          'error_code',
          'error_message',
        ],
        'report_payload_invalid',
      )

      let errorCode

      try {
        errorCode =
          assertFailureCode(
            payload.error_code,
          )
      } catch {
        throw new PosPublishError(
          'report_payload_invalid',
        )
      }

      let errorMessage = null

      if (
        payload.error_message !== null
      ) {
        errorMessage =
          safeFailureMessage(
            payload.error_message,
          )

        if (errorMessage === null) {
          throw new PosPublishError(
            'report_payload_invalid',
          )
        }
      }

      return {
        job_id: jobId,
        status: 'failed',
        error_code:
          errorCode,
        error_message:
          errorMessage,
        ...(createOperation ? { operation: 'create_product' } : {}),
      }
    }

    throw new PosPublishError(
      'report_payload_invalid',
    )
  } catch (error) {
    if (
      error instanceof PosPublishError
    ) {
      throw error
    }

    throw new PosPublishError(
      'report_payload_invalid',
    )
  }
}

export function createPosPublishApiClient({ baseUrl, connectorToken, workerVersion, capabilities = ['update_price', 'update_product', 'create_product'], fetchImpl = globalThis.fetch, timeoutMs = 10_000, maxResponseBytes = MAX_RESPONSE_BYTES, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  const origin = assertBaseUrl(baseUrl)
  if (typeof connectorToken !== 'string' || connectorToken.length < 32 || connectorToken.length > 512) throw new PosPublishError('api_configuration_invalid')
  if (typeof workerVersion !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(workerVersion)) throw new PosPublishError('api_configuration_invalid')
  if (!Array.isArray(capabilities) || capabilities.length < 1 || capabilities.length > 3 || capabilities[0] !== 'update_price' || capabilities.some((value, index) => !['update_price', 'update_product', 'create_product'].includes(value) || capabilities.indexOf(value) !== index)) throw new PosPublishError('api_configuration_invalid')
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) throw new PosPublishError('api_configuration_invalid')

  async function request(path, payload, allowNoContent = false) {
    const controller = new AbortController()
    const timeout = setTimeoutFn(() => controller.abort(), timeoutMs)
    try {
      let response
      try {
        response = await fetchImpl(new URL(path, origin), {
          method: 'POST',
          redirect: 'manual',
          credentials: 'omit',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', 'x-storepulse-connector-token': connectorToken },
          body: JSON.stringify(payload),
        })
      } catch {
        if (controller.signal.aborted) throw new PosPublishError('api_timeout')
        throw new PosPublishError('api_request_failed')
      }
      if (!response || typeof response.status !== 'number') throw new PosPublishError('api_request_failed')
      if (allowNoContent && response.status === 204) return NO_CONTENT
      if (response.status !== 200 || response.redirected) throw new PosPublishError('api_request_failed')
      return await readBoundedJson(response, maxResponseBytes)
    } finally {
      clearTimeoutFn(timeout)
    }
  }

  return {
    async claim() {
      const body = await request(CLAIM_PATH, { worker_version: workerVersion, capabilities }, true)
      return body === NO_CONTENT ? undefined : validateClaimResponse(body)
    },
    async report(payload) {
      const safePayload = validateReportPayload(payload)
      const body = await request(REPORT_PATH, safePayload)
      assertSafeRecord(body, ['job_id', 'status'], 'api_response_invalid')
      if (body.job_id !== safePayload.job_id || body.status !== safePayload.status) throw new PosPublishError('api_response_invalid')
      return { job_id: body.job_id, status: body.status }
    },
  }
}

export { PUBLISH_FAILURE_CODES }
