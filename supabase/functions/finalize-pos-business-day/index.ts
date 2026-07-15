import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import {
  SOURCE_SYSTEM,
  ValidationError,
  assertNoDuplicateBatchSourceIds,
  isRecord,
  optionalString,
  publicErrorCode,
  requiredDate,
  requiredHash,
  requiredInteger,
  requiredUuid,
  statusForError,
  validateAlreadyFinalizedResponse,
  validateBeginManifest,
  validatePeriodLabel,
  validateRecordEnvelope,
  validateSourceStore,
  validateStageIdentity,
  type JsonRecord,
} from './validation.ts'

type ConnectorRow = {
  id: string
  store_id: string
  connector_name: string
  source_system: string
  source_store_number: string | null
  status: string
  consecutive_failure_count: number
}

type StoreRow = {
  owner_id: string
}

type BeginRequest = {
  action: 'begin'
  source_system?: unknown
  source_store_number?: unknown
  source_file_name?: unknown
  source_file_hash?: unknown
  payload_hash?: unknown
  final_source_set_hash?: unknown
  business_date?: unknown
  period_type?: unknown
  period_number?: unknown
  source_period_label?: unknown
  period_open?: unknown
  period_close?: unknown
  expected_record_count?: unknown
  normalizer_version?: unknown
  schema_version?: unknown
  reconciliation_metadata?: unknown
}

type StageRequest = {
  action: 'stage'
  finalization_id?: unknown
  payload_hash?: unknown
  final_source_set_hash?: unknown
  batch_number?: unknown
  batch_count?: unknown
  records?: unknown
}

type FinalizeRequest = {
  action: 'finalize'
  finalization_id?: unknown
  payload_hash?: unknown
  final_source_set_hash?: unknown
}

type FailRequest = {
  action: 'fail'
  finalization_id?: unknown
  error_message?: unknown
}

type PrepareRequest = {
  action: 'prepare'
  source_store_number?: unknown
  business_date?: unknown
  records?: unknown
  payload_hash?: unknown
  source_period_label?: unknown
  period_number?: unknown
}

type FinalizationRow = {
  id: string
  store_id: string
  owner_id: string
  connector_id: string | null
  source_system: string
  source_store_number: string | null
  business_date: string
  payload_hash: string
  final_source_set_hash: string | null
  status: string
  closed_import_id: string | null
}

const MAX_BODY_BYTES = 12 * 1024 * 1024
const MAX_STAGE_RECORDS = 1000
const MAX_PREPARE_RECORDS = 10000
const MAX_EXPECTED_RECORDS = 10000

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function getAdminKey(): string {
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacyKey) return legacyKey

  const namedKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (namedKeys) {
    const parsed = JSON.parse(namedKeys) as Record<string, string>
    if (parsed.default) return parsed.default
  }

  const singleKey = Deno.env.get('SUPABASE_SECRET_KEY')
  if (singleKey) return singleKey

  throw new Error('No Supabase backend key is configured')
}

async function recordConnectorFailure(
  supabase: ReturnType<typeof createClient>,
  connector: ConnectorRow,
  message: string,
): Promise<void> {
  const nextFailureCount = Math.max(0, connector.consecutive_failure_count ?? 0) + 1
  await supabase
    .from('store_pos_connectors')
    .update({
      last_seen_at: new Date().toISOString(),
      last_error: message.slice(0, 2000),
      consecutive_failure_count: nextFailureCount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connector.id)
}

async function authenticateConnector(
  request: Request,
  requestId: string,
): Promise<{ supabase: ReturnType<typeof createClient>; connector: ConnectorRow; store: StoreRow } | Response> {
  const connectorToken = request.headers.get('x-storepulse-connector-token')?.trim()
  if (!connectorToken || connectorToken.length < 32 || connectorToken.length > 512) {
    return jsonResponse({ error: 'unauthorized', request_id: requestId }, 401)
  }

  let supabase: ReturnType<typeof createClient>
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    if (!supabaseUrl) throw new Error('SUPABASE_URL is not configured')
    supabase = createClient(supabaseUrl, getAdminKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-storepulse-request-id': requestId } },
    })
  } catch (error) {
    console.error(JSON.stringify({ request_id: requestId, stage: 'client_init', error: String(error) }))
    return jsonResponse({ error: 'service_unavailable', request_id: requestId }, 503)
  }

  const tokenHash = await sha256Hex(connectorToken)
  const { data: connectorData, error: connectorError } = await supabase
    .from('store_pos_connectors')
    .select('id, store_id, connector_name, source_system, source_store_number, status, consecutive_failure_count')
    .eq('token_hash', tokenHash)
    .eq('status', 'active')
    .maybeSingle()

  if (connectorError) {
    console.error(JSON.stringify({ request_id: requestId, stage: 'connector_lookup', code: connectorError.code }))
    return jsonResponse({ error: 'service_unavailable', request_id: requestId }, 503)
  }

  if (!connectorData) return jsonResponse({ error: 'unauthorized', request_id: requestId }, 401)

  const connector = connectorData as ConnectorRow
  if (connector.source_system !== SOURCE_SYSTEM) {
    await recordConnectorFailure(supabase, connector, 'Connector source system is not supported for finalization')
    return jsonResponse({ error: 'connector_misconfigured', request_id: requestId }, 409)
  }

  const { data: storeData, error: storeError } = await supabase
    .from('stores')
    .select('owner_id')
    .eq('id', connector.store_id)
    .single()

  if (storeError || !storeData?.owner_id) {
    await recordConnectorFailure(supabase, connector, 'Connector store owner could not be resolved')
    return jsonResponse({ error: 'connector_misconfigured', request_id: requestId }, 409)
  }

  return { supabase, connector, store: storeData as StoreRow }
}

async function ensureFinalizationOwnership(
  supabase: ReturnType<typeof createClient>,
  connector: ConnectorRow,
  store: StoreRow,
  finalizationId: string,
): Promise<FinalizationRow> {
  const { data, error } = await supabase
    .from('pos_business_day_finalizations')
    .select('id, store_id, owner_id, connector_id, source_system, source_store_number, business_date, payload_hash, final_source_set_hash, status, closed_import_id')
    .eq('id', finalizationId)
    .eq('store_id', connector.store_id)
    .eq('owner_id', store.owner_id)
    .eq('connector_id', connector.id)
    .eq('source_system', connector.source_system)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new ValidationError('finalization_not_found')
  return data as FinalizationRow
}

async function handlePrepare(
  supabase: ReturnType<typeof createClient>,
  connector: ConnectorRow,
  store: StoreRow,
  body: PrepareRequest,
) {
  const sourceStoreNumber = validateSourceStore(connector, body.source_store_number)
  const businessDate = requiredDate(body.business_date, 'business_date')
  if (body.payload_hash !== undefined) requiredHash(body.payload_hash, 'payload_hash')
  const periodNumber = optionalString(body.period_number, 100)
  const sourcePeriodLabel = optionalString(body.source_period_label, 500)
  if (periodNumber && !/^\d+$/.test(periodNumber)) throw new ValidationError('period_number_invalid')
  if (periodNumber && sourcePeriodLabel) validatePeriodLabel(sourcePeriodLabel, periodNumber)
  if (!Array.isArray(body.records)) throw new ValidationError('records_invalid')
  if (body.records.length === 0) throw new ValidationError('records_empty')
  if (body.records.length > MAX_PREPARE_RECORDS) throw new ValidationError('records_payload_too_large')
  const records = body.records.map((record) => validateRecordEnvelope(record, connector, businessDate))

  const { data, error } = await supabase.rpc('prepare_pos_business_day_finalization_hash', {
    p_store_id: connector.store_id,
    p_owner_id: store.owner_id,
    p_source_system: connector.source_system,
    p_source_store_number: sourceStoreNumber,
    p_business_date: businessDate,
    p_records: records,
  })
  if (error) throw error
  if (!isRecord(data)) throw new ValidationError('prepare_result_invalid')
  const expectedRecordCount = typeof data.expected_record_count === 'number' ? data.expected_record_count : Number(data.expected_record_count)
  const recordHashCount = typeof data.record_hash_count === 'number' ? data.record_hash_count : Number(data.record_hash_count)
  const finalSourceSetHashValue = requiredHash(data.final_source_set_hash, 'final_source_set_hash')
  if (!Number.isInteger(expectedRecordCount) || expectedRecordCount !== records.length) throw new ValidationError('prepare_count_mismatch')
  if (!Number.isInteger(recordHashCount) || recordHashCount !== records.length) throw new ValidationError('prepare_hash_count_mismatch')
  return {
    expected_record_count: expectedRecordCount,
    record_hash_count: recordHashCount,
    final_source_set_hash: finalSourceSetHashValue,
  }
}

async function handleBegin(
  supabase: ReturnType<typeof createClient>,
  connector: ConnectorRow,
  store: StoreRow,
  body: BeginRequest,
) {
  const manifest = validateBeginManifest(body as JsonRecord)
  if (manifest.sourceSystem !== connector.source_system) {
    throw new ValidationError('source_system_invalid')
  }
  const sourceStoreNumber = validateSourceStore(connector, body.source_store_number)
  const expectedRecordCount = manifest.expectedRecordCount
  if (expectedRecordCount <= 0 || expectedRecordCount > MAX_EXPECTED_RECORDS) throw new ValidationError('expected_record_count_invalid')
  const now = new Date().toISOString()

  const importPayload = {
    store_id: connector.store_id,
    owner_id: store.owner_id,
    connector_id: connector.id,
    source_system: connector.source_system,
    source_store_number: sourceStoreNumber,
    source_file_name: manifest.sourceFileName,
    normalized_file_name: optionalString(body.source_period_label, 500),
    source_file_hash: manifest.sourceFileHash,
    payload_hash: manifest.payloadHash,
    status: 'received',
    raw_record_count: 0,
    sale_like_record_count: 0,
    canonical_record_count: expectedRecordCount,
    normalizer_version: manifest.normalizerVersion,
    schema_version: manifest.schemaVersion,
    metadata: {
      ...manifest.metadata,
      import_type: 'closed_business_day_finalization',
      business_date: manifest.businessDate,
      source_period_label: manifest.sourcePeriodLabel,
      period_type: manifest.periodType,
      period_number: manifest.periodNumber,
      period_open: manifest.periodOpen,
      period_close: manifest.periodClose,
      received_at: now,
    },
  }

  let importId: string
  let createdImport = false
  const { data: insertedImport, error: insertError } = await supabase
    .from('pos_transaction_imports')
    .insert(importPayload)
    .select('id')
    .single()

  if (!insertError && insertedImport?.id) {
    importId = String(insertedImport.id)
    createdImport = true
  } else if (insertError?.code === '23505') {
    const { data: existingImport, error: existingError } = await supabase
      .from('pos_transaction_imports')
      .select('id')
      .eq('store_id', connector.store_id)
      .eq('source_system', connector.source_system)
      .eq('payload_hash', manifest.payloadHash)
      .single()
    if (existingError || !existingImport?.id) throw existingError ?? new ValidationError('import_lookup_failed')
    importId = String(existingImport.id)
  } else {
    throw insertError ?? new ValidationError('import_create_failed')
  }

  const { data: finalizationResult, error: finalizationError } = await supabase.rpc(
    'begin_pos_business_day_finalization',
    {
      p_store_id: connector.store_id,
      p_owner_id: store.owner_id,
      p_connector_id: connector.id,
      p_source_system: connector.source_system,
      p_source_store_number: sourceStoreNumber,
      p_business_date: manifest.businessDate,
      p_period_type: manifest.periodType,
      p_period_number: manifest.periodNumber,
      p_source_period_label: manifest.sourcePeriodLabel,
      p_period_open: manifest.periodOpen,
      p_period_close: manifest.periodClose,
      p_closed_import_id: importId,
      p_expected_record_count: expectedRecordCount,
      p_source_file_hash: manifest.sourceFileHash,
      p_payload_hash: manifest.payloadHash,
      p_final_source_set_hash: manifest.finalSourceSetHash,
      p_reconciliation_metadata: {
        ...manifest.metadata,
        normalizer_version: manifest.normalizerVersion,
        schema_version: manifest.schemaVersion,
      },
    },
  )
  if (finalizationError) {
    if (createdImport && statusForError(finalizationError) < 500) {
      await supabase
        .from('pos_transaction_imports')
        .update({
          status: 'failed',
          error_message: publicErrorCode(finalizationError).slice(0, 2000),
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', importId)
    }
    throw finalizationError
  }

  const result = isRecord(finalizationResult) ? finalizationResult : {}
  const alreadyFinalized = result.already_finalized === true
  if (alreadyFinalized) {
    const finalizationId = validateAlreadyFinalizedResponse(result)
    const finalization = await ensureFinalizationOwnership(supabase, connector, store, finalizationId)
    if (
      finalization.source_store_number !== sourceStoreNumber ||
      finalization.business_date !== manifest.businessDate ||
      finalization.payload_hash !== manifest.payloadHash ||
      finalization.final_source_set_hash !== manifest.finalSourceSetHash
    ) {
      throw new ValidationError('finalization_identity_mismatch')
    }
    await supabase
      .from('pos_transaction_imports')
      .update({
        status: 'completed',
        failed_count: 0,
        error_message: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', importId)
      .eq('store_id', connector.store_id)
      .eq('owner_id', store.owner_id)
      .eq('source_system', connector.source_system)
      .eq('payload_hash', manifest.payloadHash)
    return {
      import_id: importId,
      import_created: createdImport,
      payload_hash: manifest.payloadHash,
      final_source_set_hash: manifest.finalSourceSetHash,
      ...result,
      status: 'already_finalized',
      already_finalized: true,
    }
  } else {
    await supabase
      .from('pos_transaction_imports')
      .update({
        status: 'processing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', importId)
  }

  return {
    import_id: importId,
    import_created: createdImport,
    payload_hash: manifest.payloadHash,
    final_source_set_hash: manifest.finalSourceSetHash,
    ...result,
  }
}

async function handleStage(
  supabase: ReturnType<typeof createClient>,
  connector: ConnectorRow,
  store: StoreRow,
  body: StageRequest,
) {
  const finalizationId = requiredUuid(body.finalization_id, 'finalization_id')
  const finalization = await ensureFinalizationOwnership(supabase, connector, store, finalizationId)
  if (!['uploading', 'uploaded', 'reconciling'].includes(finalization.status)) {
    throw new ValidationError('finalization_not_mutable')
  }
  validateStageIdentity(finalization, body.payload_hash, body.final_source_set_hash)
  if (finalization.source_store_number !== connector.source_store_number) throw new ValidationError('finalization_source_store_mismatch')
  const batchNumber = requiredInteger(body.batch_number, 'batch_number')
  const batchCount = requiredInteger(body.batch_count, 'batch_count')
  if (batchNumber < 1 || batchCount < 1 || batchNumber > batchCount) throw new ValidationError('batch_index_invalid')
  if (!Array.isArray(body.records)) throw new ValidationError('records_invalid')
  if (body.records.length > MAX_STAGE_RECORDS) throw new ValidationError('records_batch_too_large')
  const records = body.records
  if (records.length === 0) throw new ValidationError('records_empty')
  for (const record of records) {
    validateRecordEnvelope(record, connector, finalization.business_date)
  }
  assertNoDuplicateBatchSourceIds(records)

  const { data, error } = await supabase.rpc('stage_pos_business_day_finalization_batch', {
    p_finalization_id: finalizationId,
    p_records: records,
  })
  if (error) throw error
  return {
    batch_number: batchNumber,
    batch_count: batchCount,
    ...(isRecord(data) ? data : {}),
  }
}

async function handleFinalize(
  supabase: ReturnType<typeof createClient>,
  connector: ConnectorRow,
  store: StoreRow,
  body: FinalizeRequest,
) {
  const finalizationId = requiredUuid(body.finalization_id, 'finalization_id')
  const finalization = await ensureFinalizationOwnership(supabase, connector, store, finalizationId)
  const payloadHashValue = body.payload_hash === undefined ? null : requiredHash(body.payload_hash, 'payload_hash')
  const finalSourceSetHashValue = body.final_source_set_hash === undefined ? null : requiredHash(body.final_source_set_hash, 'final_source_set_hash')
  if (payloadHashValue && finalization.payload_hash !== payloadHashValue) throw new ValidationError('finalization_identity_mismatch')
  if (finalSourceSetHashValue && finalization.final_source_set_hash !== finalSourceSetHashValue) throw new ValidationError('finalization_identity_mismatch')
  const { data, error } = await supabase.rpc('finalize_pos_business_day', {
    p_finalization_id: finalizationId,
  })
  if (error) throw error

  const result = isRecord(data) ? data : {}
  const alreadyFinalized = result.already_finalized === true
  const importId = optionalString(result.import_id, 64)
  const closedImportId = importId ?? finalization.closed_import_id
  if (closedImportId) {
    await supabase
      .from('pos_transaction_imports')
      .update({
        status: 'completed',
        inserted_count: typeof result.inserted_count === 'number' ? result.inserted_count : 0,
        updated_count: typeof result.updated_count === 'number' ? result.updated_count : 0,
        unchanged_count: typeof result.unchanged_count === 'number' ? result.unchanged_count : 0,
        failed_count: 0,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', closedImportId)
  }

  return {
    ...result,
    finalized: result.status === 'finalized',
    already_finalized: alreadyFinalized,
    final_source_set_hash: finalization.final_source_set_hash,
  }
}

async function handleFail(
  supabase: ReturnType<typeof createClient>,
  connector: ConnectorRow,
  store: StoreRow,
  body: FailRequest,
) {
  const finalizationId = requiredUuid(body.finalization_id, 'finalization_id')
  await ensureFinalizationOwnership(supabase, connector, store, finalizationId)
  const errorMessage = optionalString(body.error_message, 2000) ?? 'Finalization failed'
  const { data, error } = await supabase.rpc('mark_pos_business_day_finalization_failed', {
    p_finalization_id: finalizationId,
    p_error_message: errorMessage,
  })
  if (error) throw error
  return isRecord(data) ? data : {}
}

Deno.serve(async (request: Request): Promise<Response> => {
  const requestId = crypto.randomUUID()
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed', request_id: requestId }, 405)

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'payload_too_large', request_id: requestId }, 413)
  }

  const auth = await authenticateConnector(request, requestId)
  if (auth instanceof Response) return auth

  let body: unknown
  try {
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'payload_too_large', request_id: requestId }, 413)
    }
    body = JSON.parse(rawBody)
  } catch {
    return jsonResponse({ error: 'invalid_json', request_id: requestId }, 400)
  }

  if (!isRecord(body)) return jsonResponse({ error: 'request_body_must_be_object', request_id: requestId }, 400)
  const action = optionalString(body.action, 50)

  try {
    let result: JsonRecord
    if (action === 'prepare') {
      result = await handlePrepare(auth.supabase, auth.connector, auth.store, body as PrepareRequest)
    } else if (action === 'begin') {
      result = await handleBegin(auth.supabase, auth.connector, auth.store, body as BeginRequest)
    } else if (action === 'stage') {
      result = await handleStage(auth.supabase, auth.connector, auth.store, body as StageRequest)
    } else if (action === 'finalize') {
      result = await handleFinalize(auth.supabase, auth.connector, auth.store, body as FinalizeRequest)
    } else if (action === 'fail') {
      result = await handleFail(auth.supabase, auth.connector, auth.store, body as FailRequest)
    } else {
      return jsonResponse({ error: 'action_invalid', request_id: requestId }, 400)
    }

    return jsonResponse({
      request_id: requestId,
      action,
      ok: true,
      ...result,
    })
  } catch (error) {
    const publicCode = publicErrorCode(error)
    const status = statusForError(error)
    console.error(JSON.stringify({
      request_id: requestId,
      action,
      stage: 'finalize_pos_business_day',
      code: publicCode,
    }))
    return jsonResponse({ error: publicCode, request_id: requestId }, status)
  }
})
