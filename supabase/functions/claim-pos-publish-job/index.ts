import {
  authenticateConnector,
  jsonResponse,
  type ConnectorAuthResult,
} from '../_shared/connector-auth.ts'
import {
  PublishValidationError,
  isSafeClaimedPublishJob,
  readBoundedJsonBody,
  validateClaimRequest,
  type ClaimedPublishJob,
} from '../_shared/pos-publish-contract.ts'

type ClaimDependencies = {
  authenticateConnector?: (request: Request, requestId: string) => Promise<ConnectorAuthResult | Response>
  claimJob?: (auth: ConnectorAuthResult) => Promise<ClaimedPublishJob | null>
  requestId?: () => string
}

type PublishRpcClient = {
  rpc: (name: string, parameters: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
}

async function defaultAuthenticateConnector(request: Request, requestId: string) {
  return await authenticateConnector(request, requestId, { distinguishInactive: true })
}

async function defaultClaimJob(auth: ConnectorAuthResult): Promise<ClaimedPublishJob | null> {
  const rpcClient = auth.supabase as unknown as PublishRpcClient
  const { data, error } = await rpcClient.rpc('claim_pos_publish_job', {
    p_connector_id: auth.connector.id,
  })
  if (error) throw error
  const result = Array.isArray(data) ? data[0] : null
  if (!result) return null
  if (!isSafeClaimedPublishJob(result)) throw new Error('invalid_claim_result')
  return {
    job_id: result.job_id,
    operation: result.operation,
    product_id: result.product_id,
    upc: result.upc,
    price: result.price,
    attempt: result.attempt,
    claimed_at: result.claimed_at,
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof PublishValidationError) return jsonResponse({ error: error.code }, error.status)
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : null
  if (code === '42501') return jsonResponse({ error: 'forbidden' }, 403)
  return jsonResponse({ error: 'service_unavailable' }, 503)
}

export function createClaimPosPublishJobHandler(dependencies: ClaimDependencies = {}) {
  const authenticate = dependencies.authenticateConnector ?? defaultAuthenticateConnector
  const claimJob = dependencies.claimJob ?? defaultClaimJob
  const requestIdProvider = dependencies.requestId ?? (() => crypto.randomUUID())

  return async function handleClaim(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
    if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

    const requestId = requestIdProvider()
    const auth = await authenticate(request, requestId)
    if (auth instanceof Response) return auth

    try {
      validateClaimRequest(await readBoundedJsonBody(request))
      const job = await claimJob(auth)
      if (!job) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
      if (!isSafeClaimedPublishJob(job)) throw new Error('invalid_claim_result')
      return jsonResponse({
        job_id: job.job_id,
        operation: job.operation,
        product_id: job.product_id,
        upc: job.upc,
        price: job.price,
        attempt: job.attempt,
        claimed_at: job.claimed_at,
      })
    } catch (error) {
      return errorResponse(error)
    }
  }
}

if (import.meta.main) {
  Deno.serve(createClaimPosPublishJobHandler())
}
