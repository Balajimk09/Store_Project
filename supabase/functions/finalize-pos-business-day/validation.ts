export type JsonRecord = Record<string, unknown>

export const SOURCE_SYSTEM = 'verifone_commander'
export const HASH_PATTERN = /^[a-f0-9]{64}$/i
export const MAX_METADATA_BYTES = 128 * 1024

export class ValidationError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function optionalString(value: unknown, maxLength = 500): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

export function requiredString(value: unknown, name: string, maxLength = 500): string {
  const text = optionalString(value, maxLength)
  if (!text) throw new ValidationError(`${name}_required`)
  return text
}

export function requiredInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${name}_invalid`)
  }
  return value
}

export function requiredUuid(value: unknown, name: string): string {
  const text = requiredString(value, name, 64)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new ValidationError(`${name}_invalid`)
  }
  return text
}

export function isValidBusinessDate(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function requiredDate(value: unknown, name: string): string {
  const text = requiredString(value, name, 10)
  if (!isValidBusinessDate(text)) throw new ValidationError(`${name}_invalid`)
  return text
}

export function optionalIsoTimestamp(value: unknown, name: string): string | null {
  const text = optionalString(value, 80)
  if (!text) return null
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) throw new ValidationError(`${name}_invalid`)
  return text
}

export function localDateFromIsoTimestamp(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T\s]/.exec(value)
  return match?.[1] ?? null
}

export function requiredSafeFilename(value: unknown, name: string): string {
  const text = requiredString(value, name, 500)
  if (/[\\/:*?"<>|\r\n]/.test(text) || text === '.' || text === '..') throw new ValidationError(`${name}_invalid`)
  return text
}

export function validatePeriodLabel(sourcePeriodLabel: string, periodNumber: string): void {
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(sourcePeriodLabel)) throw new ValidationError('source_period_label_invalid')
  const suffix = sourcePeriodLabel.split('.').pop()
  if (suffix !== periodNumber) throw new ValidationError('source_period_label_period_mismatch')
}

export function validateMetadata(value: unknown): JsonRecord {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) throw new ValidationError('reconciliation_metadata_invalid')
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
  if (bytes > MAX_METADATA_BYTES) throw new ValidationError('reconciliation_metadata_too_large')
  return value
}

export function requiredHash(value: unknown, name: string): string {
  const text = requiredString(value, name, 128).toLowerCase()
  if (!HASH_PATTERN.test(text)) throw new ValidationError(`${name}_invalid`)
  return text
}

export type ValidationConnector = {
  source_system: string
  source_store_number: string | null
}

export function validateSourceStore(connector: ValidationConnector, sourceStoreNumber: unknown): string {
  const requested = optionalString(sourceStoreNumber, 100)
  if (!connector.source_store_number) throw new ValidationError('connector_source_store_required')
  if (!requested || requested !== connector.source_store_number) {
    throw new ValidationError('source_store_mismatch')
  }
  return connector.source_store_number
}

export function validateRecordEnvelope(record: unknown, connector: ValidationConnector, businessDate: string): JsonRecord {
  if (!isRecord(record)) throw new ValidationError('record_invalid')
  const source = requiredString(record.source_system, 'source_system', 100)
  if (source !== SOURCE_SYSTEM || source !== connector.source_system) throw new ValidationError('transaction_source_mismatch')
  const storeNumber = requiredString(record.store_number, 'store_number', 100)
  if (storeNumber !== connector.source_store_number) throw new ValidationError('transaction_store_mismatch')
  requiredString(record.source_unique_id, 'source_unique_id', 500)
  requiredString(record.transaction_time, 'transaction_time', 100)
  requiredString(record.transaction_type, 'transaction_type', 100)
  if (requiredDate(record.business_date, 'business_date') !== businessDate) throw new ValidationError('transaction_business_date_mismatch')
  if (typeof record.canonical_record !== 'boolean' || record.canonical_record !== true) {
    throw new ValidationError('transaction_canonical_record_invalid')
  }
  if (!Array.isArray(record.items)) throw new ValidationError('transaction_items_invalid')
  if (!Array.isArray(record.payments)) throw new ValidationError('transaction_payments_invalid')
  return record
}

export function validateBeginManifest(body: JsonRecord): {
  sourceSystem: string
  businessDate: string
  periodType: string
  periodNumber: string
  sourcePeriodLabel: string
  periodOpen: string
  periodClose: string
  sourceFileHash: string
  payloadHash: string
  finalSourceSetHash: string
  expectedRecordCount: number
  metadata: JsonRecord
  normalizerVersion: string | null
  schemaVersion: string
  sourceFileName: string
} {
  const sourceSystem = requiredString(body.source_system, 'source_system', 100)
  if (sourceSystem !== SOURCE_SYSTEM) throw new ValidationError('source_system_invalid')
  const businessDate = requiredDate(body.business_date, 'business_date')
  const periodType = requiredString(body.period_type, 'period_type', 50).toLowerCase()
  if (periodType !== 'day') throw new ValidationError('period_type_invalid')
  const periodNumber = requiredString(body.period_number, 'period_number', 100)
  if (!/^\d+$/.test(periodNumber)) throw new ValidationError('period_number_invalid')
  const sourcePeriodLabel = requiredString(body.source_period_label, 'source_period_label', 500)
  validatePeriodLabel(sourcePeriodLabel, periodNumber)
  const periodOpen = optionalIsoTimestamp(body.period_open, 'period_open')
  const periodClose = optionalIsoTimestamp(body.period_close, 'period_close')
  if (!periodOpen || !periodClose) throw new ValidationError('period_bounds_required')
  if (Date.parse(periodOpen) >= Date.parse(periodClose)) throw new ValidationError('period_bounds_invalid')
  if (localDateFromIsoTimestamp(periodOpen) !== businessDate) throw new ValidationError('business_date_period_open_mismatch')
  const sourceFileHash = requiredHash(body.source_file_hash, 'source_file_hash')
  const payloadHash = requiredHash(body.payload_hash, 'payload_hash')
  const finalSourceSetHash = requiredHash(body.final_source_set_hash, 'final_source_set_hash')
  const expectedRecordCount = requiredInteger(body.expected_record_count, 'expected_record_count')
  const metadata = validateMetadata(body.reconciliation_metadata)
  const normalizerVersion = optionalString(body.normalizer_version, 100)
  const schemaVersion = optionalString(body.schema_version, 50) ?? '1'
  const sourceFileName = requiredSafeFilename(body.source_file_name, 'source_file_name')
  return {
    sourceSystem,
    businessDate,
    periodType,
    periodNumber,
    sourcePeriodLabel,
    periodOpen,
    periodClose,
    sourceFileHash,
    payloadHash,
    finalSourceSetHash,
    expectedRecordCount,
    metadata,
    normalizerVersion,
    schemaVersion,
    sourceFileName,
  }
}

export function validateStageIdentity(
  finalization: { payload_hash: string; final_source_set_hash: string | null },
  payloadHash: unknown,
  finalSourceSetHash: unknown,
): { payloadHashValue: string; finalSourceSetHashValue: string } {
  const payloadHashValue = requiredHash(payloadHash, 'payload_hash')
  const finalSourceSetHashValue = requiredHash(finalSourceSetHash, 'final_source_set_hash')
  if (finalization.payload_hash !== payloadHashValue || finalization.final_source_set_hash !== finalSourceSetHashValue) {
    throw new ValidationError('finalization_identity_mismatch')
  }
  return { payloadHashValue, finalSourceSetHashValue }
}

export function assertNoDuplicateBatchSourceIds(records: unknown[]): void {
  const seen = new Set<string>()
  for (const record of records) {
    if (!isRecord(record)) throw new ValidationError('record_invalid')
    const sourceUniqueId = requiredString(record.source_unique_id, 'source_unique_id', 500)
    if (seen.has(sourceUniqueId)) throw new ValidationError('batch_duplicate_source_unique_id')
    seen.add(sourceUniqueId)
  }
}

export function validateAlreadyFinalizedResponse(result: JsonRecord): string {
  if (result.already_finalized !== true) throw new ValidationError('already_finalized_result_invalid')
  const finalizationId = requiredUuid(result.finalization_id, 'finalization_id')
  const status = optionalString(result.status, 100)
  if (status !== 'already_finalized' && status !== 'finalized') throw new ValidationError('already_finalized_status_invalid')
  return finalizationId
}

export function publicErrorCode(error: unknown): string {
  if (error instanceof ValidationError) return error.code
  if (isRecord(error) && typeof error.code === 'string') return error.code
  return 'finalization_failed'
}

export function statusForError(error: unknown): number {
  const code = publicErrorCode(error)
  if (code === '23505') return 409
  if (code.endsWith('_mismatch') || code === 'finalization_not_mutable') return 409
  if (code === '42501') return 403
  if (code.startsWith('invalid') || code.endsWith('_invalid') || code.endsWith('_required')) return 400
  if (code === '22023' || code === '22007' || code === '23514') return 400
  return 500
}
