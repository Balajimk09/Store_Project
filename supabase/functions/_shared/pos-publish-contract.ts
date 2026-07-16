export type JsonRecord = Record<string, unknown>

export type ClaimRequest = {
  workerVersion: string
  capabilities: ['update_price']
}

export type ClaimedPublishJob = {
  job_id: string
  operation: 'update_price'
  product_id: string
  upc: string
  price: string
  attempt: number
  claimed_at: string
}

export type ReportRequest =
  | { jobId: string; status: 'sending' | 'verifying' }
  | { jobId: string; status: 'completed'; verification: { upc: string; price: string } }
  | { jobId: string; status: 'failed'; errorCode: string; errorMessage: string | null }

export const PUBLISH_FAILURE_CODES = new Set([
  'commander_auth_failed',
  'commander_unreachable',
  'commander_tls_failed',
  'plu_not_found',
  'plu_identity_mismatch',
  'update_rejected',
  'verification_failed',
  'job_expired',
  'internal_connector_error',
])

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PRICE_PATTERN = /^(?:0|[1-9]\d*)\.\d{2}$/
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SENSITIVE_MESSAGE_PATTERN = /(?:authorization|bearer|basic\s+auth|access[_ ]?token|refresh[_ ]?token|token|set-cookie|cookie|password|passwd|secret|api[_ ]?key|apikey|session|credential|private[_ ]?key|service(?:[_ -])?role|supabase[_ ]?key|stack\s*trace|traceback|request\s*(?:headers|body|dump)|response\s*(?:headers|body|dump)|curl|https?:\/\/|<[^>]*>|<\?xml|xmlns\s*=|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b[0-9a-f]{32,}\b|\b[A-Za-z0-9+/_-]{48,}={0,2}\b)/i

export const MAX_JSON_BODY_BYTES = 8 * 1024
export const MAX_FAILURE_MESSAGE_LENGTH = 240

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
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) throw new PublishValidationError(code)
  return value.trim()
}

export function decimalPrice(value: unknown, code: string): string {
  if (typeof value !== 'string' || !PRICE_PATTERN.test(value.trim())) throw new PublishValidationError(code)
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed) || parsed <= 0) throw new PublishValidationError(code)
  return parsed.toFixed(2)
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

export function validateClaimRequest(value: unknown): ClaimRequest {
  if (!isRecord(value)) throw new PublishValidationError('request_body_must_be_object')
  requireExactKeys(value, ['worker_version', 'capabilities'])
  if (typeof value.worker_version !== 'string' || !VERSION_PATTERN.test(value.worker_version.trim())) {
    throw new PublishValidationError('worker_version_invalid')
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length !== 1 || value.capabilities[0] !== 'update_price') {
    throw new PublishValidationError('capabilities_invalid')
  }
  return { workerVersion: value.worker_version.trim(), capabilities: ['update_price'] }
}

export function validateReportRequest(value: unknown): ReportRequest {
  if (!isRecord(value)) throw new PublishValidationError('request_body_must_be_object')
  const jobId = requiredUuid(value.job_id, 'job_id_invalid')
  if (value.status === 'sending' || value.status === 'verifying') {
    requireExactKeys(value, ['job_id', 'status'])
    return { jobId, status: value.status }
  }
  if (value.status === 'completed') {
    requireExactKeys(value, ['job_id', 'status', 'verification'])
    if (!isRecord(value.verification)) throw new PublishValidationError('verification_invalid')
    requireExactKeys(value.verification, ['upc', 'price'])
    return {
      jobId,
      status: 'completed',
      verification: {
        upc: canonicalUpc(value.verification.upc, 'verification_upc_invalid'),
        price: decimalPrice(value.verification.price, 'verification_price_invalid'),
      },
    }
  }
  if (value.status === 'failed') {
    requireExactKeys(value, ['job_id', 'status', 'error_code', 'error_message'])
    if (typeof value.error_code !== 'string' || !PUBLISH_FAILURE_CODES.has(value.error_code)) {
      throw new PublishValidationError('error_code_invalid')
    }
    return {
      jobId,
      status: 'failed',
      errorCode: value.error_code,
      errorMessage: safeErrorMessage(value.error_message),
    }
  }
  throw new PublishValidationError('status_invalid')
}

export function isSafeClaimedPublishJob(value: unknown): value is ClaimedPublishJob {
  if (!isRecord(value)) return false
  try {
    return requiredUuid(value.job_id, 'job_id_invalid') === value.job_id
      && value.operation === 'update_price'
      && requiredUuid(value.product_id, 'product_id_invalid') === value.product_id
      && canonicalUpc(value.upc, 'upc_invalid') === value.upc
      && decimalPrice(value.price, 'price_invalid') === value.price
      && typeof value.attempt === 'number'
      && Number.isInteger(value.attempt)
      && value.attempt >= 1
      && typeof value.claimed_at === 'string'
      && Number.isFinite(Date.parse(value.claimed_at))
  } catch {
    return false
  }
}
