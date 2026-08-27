export type JsonRecord = Record<string, unknown>

export type PublishCapability = 'update_price' | 'update_product' | 'create_product'

export type ClaimRequest = {
  workerVersion: string
  capabilities: PublishCapability[]
}

export type LegacyClaimedPriceJob = {
  job_id: string
  operation: 'update_price'
  product_id: string
  upc: string
  modifier: string
  expected_price: string
  price: string
  attempt: number
  claimed_at: string
}

export type ExtendedClaimedPriceJob = LegacyClaimedPriceJob & {
  expected_description: null
  description: null
  expected_department: null
  department: null
}

export type LegacyClaimedProductJob = {
  job_id: string
  operation: 'update_product'
  product_id: string
  upc: string
  modifier: string

  expected_description: string
  description: string

  expected_department: string
  department: string

  expected_price: string
  price: string

  attempt: number
  claimed_at: string
}

export type ClaimedProductJob =
  LegacyClaimedProductJob & {
    expected_payment_product_code: string
    payment_product_code: string

    expected_selling_unit: string
    selling_unit: string

    expected_max_qty_per_trans: string
    max_qty_per_trans: string

    expected_taxable_rebate: string
    taxable_rebate: string

    expected_tax_rate_ids: string[]
    tax_rate_ids: string[]

    expected_id_check_ids: string[]
    id_check_ids: string[]
  }

export type ClaimedPublishJob = LegacyClaimedPriceJob | ExtendedClaimedPriceJob | LegacyClaimedProductJob | ClaimedProductJob | ClaimedCreateProductJob

export type ClaimedCreateProductJob = {
  job_id: string; operation: 'create_product'; product_id: string; upc: string; modifier: string
  description: string; department: string; price: string; payment_product_code: string; selling_unit: string
  max_qty_per_trans: string; taxable_rebate: string; tax_rate_ids: string[]; id_check_ids: string[]; flag_ids: string[]
  attempt: number; claimed_at: string
}

export type ReportRequest =
  | {
      jobId: string
      status: 'sending' | 'verifying'
    }
  | {
      jobId: string
      status: 'completed'
      verification: {
        upc: string
        modifier: string
        price: string
      }
    }
  | {
      jobId: string
      status: 'completed'
      verification: {
        upc: string
        modifier: string
        description: string
        department: string
        price: string
      }
    }
  | {
      jobId: string
      status: 'completed'
      verification: {
        upc: string
        modifier: string

        description: string
        department: string
        price: string

        payment_product_code: string
        selling_unit: string
        maximum_quantity_per_transaction: string
        taxable_rebate: string

        tax_rate_ids: string[]
        id_check_ids: string[]
      }
    }
  | {
      jobId: string
      status: 'failed'
      errorCode: string
      errorMessage: string | null
    }
  | { jobId: string; status: 'sending' | 'verifying'; operation: 'create_product' }
  | { jobId: string; status: 'completed'; operation: 'create_product'; verification: { upc: string; modifier: string; description: string; department: string; price: string; payment_product_code: string; selling_unit: string; maximum_quantity_per_transaction: string; taxable_rebate: string; tax_rate_ids: string[]; id_check_ids: string[]; flag_ids: string[] } }
  | { jobId: string; status: 'failed'; operation: 'create_product'; errorCode: string; errorMessage: string | null }

export const PUBLISH_FAILURE_CODES = new Set([
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PRICE_PATTERN = /^(?:0|[1-9]\d*)\.\d{2}$/
const CANONICAL_UPC_PATTERN = /^[0-9]{14}$/
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SENSITIVE_MESSAGE_PATTERN = /(?:authorization|bearer|basic\s+auth|access[_ ]?token|refresh[_ ]?token|token|set-cookie|cookie|password|passwd|secret|api[_ ]?key|apikey|session|credential|private[_ ]?key|service(?:[_ -])?role|supabase[_ ]?key|stack\s*trace|traceback|request\s*(?:headers|body|dump)|response\s*(?:headers|body|dump)|curl|https?:\/\/|<[^>]*>|<\?xml|xmlns\s*=|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b[0-9a-f]{32,}\b|\b[A-Za-z0-9+/_-]{48,}={0,2}\b)/i

export const MAX_JSON_BODY_BYTES = 8 * 1024
export const MAX_FAILURE_MESSAGE_LENGTH = 240
export const CANONICAL_UPC_LENGTH = 14

export class PublishValidationError extends Error {
  constructor(public code: string, public status = 400) {
    super(code)
  }
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function requiredUuid(value: unknown, code: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) throw new PublishValidationError(code)
  return value.trim().toLowerCase()
}

export function canonicalUpc(value: unknown, code: string): string {
  if (typeof value !== 'string' || !CANONICAL_UPC_PATTERN.test(value)) {
    throw new PublishValidationError(code)
  }
  return value
}

export function commanderModifier(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^\d{3}$/.test(value)) throw new PublishValidationError(code)
  return value
}

export function strictRfc3339Timestamp(value: unknown, code: string): string {
  if (typeof value !== 'string') throw new PublishValidationError(code)
  const match = RFC3339_PATTERN.exec(value)
  if (!match) throw new PublishValidationError(code)
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
    throw new PublishValidationError(code)
  }
  return value
}

export function decimalPrice(value: unknown, code: string): string {
  if (typeof value !== 'string' || !PRICE_PATTERN.test(value.trim())) throw new PublishValidationError(code)
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 999999.99) throw new PublishValidationError(code)
  return parsed.toFixed(2)
}

export function commanderDescription(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new PublishValidationError(code)
  }
  return value
}

export function commanderDepartment(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value)) throw new PublishValidationError(code)
  return value
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get('content-type')?.trim() ?? ''
  return /^application\/json(?:\s*;\s*charset=[A-Za-z0-9._-]+)?$/i.test(contentType)
}

export async function readBoundedJsonBody(request: Request): Promise<unknown> {
  if (!hasJsonContentType(request)) throw new PublishValidationError('unsupported_media_type', 415)

  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader)
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new PublishValidationError('invalid_json')
    }
    if (contentLength > MAX_JSON_BODY_BYTES) throw new PublishValidationError('payload_too_large', 413)
  }

  if (!request.body) throw new PublishValidationError('invalid_json')

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      totalBytes += value.byteLength
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        await reader.cancel()
        throw new PublishValidationError('payload_too_large', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  if (totalBytes === 0) throw new PublishValidationError('invalid_json')

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new PublishValidationError('invalid_json')
  }
}

function requireExactKeys(value: JsonRecord, allowed: string[]) {
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new PublishValidationError('unknown_field')
  }
}

function safeErrorMessage(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new PublishValidationError('error_message_invalid')
  const message = value.trim()
  if (!message
    || message.length > MAX_FAILURE_MESSAGE_LENGTH
    || /[\u0000-\u001f\u007f]/.test(message)
    || SENSITIVE_MESSAGE_PATTERN.test(message)) {
    throw new PublishValidationError('error_message_invalid')
  }
  return message
}

function commanderProductSysid(
  value: unknown,
  code: string,
): string {
  if (
    typeof value !== 'string'
    || !/^\d{1,16}$/.test(value)
  ) {
    throw new PublishValidationError(code)
  }

  return value
}

function commanderProductDecimal(
  value: unknown,
  fractionDigits: number,
  code: string,
): string {
  if (typeof value !== 'string') {
    throw new PublishValidationError(code)
  }

  const pattern =
    new RegExp(
      `^(?:0|[1-9]\\d{0,5})(?:\\.\\d{1,${fractionDigits}})?$`,
    )

  if (!pattern.test(value)) {
    throw new PublishValidationError(code)
  }

  const amount = Number(value)

  if (
    !Number.isFinite(amount)
    || amount < 0
  ) {
    throw new PublishValidationError(code)
  }

  return amount.toFixed(
    fractionDigits,
  )
}

function commanderProductMoneyAllowZero(
  value: unknown,
  code: string,
): string {
  if (
    typeof value !== 'string'
    || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)
  ) {
    throw new PublishValidationError(code)
  }

  const amount = Number(value)

  if (
    !Number.isFinite(amount)
    || amount < 0
    || amount > 999999.99
  ) {
    throw new PublishValidationError(code)
  }

  return amount.toFixed(2)
}

function commanderProductSysidList(
  value: unknown,
  code: string,
): string[] {
  if (
    !Array.isArray(value)
    || value.length > 16
  ) {
    throw new PublishValidationError(code)
  }

  const result =
    value.map(
      item =>
        commanderProductSysid(
          item,
          code,
        ),
    )

  if (
    new Set(result).size
    !== result.length
  ) {
    throw new PublishValidationError(code)
  }

  return result
}

function sameProductContractValue(
  left: unknown,
  right: unknown,
): boolean {
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

export function validateClaimRequest(value: unknown): ClaimRequest {
  if (!isRecord(value)) throw new PublishValidationError('request_body_must_be_object')
  requireExactKeys(value, ['worker_version', 'capabilities'])
  if (typeof value.worker_version !== 'string' || !VERSION_PATTERN.test(value.worker_version.trim())) {
    throw new PublishValidationError('worker_version_invalid')
  }
  const capabilities = value.capabilities
  if (
    !Array.isArray(capabilities)
    || capabilities.length < 1
    || capabilities.length > 3
    || capabilities[0] !== 'update_price'
    || capabilities.some((capability, index) =>
      !['update_price', 'update_product', 'create_product'].includes(String(capability))
      || capabilities.indexOf(capability) !== index
    )
  ) {
    throw new PublishValidationError('capabilities_invalid')
  }
  return {
    workerVersion: value.worker_version.trim(),
    capabilities: capabilities as PublishCapability[],
  }
}

export function validateReportRequest(value: unknown): ReportRequest {
  if (!isRecord(value)) {
    throw new PublishValidationError(
      'request_body_must_be_object',
    )
  }

  if (value.operation === 'create_product') {
    const copy = { ...value }
    delete copy.operation
    if (value.status === 'completed') {
      if (!isRecord(value.verification)) throw new PublishValidationError('verification_invalid')
      const verification = { ...value.verification }
      delete verification.flag_ids
      copy.verification = verification
    }
    const normalized = validateReportRequest(copy)
    if (normalized.status === 'completed') {
      if (!isRecord(value.verification) || !Array.isArray(value.verification.flag_ids)) throw new PublishValidationError('verification_invalid')
      const flagIds = commanderProductSysidList(value.verification.flag_ids, 'verification_flag_ids_invalid')
      if (flagIds.length === 0 || !('description' in normalized.verification) || !('payment_product_code' in normalized.verification)) throw new PublishValidationError('verification_invalid')
      return { ...normalized, operation: 'create_product', verification: { ...normalized.verification, flag_ids: flagIds } }
    }
    return { ...normalized, operation: 'create_product' } as ReportRequest
  }

  const jobId =
    requiredUuid(
      value.job_id,
      'job_id_invalid',
    )

  if (
    value.status === 'sending'
    || value.status === 'verifying'
  ) {
    requireExactKeys(
      value,
      ['job_id', 'status'],
    )

    return {
      jobId,
      status: value.status,
    }
  }

  if (value.status === 'completed') {
    requireExactKeys(
      value,
      [
        'job_id',
        'status',
        'verification',
      ],
    )

    if (!isRecord(value.verification)) {
      throw new PublishValidationError(
        'verification_invalid',
      )
    }

    const keys =
      Object.keys(
        value.verification,
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

    const exact =
      (expected: string[]) =>
        keys.length === expected.length
        && keys.every(
          key => expected.includes(key),
        )

    const priceOnly =
      exact(priceKeys)

    const productV1 =
      exact(productV1Keys)

    const productV2 =
      exact(productV2Keys)

    if (
      !priceOnly
      && !productV1
      && !productV2
    ) {
      throw new PublishValidationError(
        'verification_invalid',
      )
    }

    const verification = {
      upc:
        canonicalUpc(
          value.verification.upc,
          'verification_upc_invalid',
        ),

      modifier:
        commanderModifier(
          value.verification.modifier,
          'verification_modifier_invalid',
        ),

      ...(productV1 || productV2
        ? {
            description:
              commanderDescription(
                value.verification.description,
                'verification_description_invalid',
              ),

            department:
              commanderDepartment(
                value.verification.department,
                'verification_department_invalid',
              ),
          }
        : {}),

      price:
        decimalPrice(
          value.verification.price,
          'verification_price_invalid',
        ),

      ...(productV2
        ? {
            payment_product_code:
              commanderProductSysid(
                value.verification.payment_product_code,
                'verification_payment_product_code_invalid',
              ),

            selling_unit:
              commanderProductDecimal(
                value.verification.selling_unit,
                3,
                'verification_selling_unit_invalid',
              ),

            maximum_quantity_per_transaction:
              commanderProductDecimal(
                value.verification.maximum_quantity_per_transaction,
                2,
                'verification_max_qty_per_trans_invalid',
              ),

            taxable_rebate:
              commanderProductMoneyAllowZero(
                value.verification.taxable_rebate,
                'verification_taxable_rebate_invalid',
              ),

            tax_rate_ids:
              commanderProductSysidList(
                value.verification.tax_rate_ids,
                'verification_tax_rate_ids_invalid',
              ),

            id_check_ids:
              commanderProductSysidList(
                value.verification.id_check_ids,
                'verification_id_check_ids_invalid',
              ),
          }
        : {}),
    }

    return {
      jobId,
      status: 'completed',
      verification,
    } as ReportRequest
  }

  if (value.status === 'failed') {
    requireExactKeys(
      value,
      [
        'job_id',
        'status',
        'error_code',
        'error_message',
      ],
    )

    if (
      typeof value.error_code !== 'string'
      || !PUBLISH_FAILURE_CODES.has(
        value.error_code,
      )
    ) {
      throw new PublishValidationError(
        'error_code_invalid',
      )
    }

    return {
      jobId,
      status: 'failed',
      errorCode: value.error_code,
      errorMessage:
        safeErrorMessage(
          value.error_message,
        ),
    }
  }

  throw new PublishValidationError(
    'status_invalid',
  )
}

export function isSafeClaimedPublishJob(value: unknown): value is ClaimedPublishJob {
  if (!isRecord(value)) {
    return false
  }

  if (value.operation === 'create_product') {
    const expected = ['job_id','operation','product_id','upc','modifier','description','department','price','payment_product_code','selling_unit','max_qty_per_trans','taxable_rebate','tax_rate_ids','id_check_ids','flag_ids','attempt','claimed_at']
    const keys = Object.keys(value)
    if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) return false
    try {
      return requiredUuid(value.job_id, 'job_id_invalid') === value.job_id
        && requiredUuid(value.product_id, 'product_id_invalid') === value.product_id
        && canonicalUpc(value.upc, 'upc_invalid') === value.upc
        && commanderModifier(value.modifier, 'modifier_invalid') === value.modifier
        && commanderDescription(value.description, 'description_invalid') === value.description
        && commanderDepartment(value.department, 'department_invalid') === value.department
        && decimalPrice(value.price, 'price_invalid') === value.price
        && commanderProductSysid(value.payment_product_code, 'payment_product_code_invalid') === value.payment_product_code
        && commanderProductDecimal(value.selling_unit, 3, 'selling_unit_invalid') === value.selling_unit
        && commanderProductDecimal(value.max_qty_per_trans, 2, 'max_qty_per_trans_invalid') === value.max_qty_per_trans
        && commanderProductMoneyAllowZero(value.taxable_rebate, 'taxable_rebate_invalid') === value.taxable_rebate
        && commanderProductSysidList(value.tax_rate_ids, 'tax_rate_ids_invalid').length > 0
        && commanderProductSysidList(value.id_check_ids, 'id_check_ids_invalid').length > 0
        && commanderProductSysidList(value.flag_ids, 'flag_ids_invalid').length > 0
        && typeof value.attempt === 'number' && Number.isSafeInteger(value.attempt) && value.attempt >= 1
        && strictRfc3339Timestamp(value.claimed_at, 'claimed_at_invalid') === value.claimed_at
    } catch { return false }
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

  const keys =
    Object.keys(value)

  const exact =
    (expected: string[]) =>
      keys.length === expected.length
      && keys.every(
        key => expected.includes(key),
      )

  const legacy =
    exact(legacyKeys)

  const productV1 =
    exact(productV1Keys)

  const productV2 =
    exact(productV2Keys)

  if (
    !legacy
    && !productV1
    && !productV2
  ) {
    return false
  }

  try {
    const baseValid =
      requiredUuid(
        value.job_id,
        'job_id_invalid',
      ) === value.job_id

      && requiredUuid(
        value.product_id,
        'product_id_invalid',
      ) === value.product_id

      && canonicalUpc(
        value.upc,
        'upc_invalid',
      ) === value.upc

      && commanderModifier(
        value.modifier,
        'modifier_invalid',
      ) === value.modifier

      && decimalPrice(
        value.expected_price,
        'expected_price_invalid',
      ) === value.expected_price

      && decimalPrice(
        value.price,
        'price_invalid',
      ) === value.price

      && typeof value.attempt === 'number'

      && Number.isSafeInteger(
        value.attempt,
      )

      && value.attempt >= 1

      && strictRfc3339Timestamp(
        value.claimed_at,
        'claimed_at_invalid',
      ) === value.claimed_at

    if (!baseValid) {
      return false
    }

    if (
      value.operation === 'update_price'
      && legacy
    ) {
      return (
        value.expected_price
        !== value.price
      )
    }

    if (
      value.operation === 'update_price'
      && productV1
    ) {
      return (
        value.expected_price
        !== value.price

        && [
          value.expected_description,
          value.description,
          value.expected_department,
          value.department,
        ].every(
          item => item === null,
        )
      )
    }

    if (
      value.operation === 'update_product'
      && productV1
    ) {
      const expectedDescription =
        commanderDescription(
          value.expected_description,
          'expected_description_invalid',
        )

      const description =
        commanderDescription(
          value.description,
          'description_invalid',
        )

      const expectedDepartment =
        commanderDepartment(
          value.expected_department,
          'expected_department_invalid',
        )

      const department =
        commanderDepartment(
          value.department,
          'department_invalid',
        )

      return (
        expectedDescription !== description
        || expectedDepartment !== department
        || value.expected_price !== value.price
      )
    }

    if (
      value.operation === 'update_product'
      && productV2
    ) {
      const expectedState = {
        description:
          commanderDescription(
            value.expected_description,
            'expected_description_invalid',
          ),

        department:
          commanderDepartment(
            value.expected_department,
            'expected_department_invalid',
          ),

        price:
          value.expected_price,

        payment_product_code:
          commanderProductSysid(
            value.expected_payment_product_code,
            'expected_payment_product_code_invalid',
          ),

        selling_unit:
          commanderProductDecimal(
            value.expected_selling_unit,
            3,
            'expected_selling_unit_invalid',
          ),

        max_qty_per_trans:
          commanderProductDecimal(
            value.expected_max_qty_per_trans,
            2,
            'expected_max_qty_per_trans_invalid',
          ),

        taxable_rebate:
          commanderProductMoneyAllowZero(
            value.expected_taxable_rebate,
            'expected_taxable_rebate_invalid',
          ),

        tax_rate_ids:
          commanderProductSysidList(
            value.expected_tax_rate_ids,
            'expected_tax_rate_ids_invalid',
          ),

        id_check_ids:
          commanderProductSysidList(
            value.expected_id_check_ids,
            'expected_id_check_ids_invalid',
          ),
      }

      const requestedState = {
        description:
          commanderDescription(
            value.description,
            'description_invalid',
          ),

        department:
          commanderDepartment(
            value.department,
            'department_invalid',
          ),

        price:
          value.price,

        payment_product_code:
          commanderProductSysid(
            value.payment_product_code,
            'payment_product_code_invalid',
          ),

        selling_unit:
          commanderProductDecimal(
            value.selling_unit,
            3,
            'selling_unit_invalid',
          ),

        max_qty_per_trans:
          commanderProductDecimal(
            value.max_qty_per_trans,
            2,
            'max_qty_per_trans_invalid',
          ),

        taxable_rebate:
          commanderProductMoneyAllowZero(
            value.taxable_rebate,
            'taxable_rebate_invalid',
          ),

        tax_rate_ids:
          commanderProductSysidList(
            value.tax_rate_ids,
            'tax_rate_ids_invalid',
          ),

        id_check_ids:
          commanderProductSysidList(
            value.id_check_ids,
            'id_check_ids_invalid',
          ),
      }

      return (
        expectedState.description
          !== requestedState.description

        || expectedState.department
          !== requestedState.department

        || expectedState.price
          !== requestedState.price

        || expectedState.payment_product_code
          !== requestedState.payment_product_code

        || expectedState.selling_unit
          !== requestedState.selling_unit

        || expectedState.max_qty_per_trans
          !== requestedState.max_qty_per_trans

        || expectedState.taxable_rebate
          !== requestedState.taxable_rebate

        || !sameProductContractValue(
          expectedState.tax_rate_ids,
          requestedState.tax_rate_ids,
        )

        || !sameProductContractValue(
          expectedState.id_check_ids,
          requestedState.id_check_ids,
        )
      )
    }

    return false
  }
  catch {
    return false
  }
}
