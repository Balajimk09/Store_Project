import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'

type JsonRecord = Record<string, unknown>

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

type ImportRow = {
  id: string
  status: string
  canonical_record_count: number
  inserted_count: number
  updated_count: number
  unchanged_count: number
  failed_count: number
}

const MAX_BODY_BYTES = 10 * 1024 * 1024
const MAX_TRANSACTIONS = 10_000
const SOURCE_SYSTEM = 'verifone_commander'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown, maxLength = 500): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return 0
  return value
}

function isValidBusinessDate(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false

  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function getAdminKey(): string {
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacyKey) return legacyKey

  const namedKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (namedKeys) {
    const parsed = JSON.parse(namedKeys) as Record<string, string>
    const defaultKey = parsed.default
    if (defaultKey) return defaultKey
  }

  const singleKey = Deno.env.get('SUPABASE_SECRET_KEY')
  if (singleKey) return singleKey

  throw new Error('No Supabase backend key is configured')
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
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

Deno.serve(async (request: Request): Promise<Response> => {
  const requestId = crypto.randomUUID()

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', request_id: requestId }, 405)
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'payload_too_large', request_id: requestId }, 413)
  }

  const connectorToken = request.headers.get('x-storepulse-connector-token')?.trim()
  if (!connectorToken || connectorToken.length < 32 || connectorToken.length > 512) {
    return jsonResponse({ error: 'unauthorized', request_id: requestId }, 401)
  }

  let supabase
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
    .select(
      'id, store_id, connector_name, source_system, source_store_number, status, consecutive_failure_count',
    )
    .eq('token_hash', tokenHash)
    .eq('status', 'active')
    .maybeSingle()

  if (connectorError) {
    console.error(
      JSON.stringify({ request_id: requestId, stage: 'connector_lookup', code: connectorError.code }),
    )
    return jsonResponse({ error: 'service_unavailable', request_id: requestId }, 503)
  }

  if (!connectorData) {
    return jsonResponse({ error: 'unauthorized', request_id: requestId }, 401)
  }

  const connector = connectorData as ConnectorRow
  if (connector.source_system !== SOURCE_SYSTEM) {
    await recordConnectorFailure(supabase, connector, 'Connector source system is not supported')
    return jsonResponse({ error: 'connector_misconfigured', request_id: requestId }, 409)
  }

  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return jsonResponse({ error: 'invalid_request_body', request_id: requestId }, 400)
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'payload_too_large', request_id: requestId }, 413)
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return jsonResponse({ error: 'invalid_json', request_id: requestId }, 400)
  }

  if (!isRecord(body)) {
    return jsonResponse({ error: 'request_body_must_be_object', request_id: requestId }, 400)
  }

  const transactions = body.transactions
  if (!Array.isArray(transactions)) {
    return jsonResponse({ error: 'transactions_must_be_array', request_id: requestId }, 400)
  }

  if (transactions.length > MAX_TRANSACTIONS) {
    return jsonResponse({ error: 'too_many_transactions', request_id: requestId }, 413)
  }

  const requestedStoreNumber = optionalString(body.source_store_number, 100)
  if (
    requestedStoreNumber &&
    connector.source_store_number &&
    requestedStoreNumber !== connector.source_store_number
  ) {
    return jsonResponse({ error: 'source_store_mismatch', request_id: requestId }, 409)
  }

  for (let index = 0; index < transactions.length; index += 1) {
    const transaction = transactions[index]
    if (!isRecord(transaction)) {
      return jsonResponse(
        { error: 'transaction_must_be_object', record_index: index, request_id: requestId },
        400,
      )
    }

    const transactionSource = optionalString(transaction.source_system, 100) ?? SOURCE_SYSTEM
    if (transactionSource !== connector.source_system) {
      return jsonResponse(
        { error: 'transaction_source_mismatch', record_index: index, request_id: requestId },
        409,
      )
    }

    const transactionStore = optionalString(transaction.store_number, 100)
    if (
      transactionStore &&
      connector.source_store_number &&
      transactionStore !== connector.source_store_number
    ) {
      return jsonResponse(
        { error: 'transaction_store_mismatch', record_index: index, request_id: requestId },
        409,
      )
    }

    if (
      Object.prototype.hasOwnProperty.call(transaction, 'business_date') &&
      !isValidBusinessDate(transaction.business_date)
    ) {
      return jsonResponse(
        { error: 'invalid_business_date', record_index: index, request_id: requestId },
        400,
      )
    }
  }

  const metadata = isRecord(body.metadata) ? body.metadata : {}
  if (JSON.stringify(metadata).length > 100_000) {
    return jsonResponse({ error: 'metadata_too_large', request_id: requestId }, 413)
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

  const store = storeData as StoreRow
  const payloadHash = await sha256Hex(JSON.stringify(transactions))
  const now = new Date().toISOString()

  const importPayload = {
    store_id: connector.store_id,
    owner_id: store.owner_id,
    connector_id: connector.id,
    source_system: connector.source_system,
    source_store_number: connector.source_store_number ?? requestedStoreNumber,
    source_file_name: optionalString(body.source_file_name),
    normalized_file_name: optionalString(body.normalized_file_name),
    source_file_hash: optionalString(body.source_file_hash, 128),
    payload_hash: payloadHash,
    status: 'received',
    raw_record_count: nonNegativeInteger(body.raw_record_count),
    sale_like_record_count: nonNegativeInteger(body.sale_like_record_count),
    canonical_record_count: transactions.length,
    normalizer_version: optionalString(body.normalizer_version, 100),
    schema_version: optionalString(body.schema_version, 50) ?? '1',
    metadata: {
      ...metadata,
      request_id: requestId,
      received_at: now,
    },
  }

  let importRow: ImportRow | null = null
  let duplicatePayload = false

  const { data: insertedImport, error: insertError } = await supabase
    .from('pos_transaction_imports')
    .insert(importPayload)
    .select(
      'id, status, canonical_record_count, inserted_count, updated_count, unchanged_count, failed_count',
    )
    .single()

  if (!insertError && insertedImport) {
    importRow = insertedImport as ImportRow
  } else if (insertError?.code === '23505') {
    duplicatePayload = true
    const { data: existingImport, error: existingError } = await supabase
      .from('pos_transaction_imports')
      .select(
        'id, status, canonical_record_count, inserted_count, updated_count, unchanged_count, failed_count',
      )
      .eq('store_id', connector.store_id)
      .eq('source_system', connector.source_system)
      .eq('payload_hash', payloadHash)
      .single()

    if (existingError || !existingImport) {
      console.error(
        JSON.stringify({ request_id: requestId, stage: 'duplicate_lookup', code: existingError?.code }),
      )
      return jsonResponse({ error: 'service_unavailable', request_id: requestId }, 503)
    }

    importRow = existingImport as ImportRow
  } else {
    console.error(
      JSON.stringify({ request_id: requestId, stage: 'import_create', code: insertError?.code }),
    )
    await recordConnectorFailure(supabase, connector, 'Unable to create transaction import')
    return jsonResponse({ error: 'import_create_failed', request_id: requestId }, 500)
  }

  if (
    duplicatePayload &&
    ['completed', 'completed_with_errors', 'duplicate'].includes(importRow.status)
  ) {
    return jsonResponse({
      request_id: requestId,
      duplicate_payload: true,
      import_id: importRow.id,
      status: importRow.status,
      canonical_record_count: importRow.canonical_record_count,
      inserted_count: importRow.inserted_count,
      updated_count: importRow.updated_count,
      unchanged_count: importRow.unchanged_count,
      failed_count: importRow.failed_count,
    })
  }

  if (duplicatePayload && importRow.status === 'processing') {
    return jsonResponse(
      {
        request_id: requestId,
        duplicate_payload: true,
        import_id: importRow.id,
        status: importRow.status,
      },
      202,
    )
  }

  const { data: batchResult, error: batchError } = await supabase.rpc(
    'ingest_pos_transaction_batch',
    {
      p_store_id: connector.store_id,
      p_owner_id: store.owner_id,
      p_connector_id: connector.id,
      p_import_id: importRow.id,
      p_transactions: transactions,
    },
  )

  if (batchError) {
    console.error(
      JSON.stringify({ request_id: requestId, stage: 'batch_ingest', code: batchError.code }),
    )

    await supabase
      .from('pos_transaction_imports')
      .update({
        status: 'failed',
        error_message: 'Batch ingestion failed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', importRow.id)

    await recordConnectorFailure(supabase, connector, 'Batch ingestion failed')
    return jsonResponse(
      { error: 'batch_ingest_failed', import_id: importRow.id, request_id: requestId },
      500,
    )
  }

  console.log(
    JSON.stringify({
      request_id: requestId,
      connector_id: connector.id,
      import_id: importRow.id,
      duplicate_payload: duplicatePayload,
      result: batchResult,
    }),
  )

  return jsonResponse({
    request_id: requestId,
    duplicate_payload: duplicatePayload,
    ...((batchResult ?? {}) as JsonRecord),
  })
})
