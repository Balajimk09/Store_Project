import {
  authenticateConnector,
  jsonResponse,
  type ConnectorAuthResult,
} from '../_shared/connector-auth.ts'
import {
  PublishValidationError,
  readBoundedJsonBody,
  validateReportRequest,
  type ReportRequest,
} from '../_shared/pos-publish-contract.ts'

type ReportDependencies = {
  authenticateConnector?: (request: Request, requestId: string) => Promise<ConnectorAuthResult | Response>
  reportStatus?: (auth: ConnectorAuthResult, payload: ReportRequest) => Promise<{ job_id: string; status: string }>
  requestId?: () => string
}

type PublishRpcClient = {
  rpc: (name: string, parameters: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
}

async function defaultAuthenticateConnector(request: Request, requestId: string) {
  return await authenticateConnector(request, requestId, { distinguishInactive: true })
}

async function defaultReportStatus(auth: ConnectorAuthResult, payload: ReportRequest) {
  const parameters = {
    p_connector_id: auth.connector.id,
    p_job_id: payload.jobId,
    p_status: payload.status,
    p_verification_upc: payload.status === 'completed' ? payload.verification.upc : null,
    p_verification_price: payload.status === 'completed' ? payload.verification.price : null,
    p_failure_code: payload.status === 'failed' ? payload.errorCode : null,
    p_failure_message: payload.status === 'failed' ? payload.errorMessage : null,
  }
  const rpcClient = auth.supabase as unknown as PublishRpcClient
  const { data, error } = await rpcClient.rpc('report_pos_publish_job_status', parameters)
  if (error) throw error
  const result = Array.isArray(data) ? data[0] : null
  if (!result || result.job_id !== payload.jobId || result.status !== payload.status) throw new Error('invalid_report_result')
  return { job_id: result.job_id, status: result.status }
}

function errorResponse(error: unknown): Response {
  if (error instanceof PublishValidationError) return jsonResponse({ error: error.code }, error.status)
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : null
  if (code === '42501') return jsonResponse({ error: 'forbidden' }, 403)
  if (code === '23514' || code === '22023') return jsonResponse({ error: 'invalid_status_report' }, 400)
  return jsonResponse({ error: 'service_unavailable' }, 503)
}

export function createReportPosPublishJobStatusHandler(dependencies: ReportDependencies = {}) {
  const authenticate = dependencies.authenticateConnector ?? defaultAuthenticateConnector
  const reportStatus = dependencies.reportStatus ?? defaultReportStatus
  const requestIdProvider = dependencies.requestId ?? (() => crypto.randomUUID())

  return async function handleReport(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
    if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

    const requestId = requestIdProvider()
    const auth = await authenticate(request, requestId)
    if (auth instanceof Response) return auth

    try {
      const payload = validateReportRequest(await readBoundedJsonBody(request))
      const result = await reportStatus(auth, payload)
      if (result.job_id !== payload.jobId || result.status !== payload.status) throw new Error('invalid_report_result')
      return jsonResponse({ job_id: result.job_id, status: result.status })
    } catch (error) {
      return errorResponse(error)
    }
  }
}

if (import.meta.main) {
  Deno.serve(createReportPosPublishJobStatusHandler())
}
