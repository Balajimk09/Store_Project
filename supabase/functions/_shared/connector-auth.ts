import { createClient } from 'npm:@supabase/supabase-js@2.58.0'

export type ConnectorRow = {
  id: string
  store_id: string
  connector_name: string
  source_system: string
  source_store_number: string | null
  status: string
  consecutive_failure_count: number
  installation_id?: string | null
}

export type StoreRow = {
  owner_id: string
}

export type ConnectorAuthResult = {
  supabase: ReturnType<typeof createClient>
  connector: ConnectorRow
  store: StoreRow
}

export const CONNECTOR_TOKEN_HEADER = 'x-storepulse-connector-token'
export const VERIFONE_SOURCE_SYSTEM = 'verifone_commander'

export function getAdminKey(): string {
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

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export async function authenticateConnector(
  request: Request,
  requestId: string,
  options: { sourceSystem?: string } = {},
): Promise<ConnectorAuthResult | Response> {
  const token = request.headers.get(CONNECTOR_TOKEN_HEADER)?.trim()
  if (!token || token.length < 32 || token.length > 512) {
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

  const tokenHash = await sha256Hex(token)
  const { data: connectorData, error: connectorError } = await supabase
    .from('store_pos_connectors')
    .select('id, store_id, connector_name, source_system, source_store_number, status, consecutive_failure_count, installation_id')
    .eq('token_hash', tokenHash)
    .eq('status', 'active')
    .maybeSingle()

  if (connectorError) {
    console.error(JSON.stringify({ request_id: requestId, stage: 'connector_lookup', code: connectorError.code }))
    return jsonResponse({ error: 'service_unavailable', request_id: requestId }, 503)
  }

  if (!connectorData) return jsonResponse({ error: 'unauthorized', request_id: requestId }, 401)

  const connector = connectorData as ConnectorRow
  const sourceSystem = options.sourceSystem ?? VERIFONE_SOURCE_SYSTEM
  if (connector.source_system !== sourceSystem) {
    return jsonResponse({ error: 'connector_misconfigured', request_id: requestId }, 409)
  }

  const { data: storeData, error: storeError } = await supabase
    .from('stores')
    .select('owner_id')
    .eq('id', connector.store_id)
    .single()

  const store = storeData as StoreRow | null
  if (storeError || !store?.owner_id) {
    return jsonResponse({ error: 'connector_misconfigured', request_id: requestId }, 409)
  }

  return { supabase, connector, store }
}
