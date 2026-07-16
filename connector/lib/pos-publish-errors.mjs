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

const UNSAFE_MESSAGE = /(?:authorization|bearer|basic\s+auth|access[_ -]?token|refresh[_ -]?token|token|cookie|password|passwd|secret|api[_ -]?key|apikey|session|credential|private[_ -]?key|service(?:[_ -])?role|supabase[_ -]?key|stack\s*trace|traceback|request\s*(?:headers|body|dump)|response\s*(?:headers|body|dump)|curl|https?:\/\/|<[^>]*>|<\?xml|xmlns\s*=|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b[0-9a-f]{32,}\b|\b[A-Za-z0-9+/_-]{48,}={0,2}\b)/i

export class PosPublishError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'PosPublishError'
    this.code = code
  }
}

export class CommanderPriceAdapterError extends PosPublishError {
  constructor(kind, message) {
    super(kind, safeFailureMessage(message) ?? 'Commander operation failed.')
    this.name = 'CommanderPriceAdapterError'
    this.kind = kind
  }
}

export function safeFailureMessage(value) {
  if (typeof value !== 'string') return null
  const message = value.trim()
  if (!message || message.length > 240 || /[\u0000-\u001f\u007f]/.test(message) || UNSAFE_MESSAGE.test(message)) return null
  return message
}

export function assertFailureCode(code) {
  if (!PUBLISH_FAILURE_CODES.has(code)) throw new PosPublishError('failure_code_invalid')
  return code
}

export function mapWorkerFailure(error) {
  if (error instanceof CommanderPriceAdapterError) {
    const mapped = {
      auth_failed: 'commander_auth_failed',
      unreachable: 'commander_unreachable',
      tls_failed: 'commander_tls_failed',
      product_not_found: 'plu_not_found',
      identity_mismatch: 'plu_identity_mismatch',
      update_rejected: 'update_rejected',
      verification_mismatch: 'verification_failed',
      timeout: 'job_expired',
      malformed_response: 'internal_connector_error',
    }[error.kind] ?? 'internal_connector_error'
    return { code: mapped, message: safeFailureMessage(error.message) ?? 'Connector publish operation failed.' }
  }
  if (error instanceof PosPublishError && error.code === 'api_timeout') {
    return { code: 'job_expired', message: 'Connector publish operation timed out.' }
  }
  return { code: 'internal_connector_error', message: 'Connector publish operation failed.' }
}
