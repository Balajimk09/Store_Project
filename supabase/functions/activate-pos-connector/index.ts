import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'

type JsonRecord = Record<string, unknown>

const MAX_BODY_BYTES = 32 * 1024

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

function requiredString(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length < minLength || trimmed.length > maxLength) return null
  return trimmed
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

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (request: Request): Promise<Response> => {
  const requestId = crypto.randomUUID()

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ success: false, error: 'method_not_allowed', request_id: requestId }, 405)
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ success: false, error: 'payload_too_large', request_id: requestId }, 413)
  }

  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return jsonResponse({ success: false, error: 'invalid_request_body', request_id: requestId }, 400)
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return jsonResponse({ success: false, error: 'payload_too_large', request_id: requestId }, 413)
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return jsonResponse({ success: false, error: 'invalid_json', request_id: requestId }, 400)
  }

  if (!isRecord(body)) {
    return jsonResponse({ success: false, error: 'request_body_must_be_object', request_id: requestId }, 400)
  }

  const sourceStoreNumber = requiredString(body.source_store_number, 1, 100)
  const activationCode = requiredString(body.activation_code, 12, 256)
  const connectorToken = requiredString(body.connector_token, 32, 512)

  if (!sourceStoreNumber || !activationCode || !connectorToken) {
    return jsonResponse({ success: false, error: 'invalid_activation_request', request_id: requestId }, 400)
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
    return jsonResponse({ success: false, error: 'service_unavailable', request_id: requestId }, 503)
  }

  const activationCodeHash = await sha256Hex(activationCode)
  const connectorTokenHash = await sha256Hex(connectorToken)

  const { data, error } = await supabase.rpc('activate_pos_connector', {
    p_source_store_number: sourceStoreNumber,
    p_activation_code_hash: activationCodeHash,
    p_connector_token_hash: connectorTokenHash,
  })

  if (error) {
    console.error(JSON.stringify({ request_id: requestId, stage: 'activation_rpc', code: error.code }))
    return jsonResponse({ success: false, error: 'service_unavailable', request_id: requestId }, 503)
  }

  const result = isRecord(data) ? data : { success: false, error: 'activation_failed' }
  if (result.success !== true) {
    return jsonResponse({ ...result, request_id: requestId }, 400)
  }

  console.log(JSON.stringify({
    request_id: requestId,
    connector_id: result.connector_id,
    source_store_number: result.source_store_number,
    activated_at: result.activated_at,
  }))

  return jsonResponse({ ...result, request_id: requestId })
})
