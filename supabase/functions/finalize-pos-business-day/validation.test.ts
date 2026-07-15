import {
  SOURCE_SYSTEM,
  ValidationError,
  assertNoDuplicateBatchSourceIds,
  publicErrorCode,
  requiredHash,
  validateAlreadyFinalizedResponse,
  validateBeginManifest,
  validateRecordEnvelope,
  validateStageIdentity,
} from './validation.ts'

const connector = {
  source_system: SOURCE_SYSTEM,
  source_store_number: 'SYNTH',
}

function assertThrowsCode(fn: () => unknown, code: string) {
  try {
    fn()
  } catch (error) {
    if (error instanceof ValidationError && error.code === code) return
    throw error
  }
  throw new Error(`Expected ${code}`)
}

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    source_system: SOURCE_SYSTEM,
    source_unique_id: 'synthetic-1',
    store_number: 'SYNTH',
    business_date: '2026-01-05',
    transaction_time: '2026-01-05T22:00:00-05:00',
    transaction_type: 'completed_sale',
    total: 1,
    tax_total: 0,
    canonical_record: true,
    items: [],
    payments: [],
    ...overrides,
  }
}

function validBegin(overrides: Record<string, unknown> = {}) {
  return {
    source_system: SOURCE_SYSTEM,
    source_file_name: '2026-01-06.123.xml',
    source_file_hash: 'a'.repeat(64),
    payload_hash: 'b'.repeat(64),
    final_source_set_hash: 'c'.repeat(64),
    business_date: '2026-01-05',
    period_type: 'day',
    period_number: '123',
    source_period_label: '2026-01-06.123',
    period_open: '2026-01-05T22:00:00-05:00',
    period_close: '2026-01-06T00:30:00-05:00',
    expected_record_count: 1,
    reconciliation_metadata: {},
    ...overrides,
  }
}

Deno.test('record validation requires explicit source_system', () => {
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ source_system: undefined }), connector, '2026-01-05'), 'source_system_required')
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ source_system: ' ' }), connector, '2026-01-05'), 'source_system_required')
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ source_system: 'other' }), connector, '2026-01-05'), 'transaction_source_mismatch')
  validateRecordEnvelope(validRecord(), connector, '2026-01-05')
})

Deno.test('record validation enforces canonical child shapes', () => {
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ items: undefined }), connector, '2026-01-05'), 'transaction_items_invalid')
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ items: {} }), connector, '2026-01-05'), 'transaction_items_invalid')
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ payments: undefined }), connector, '2026-01-05'), 'transaction_payments_invalid')
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ payments: {} }), connector, '2026-01-05'), 'transaction_payments_invalid')
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ canonical_record: undefined }), connector, '2026-01-05'), 'transaction_canonical_record_invalid')
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ canonical_record: null }), connector, '2026-01-05'), 'transaction_canonical_record_invalid')
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ canonical_record: false }), connector, '2026-01-05'), 'transaction_canonical_record_invalid')
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ canonical_record: {} }), connector, '2026-01-05'), 'transaction_canonical_record_invalid')
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ canonical_record: 'bad' }), connector, '2026-01-05'), 'transaction_canonical_record_invalid')
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ canonical_record: 1 }), connector, '2026-01-05'), 'transaction_canonical_record_invalid')
  assertThrowsCode(() => validateRecordEnvelope(validRecord({ canonical_record: [] }), connector, '2026-01-05'), 'transaction_canonical_record_invalid')
})

Deno.test('begin manifest validation', () => {
  validateBeginManifest(validBegin())
  assertThrowsCode(() => validateBeginManifest(validBegin({ period_number: 'abc' })), 'period_number_invalid')
  assertThrowsCode(() => requiredHash('x', 'payload_hash'), 'payload_hash_invalid')
  assertThrowsCode(() => validateBeginManifest(validBegin({ source_period_label: 'bad' })), 'source_period_label_invalid')
  assertThrowsCode(() => validateBeginManifest(validBegin({ source_period_label: '2026-01-06.999' })), 'source_period_label_period_mismatch')
  assertThrowsCode(() => validateBeginManifest(validBegin({ period_open: '2026-01-06T01:00:00-05:00' })), 'period_bounds_invalid')
  assertThrowsCode(() => validateBeginManifest(validBegin({ period_open: '2026-01-04T22:00:00-05:00' })), 'business_date_period_open_mismatch')
  assertThrowsCode(() => validateBeginManifest(validBegin({ reconciliation_metadata: 'bad' })), 'reconciliation_metadata_invalid')
  assertThrowsCode(() => validateBeginManifest(validBegin({ reconciliation_metadata: { large: 'x'.repeat(128 * 1024 + 1) } })), 'reconciliation_metadata_too_large')
})

Deno.test('stage identity and duplicates', () => {
  validateStageIdentity({ payload_hash: 'a'.repeat(64), final_source_set_hash: 'b'.repeat(64) }, 'a'.repeat(64), 'b'.repeat(64))
  assertThrowsCode(
    () => validateStageIdentity({ payload_hash: 'a'.repeat(64), final_source_set_hash: 'b'.repeat(64) }, 'c'.repeat(64), 'b'.repeat(64)),
    'finalization_identity_mismatch',
  )
  assertNoDuplicateBatchSourceIds([validRecord({ source_unique_id: 'one' }), validRecord({ source_unique_id: 'two' })])
  assertThrowsCode(
    () => assertNoDuplicateBatchSourceIds([validRecord({ source_unique_id: 'one' }), validRecord({ source_unique_id: 'one' })]),
    'batch_duplicate_source_unique_id',
  )
})

Deno.test('already finalized response and error sanitization helpers', () => {
  validateAlreadyFinalizedResponse({
    already_finalized: true,
    status: 'already_finalized',
    finalization_id: '11111111-1111-4111-8111-111111111111',
  })
  assertThrowsCode(() => validateAlreadyFinalizedResponse({ already_finalized: true, status: 'uploaded' }), 'finalization_id_required')
  if (publicErrorCode(new Error('raw database detail')) !== 'finalization_failed') {
    throw new Error('plain errors should sanitize to finalization_failed')
  }
})
