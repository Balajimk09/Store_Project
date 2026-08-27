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
  if ('operation' in payload && payload.operation === 'create_product') {
    const verification = payload.status === 'completed' ? payload.verification : null
    const { data, error } = await (auth.supabase as unknown as PublishRpcClient).rpc('report_commander_product_create_status', {
      p_connector_id: auth.connector.id, p_job_id: payload.jobId, p_status: payload.status,
      p_verification_upc: verification?.upc ?? null, p_verification_modifier: verification?.modifier ?? null,
      p_verification_description: verification && 'description' in verification ? verification.description : null,
      p_verification_department: verification && 'department' in verification ? verification.department : null,
      p_verification_price: verification?.price ?? null,
      p_verification_payment_product_code: verification && 'payment_product_code' in verification ? verification.payment_product_code : null,
      p_verification_selling_unit: verification && 'selling_unit' in verification ? verification.selling_unit : null,
      p_verification_max_qty_per_trans: verification && 'maximum_quantity_per_transaction' in verification ? verification.maximum_quantity_per_transaction : null,
      p_verification_taxable_rebate: verification && 'taxable_rebate' in verification ? verification.taxable_rebate : null,
      p_verification_tax_rate_ids: verification && 'tax_rate_ids' in verification ? verification.tax_rate_ids : null,
      p_verification_id_check_ids: verification && 'id_check_ids' in verification ? verification.id_check_ids : null,
      p_verification_flag_ids: verification && 'flag_ids' in verification ? verification.flag_ids : null,
      p_failure_code: payload.status === 'failed' ? payload.errorCode : null, p_failure_message: payload.status === 'failed' ? payload.errorMessage : null,
    })
    if (error) throw error
    const result = Array.isArray(data) ? data[0] : null
    if (!result || result.job_id !== payload.jobId || result.status !== payload.status) throw new Error('invalid_report_result')
    return { job_id: result.job_id, status: result.status }
  }
  const completedVerification = payload.status === 'completed' ? payload.verification : null
  const productVerification = completedVerification
    && 'description' in completedVerification
    && 'department' in completedVerification
    ? completedVerification
    : null

  const fullProductVerification =
    productVerification
    && 'payment_product_code' in productVerification
    && 'selling_unit' in productVerification
    && 'maximum_quantity_per_transaction' in productVerification
    && 'taxable_rebate' in productVerification
    && 'tax_rate_ids' in productVerification
    && 'id_check_ids' in productVerification
      ? productVerification
      : null

  const parameters = {
    p_connector_id: auth.connector.id,
    p_job_id: payload.jobId,
    p_status: payload.status,

    p_verification_upc:
      completedVerification?.upc ?? null,

    p_verification_modifier:
      completedVerification?.modifier ?? null,

    p_verification_description:
      productVerification?.description ?? null,

    p_verification_department:
      productVerification?.department ?? null,

    p_verification_price:
      completedVerification?.price ?? null,

    p_verification_payment_product_code:
      fullProductVerification?.payment_product_code ?? null,

    p_verification_selling_unit:
      fullProductVerification?.selling_unit ?? null,

    p_verification_max_qty_per_trans:
      fullProductVerification?.maximum_quantity_per_transaction ?? null,

    p_verification_taxable_rebate:
      fullProductVerification?.taxable_rebate ?? null,

    p_verification_tax_rate_ids:
      fullProductVerification?.tax_rate_ids ?? null,

    p_verification_id_check_ids:
      fullProductVerification?.id_check_ids ?? null,

    p_failure_code:
      payload.status === 'failed'
        ? payload.errorCode
        : null,

    p_failure_message:
      payload.status === 'failed'
        ? payload.errorMessage
        : null,
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
