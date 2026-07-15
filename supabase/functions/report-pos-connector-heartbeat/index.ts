import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  authenticateConnector,
  jsonResponse,
  VERIFONE_SOURCE_SYSTEM,
  type ConnectorRow,
} from '../_shared/connector-auth.ts'

type JsonRecord = Record<string, unknown>

const MAX_BODY_BYTES = 64 * 1024
const MAX_SAFE_TEXT = 1000
const MAX_VERSION_LENGTH = 100
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000
const REPORTING_STATES = new Set(['starting', 'ready', 'syncing', 'degraded', 'error', 'stopping'])
const COMMANDER_STATES = new Set(['unknown', 'connected', 'unreachable', 'authentication_failed', 'error'])
const CLOUD_STATES = new Set(['unknown', 'connected', 'error'])

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown, max = MAX_SAFE_TEXT): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new ValidationError('field_invalid')
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function requiredString(value: unknown, field: string, max = MAX_SAFE_TEXT): string {
  if (typeof value !== 'string' || value.trim() === '') throw new ValidationError(`${field}_invalid`)
  if (value.length > max) throw new ValidationError(`${field}_too_large`)
  return value.trim()
}

function requiredUuid(value: unknown, field: string): string {
  const text = requiredString(value, field, 100)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new ValidationError(`${field}_invalid`)
  }
  return text.toLowerCase()
}

function timestamp(value: unknown, field: string, nullable = false): string | null {
  if ((value === null || value === undefined) && nullable) return null
  const text = requiredString(value, field, 100)
  const millis = Date.parse(text)
  if (!Number.isFinite(millis)) throw new ValidationError(`${field}_invalid`)
  if (millis > Date.now() + FUTURE_TOLERANCE_MS) throw new ValidationError(`${field}_future`)
  return new Date(millis).toISOString()
}

function enumValue(value: unknown, field: string, allowed: Set<string>): string {
  const text = requiredString(value, field, 100)
  if (!allowed.has(text)) throw new ValidationError(`${field}_invalid`)
  return text
}

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${field}_invalid`)
  }
  return value
}

class ValidationError extends Error {
  constructor(public code: string, public status = 400) {
    super(code)
  }
}

function publicError(error: unknown): { code: string; status: number } {
  if (error instanceof ValidationError) return { code: error.code, status: error.status }
  return { code: 'service_unavailable', status: 503 }
}

function validateHeartbeat(body: unknown, connector: ConnectorRow) {
  if (!isRecord(body)) throw new ValidationError('request_body_must_be_object')
  const allowed = new Set([
    'payload_version',
    'installation_id',
    'source_store_number',
    'service_version',
    'runtime_mode',
    'reported_state',
    'runtime_started_at',
    'heartbeat_at',
    'last_sync_started_at',
    'last_sync_completed_at',
    'last_success_at',
    'last_failure_at',
    'last_error_code',
    'last_error_message',
    'consecutive_failure_count',
    'commander_status',
    'cloud_status',
    'live_poll_interval_seconds',
    'canonical_record_count',
    'inserted_count',
    'updated_count',
    'unchanged_count',
    'failed_count',
    'last_request_id',
  ])
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new ValidationError('unknown_field')
  }
  const payloadVersion = requiredString(body.payload_version, 'payload_version', 10)
  if (payloadVersion !== '1') throw new ValidationError('payload_version_unsupported')
  const sourceStoreNumber = optionalString(body.source_store_number, 100)
  if (sourceStoreNumber && connector.source_store_number && sourceStoreNumber !== connector.source_store_number) {
    throw new ValidationError('source_store_mismatch', 409)
  }
  const pollInterval = count(body.live_poll_interval_seconds, 'live_poll_interval_seconds')
  if (pollInterval < 1 || pollInterval > 86400) throw new ValidationError('live_poll_interval_seconds_invalid')
  const consecutiveFailures = count(body.consecutive_failure_count, 'consecutive_failure_count')
  return {
    payloadVersion,
    installationId: requiredUuid(body.installation_id, 'installation_id'),
    sourceStoreNumber,
    serviceVersion: requiredString(body.service_version, 'service_version', MAX_VERSION_LENGTH),
    runtimeMode: requiredString(body.runtime_mode, 'runtime_mode', 50),
    reportedState: enumValue(body.reported_state, 'reported_state', REPORTING_STATES),
    runtimeStartedAt: timestamp(body.runtime_started_at, 'runtime_started_at'),
    heartbeatAt: timestamp(body.heartbeat_at, 'heartbeat_at'),
    lastSyncStartedAt: timestamp(body.last_sync_started_at, 'last_sync_started_at', true),
    lastSyncCompletedAt: timestamp(body.last_sync_completed_at, 'last_sync_completed_at', true),
    lastSuccessAt: timestamp(body.last_success_at, 'last_success_at', true),
    lastFailureAt: timestamp(body.last_failure_at, 'last_failure_at', true),
    lastErrorCode: optionalString(body.last_error_code, 100),
    lastErrorMessage: optionalString(body.last_error_message, MAX_SAFE_TEXT),
    consecutiveFailures,
    commanderStatus: enumValue(body.commander_status, 'commander_status', COMMANDER_STATES),
    cloudStatus: enumValue(body.cloud_status, 'cloud_status', CLOUD_STATES),
    livePollInterval: pollInterval,
    canonicalRecordCount: count(body.canonical_record_count, 'canonical_record_count'),
    insertedCount: count(body.inserted_count, 'inserted_count'),
    updatedCount: count(body.updated_count, 'updated_count'),
    unchangedCount: count(body.unchanged_count, 'unchanged_count'),
    failedCount: count(body.failed_count, 'failed_count'),
    lastRequestId: optionalString(body.last_request_id, 200),
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  const requestId = crypto.randomUUID()
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed', request_id: requestId }, 405)

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'payload_too_large', request_id: requestId }, 413)
  }

  const auth = await authenticateConnector(request, requestId, { sourceSystem: VERIFONE_SOURCE_SYSTEM })
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

  try {
    const payload = validateHeartbeat(body, auth.connector)
    if (auth.connector.installation_id && auth.connector.installation_id !== payload.installationId) {
      return jsonResponse({ error: 'installation_mismatch', request_id: requestId }, 409)
    }
    const installationBound = !auth.connector.installation_id
    const now = new Date().toISOString()
    const clearError = ['ready', 'syncing', 'starting'].includes(payload.reportedState) &&
      payload.consecutiveFailures === 0 &&
      payload.failedCount === 0

    const updatePayload: JsonRecord = {
      installation_id: auth.connector.installation_id ?? payload.installationId,
      service_version: payload.serviceVersion,
      runtime_mode: payload.runtimeMode,
      reported_state: payload.reportedState,
      runtime_started_at: payload.runtimeStartedAt,
      last_seen_at: now,
      last_heartbeat_at: now,
      last_sync_started_at: payload.lastSyncStartedAt,
      last_sync_completed_at: payload.lastSyncCompletedAt,
      last_success_at: payload.lastSuccessAt,
      last_failure_at: payload.lastFailureAt,
      last_error_code: clearError ? null : payload.lastErrorCode,
      last_error: clearError ? null : payload.lastErrorMessage,
      consecutive_failure_count: payload.consecutiveFailures,
      commander_status: payload.commanderStatus,
      cloud_status: payload.cloudStatus,
      live_poll_interval_seconds: payload.livePollInterval,
      last_canonical_record_count: payload.canonicalRecordCount,
      last_inserted_count: payload.insertedCount,
      last_updated_count: payload.updatedCount,
      last_unchanged_count: payload.unchangedCount,
      last_failed_count: payload.failedCount,
      last_request_id: payload.lastRequestId,
      heartbeat_payload_version: payload.payloadVersion,
      updated_at: now,
    }

    const { error } = await auth.supabase
      .from('store_pos_connectors')
      .update(updatePayload)
      .eq('id', auth.connector.id)
      .eq('status', 'active')

    if (error) {
      console.error(JSON.stringify({ request_id: requestId, stage: 'heartbeat_update', code: error.code }))
      return jsonResponse({ error: 'service_unavailable', request_id: requestId }, 503)
    }

    return jsonResponse({
      ok: true,
      request_id: requestId,
      connector_id: auth.connector.id,
      server_received_at: now,
      installation_bound: installationBound,
      next_heartbeat_seconds: payload.livePollInterval,
    })
  } catch (error) {
    const publicErrorValue = publicError(error)
    return jsonResponse({ error: publicErrorValue.code, request_id: requestId }, publicErrorValue.status)
  }
})
