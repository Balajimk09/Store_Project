import {
  authenticateConnector,
  jsonResponse,
  VERIFONE_SOURCE_SYSTEM,
  type ConnectorAuthResult,
  type ConnectorRow,
} from '../_shared/connector-auth.ts'

type JsonRecord = Record<string, unknown>
type HeartbeatConnectorUpdateRow = Pick<ConnectorRow, 'id' | 'status' | 'installation_id'>
type HeartbeatConnectorQuery = {
  update: (payload: JsonRecord) => HeartbeatConnectorQuery
  select: (fields: string) => HeartbeatConnectorQuery
  eq: (field: string, value: unknown) => HeartbeatConnectorQuery
  is: (field: string, value: unknown) => HeartbeatConnectorQuery
  maybeSingle: () => Promise<{ data: HeartbeatConnectorUpdateRow | null; error: unknown }>
}

export const MAX_BODY_BYTES = 64 * 1024
const MAX_SAFE_TEXT = 1000
const MAX_VERSION_LENGTH = 100
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000
const REPORTING_STATES = new Set(['starting', 'ready', 'syncing', 'degraded', 'error', 'stopping'])
const COMMANDER_STATES = new Set(['unknown', 'connected', 'unreachable', 'authentication_failed', 'error'])
const CLOUD_STATES = new Set(['unknown', 'connected', 'error'])
const RUNTIME_MODES = new Set(['Validate', 'Once', 'Run'])
const ERROR_CODES = new Set([
  'commander_unreachable',
  'commander_authentication_failed',
  'commander_response_invalid',
  'cloud_unreachable',
  'cloud_unauthorized',
  'cloud_rejected',
  'heartbeat_unreachable',
  'heartbeat_unauthorized',
  'heartbeat_rejected',
  'installation_mismatch',
  'normalization_failed',
  'unknown_error',
])
const HEARTBEAT_UPDATE_SELECT = 'id, status, installation_id'

export type HeartbeatPayload = ReturnType<typeof validateHeartbeat>

export type HeartbeatUpdateResult = {
  connector: Pick<ConnectorRow, 'id' | 'status' | 'installation_id'>
  installationBound: boolean
}

export type HeartbeatDependencies = {
  authenticateConnector?: (request: Request, requestId: string) => Promise<ConnectorAuthResult | Response>
  updateHeartbeat?: (
    auth: ConnectorAuthResult,
    payload: HeartbeatPayload,
    updatePayload: JsonRecord,
  ) => Promise<HeartbeatUpdateResult | 'installation_mismatch' | 'unauthorized' | 'not_found'>
  now?: () => Date
  requestId?: () => string
}

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

function timestamp(value: unknown, field: string, now: Date, nullable = false): string | null {
  if ((value === null || value === undefined) && nullable) return null
  const text = requiredString(value, field, 100)
  const millis = Date.parse(text)
  if (!Number.isFinite(millis)) throw new ValidationError(`${field}_invalid`)
  if (millis > now.getTime() + FUTURE_TOLERANCE_MS) throw new ValidationError(`${field}_future`)
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

export class ValidationError extends Error {
  constructor(public code: string, public status = 400) {
    super(code)
  }
}

function publicError(error: unknown): { code: string; status: number } {
  if (error instanceof ValidationError) return { code: error.code, status: error.status }
  return { code: 'service_unavailable', status: 503 }
}

function timeMillis(value: string | null): number | null {
  return value === null ? null : Date.parse(value)
}

export function validateHeartbeat(body: unknown, connector: ConnectorRow, now: Date) {
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
  if (connector.source_system !== VERIFONE_SOURCE_SYSTEM) throw new ValidationError('connector_misconfigured', 409)
  const payloadVersion = requiredString(body.payload_version, 'payload_version', 10)
  if (payloadVersion !== '1') throw new ValidationError('payload_version_unsupported')
  const sourceStoreNumber = optionalString(body.source_store_number, 64)
  if (sourceStoreNumber && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(sourceStoreNumber)) {
    throw new ValidationError('source_store_number_invalid')
  }
  if (sourceStoreNumber && connector.source_store_number && sourceStoreNumber !== connector.source_store_number) {
    throw new ValidationError('source_store_mismatch', 409)
  }
  const pollInterval = count(body.live_poll_interval_seconds, 'live_poll_interval_seconds')
  if (pollInterval < 1 || pollInterval > 86400) throw new ValidationError('live_poll_interval_seconds_invalid')
  const consecutiveFailures = count(body.consecutive_failure_count, 'consecutive_failure_count')
  const runtimeStartedAt = timestamp(body.runtime_started_at, 'runtime_started_at', now)
  const heartbeatAt = timestamp(body.heartbeat_at, 'heartbeat_at', now)
  const lastSyncStartedAt = timestamp(body.last_sync_started_at, 'last_sync_started_at', now, true)
  const lastSyncCompletedAt = timestamp(body.last_sync_completed_at, 'last_sync_completed_at', now, true)
  const lastSuccessAt = timestamp(body.last_success_at, 'last_success_at', now, true)
  const lastFailureAt = timestamp(body.last_failure_at, 'last_failure_at', now, true)
  const lastErrorCode = optionalString(body.last_error_code, 100)
  const canonicalRecordCount = count(body.canonical_record_count, 'canonical_record_count')
  const insertedCount = count(body.inserted_count, 'inserted_count')
  const updatedCount = count(body.updated_count, 'updated_count')
  const unchangedCount = count(body.unchanged_count, 'unchanged_count')
  const failedCount = count(body.failed_count, 'failed_count')

  if (timeMillis(runtimeStartedAt)! > timeMillis(heartbeatAt)!) throw new ValidationError('runtime_started_at_after_heartbeat')
  if (
    lastSyncStartedAt &&
    lastSyncCompletedAt &&
    timeMillis(lastSyncCompletedAt)! < timeMillis(lastSyncStartedAt)!
  ) {
    throw new ValidationError('last_sync_completed_at_before_started')
  }
  if (lastSuccessAt && lastSyncCompletedAt && timeMillis(lastSuccessAt)! > timeMillis(lastSyncCompletedAt)!) {
    throw new ValidationError('last_success_at_after_completion')
  }
  if (lastFailureAt && lastSyncCompletedAt && timeMillis(lastFailureAt)! > timeMillis(lastSyncCompletedAt)!) {
    throw new ValidationError('last_failure_at_after_completion')
  }
  if (lastErrorCode && !ERROR_CODES.has(lastErrorCode)) throw new ValidationError('last_error_code_invalid')
  if (insertedCount + updatedCount + unchangedCount + failedCount > canonicalRecordCount) {
    throw new ValidationError('count_totals_exceed_canonical')
  }

  return {
    payloadVersion,
    installationId: requiredUuid(body.installation_id, 'installation_id'),
    sourceStoreNumber,
    serviceVersion: requiredString(body.service_version, 'service_version', MAX_VERSION_LENGTH),
    runtimeMode: enumValue(body.runtime_mode, 'runtime_mode', RUNTIME_MODES),
    reportedState: enumValue(body.reported_state, 'reported_state', REPORTING_STATES),
    runtimeStartedAt,
    heartbeatAt,
    lastSyncStartedAt,
    lastSyncCompletedAt,
    lastSuccessAt,
    lastFailureAt,
    lastErrorCode,
    lastErrorMessage: optionalString(body.last_error_message, MAX_SAFE_TEXT),
    consecutiveFailures,
    commanderStatus: enumValue(body.commander_status, 'commander_status', COMMANDER_STATES),
    cloudStatus: enumValue(body.cloud_status, 'cloud_status', CLOUD_STATES),
    livePollInterval: pollInterval,
    canonicalRecordCount,
    insertedCount,
    updatedCount,
    unchangedCount,
    failedCount,
    lastRequestId: optionalString(body.last_request_id, 200),
  }
}

async function defaultAuthenticateConnector(request: Request, requestId: string) {
  return await authenticateConnector(request, requestId, { sourceSystem: VERIFONE_SOURCE_SYSTEM })
}

export async function defaultUpdateHeartbeat(
  auth: ConnectorAuthResult,
  payload: HeartbeatPayload,
  updatePayload: JsonRecord,
): Promise<HeartbeatUpdateResult | 'installation_mismatch' | 'unauthorized' | 'not_found'> {
  const table = () => auth.supabase.from('store_pos_connectors') as unknown as HeartbeatConnectorQuery

  const { data: boundData, error: boundError } = await table()
    .update(updatePayload)
    .eq('id', auth.connector.id)
    .eq('status', 'active')
    .is('installation_id', null)
    .select(HEARTBEAT_UPDATE_SELECT)
    .maybeSingle()

  if (boundError) throw boundError
  if (boundData?.id === auth.connector.id && boundData.status === 'active' && boundData.installation_id === payload.installationId) {
    return {
      connector: boundData as Pick<ConnectorRow, 'id' | 'status' | 'installation_id'>,
      installationBound: true,
    }
  }

  const { data: matchingData, error: matchingError } = await table()
    .update(updatePayload)
    .eq('id', auth.connector.id)
    .eq('status', 'active')
    .eq('installation_id', payload.installationId)
    .select(HEARTBEAT_UPDATE_SELECT)
    .maybeSingle()

  if (matchingError) throw matchingError
  if (matchingData?.id === auth.connector.id && matchingData.status === 'active' && matchingData.installation_id === payload.installationId) {
    return {
      connector: matchingData as Pick<ConnectorRow, 'id' | 'status' | 'installation_id'>,
      installationBound: false,
    }
  }

  const { data: current, error: currentError } = await table()
    .select(HEARTBEAT_UPDATE_SELECT)
    .eq('id', auth.connector.id)
    .maybeSingle()
  if (currentError) throw currentError
  if (!current) return 'not_found'
  if (current.status !== 'active') return 'unauthorized'
  if (current.installation_id && current.installation_id !== payload.installationId) return 'installation_mismatch'
  return 'not_found'
}

export function createHeartbeatHandler(dependencies: HeartbeatDependencies = {}) {
  const authenticate = dependencies.authenticateConnector ?? defaultAuthenticateConnector
  const updateHeartbeat = dependencies.updateHeartbeat ?? defaultUpdateHeartbeat
  const nowProvider = dependencies.now ?? (() => new Date())
  const requestIdProvider = dependencies.requestId ?? (() => crypto.randomUUID())

  return async function handleHeartbeat(request: Request): Promise<Response> {
    const requestId = requestIdProvider()
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
    if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed', request_id: requestId }, 405)

    const contentLength = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'payload_too_large', request_id: requestId }, 413)
    }

    let auth: ConnectorAuthResult | Response
    try {
      auth = await authenticate(request, requestId)
    } catch (error) {
      console.error(JSON.stringify({ request_id: requestId, stage: 'connector_auth', error: 'connector_auth_failed' }))
      return jsonResponse({ error: 'service_unavailable', request_id: requestId }, 503)
    }
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
      const now = nowProvider()
      const payload = validateHeartbeat(body, auth.connector, now)
      const serverReceivedAt = now.toISOString()
      const clearError = ['ready', 'syncing', 'starting'].includes(payload.reportedState) &&
        payload.consecutiveFailures === 0 &&
        payload.failedCount === 0

      const updatePayload: JsonRecord = {
        installation_id: payload.installationId,
        service_version: payload.serviceVersion,
        runtime_mode: payload.runtimeMode,
        reported_state: payload.reportedState,
        runtime_started_at: payload.runtimeStartedAt,
        last_seen_at: serverReceivedAt,
        last_heartbeat_at: serverReceivedAt,
        reported_heartbeat_at: payload.heartbeatAt,
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
        updated_at: serverReceivedAt,
      }

      const result = await updateHeartbeat(auth, payload, updatePayload)
      if (result === 'installation_mismatch') {
        return jsonResponse({ error: 'installation_mismatch', request_id: requestId }, 409)
      }
      if (result === 'unauthorized') return jsonResponse({ error: 'unauthorized', request_id: requestId }, 401)
      if (result === 'not_found') return jsonResponse({ error: 'update_conflict', request_id: requestId }, 409)
      if (result.connector.id !== auth.connector.id || result.connector.status !== 'active' || result.connector.installation_id !== payload.installationId) {
        return jsonResponse({ error: 'update_conflict', request_id: requestId }, 409)
      }

      return jsonResponse({
        ok: true,
        request_id: requestId,
        connector_id: auth.connector.id,
        server_received_at: serverReceivedAt,
        installation_bound: result.installationBound,
        next_heartbeat_seconds: payload.livePollInterval,
      })
    } catch (error) {
      const safeLogCode = error instanceof ValidationError ? error.code : 'heartbeat_handler_failed'
      console.error(JSON.stringify({ request_id: requestId, stage: 'heartbeat_handler', error: safeLogCode }))
      const publicErrorValue = publicError(error)
      return jsonResponse({ error: publicErrorValue.code, request_id: requestId }, publicErrorValue.status)
    }
  }
}
