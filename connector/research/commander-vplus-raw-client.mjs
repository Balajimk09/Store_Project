import { Agent, request as httpsRequest } from 'node:https'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_RESPONSE_BYTES = 1024 * 1024
const REQUEST_TIMEOUT_MS = 15_000

function fail(code) { throw new Error(code) }

export function buildVpluReadXml(testUpc) {
  if (typeof testUpc !== 'string' || !/^[0-9]{1,32}$/.test(testUpc)) fail('vplu_response_invalid')
  return `<domain:PLUSelect xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><query><where><upc source="keyboard">${testUpc}</upc><upcModifier>000</upcModifier></where></query><pageSize>100</pageSize><page>1</page></domain:PLUSelect>`
}

export function buildVpluRequestBody(sessionCookie, xml) {
  if (typeof sessionCookie !== 'string' || !sessionCookie || /[\r\n]/.test(sessionCookie)) fail('vplu_auth_rejected')
  return `cmd=vPLUs&cookie=${encodeURIComponent(sessionCookie)}\r\n\r\n${xml}`
}

export function validateCommanderBaseUrl(value) {
  if (typeof value !== 'string' || value.includes('\\') || value.includes('%')) fail('vplu_transport_failed')
  let url
  try { url = new URL(value) } catch { fail('vplu_transport_failed') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || (url.pathname !== '' && url.pathname !== '/')) fail('vplu_transport_failed')
  return url
}

export function parseVpluResponse(xml, testUpc) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > MAX_RESPONSE_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) fail('vplu_response_invalid')
  if (!/^\s*(?:<\?xml\s+[^?]*\?>\s*)?<(?:(?:[A-Za-z][\w.-]*):)?PLUs\b/.test(xml)) fail('vplu_response_invalid')
  const products = [...xml.matchAll(/<(?:[A-Za-z][\w.-]*:)?PLU\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z][\w.-]*:)?PLU\s*>/g)]
  if (products.length === 0) fail('vplu_response_invalid')
  const found = products.some((match) => new RegExp(`<upc(?:\\s[^>]*)?>${testUpc}<\\/upc>`, 'i').test(match[1]))
  return { product_count: products.length, test_product_found: found }
}

export function createPinnedCommanderAgent(caCertPath) {
  if (typeof caCertPath !== 'string' || !caCertPath) fail('vplu_transport_failed')
  let ca
  try { ca = readFileSync(caCertPath, 'utf8') } catch { fail('vplu_transport_failed') }
  if (!ca) fail('vplu_transport_failed')
  return new Agent({ ca, allowPartialTrustChain: true })
}

export async function requestVplu({ baseUrl, sessionCookie, testUpc, caCertPath, timeoutMs = REQUEST_TIMEOUT_MS, requestFactory = httpsRequest, signal }) {
  const url = validateCommanderBaseUrl(baseUrl)
  const xml = buildVpluReadXml(testUpc)
  const body = buildVpluRequestBody(sessionCookie, xml)
  const agent = createPinnedCommanderAgent(caCertPath)
  try {
    const response = await new Promise((resolve, reject) => {
      let settled = false
      const settle = (callback, value) => { if (!settled) { settled = true; callback(value) } }
      const req = requestFactory(`${url.origin}/cgi-bin/NAXML?`, {
        method: 'POST', agent, headers: { 'content-type': 'text/plain; charset=UTF-8', 'content-length': Buffer.byteLength(body) },
      }, (res) => {
        const chunks = []; let size = 0
        res.on('data', (chunk) => { size += chunk.length; if (size > MAX_RESPONSE_BYTES) { req.destroy(); settle(reject, new Error('vplu_transport_failed')) } else { chunks.push(chunk) } })
        res.on('end', () => settle(resolve, { status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', () => settle(reject, new Error('vplu_transport_failed')))
      })
      req.setTimeout(timeoutMs, () => { req.destroy(); settle(reject, new Error('vplu_transport_failed')) })
      req.on('error', () => settle(reject, new Error('vplu_transport_failed')))
      if (signal) signal.addEventListener('abort', () => { req.destroy(); settle(reject, new Error('vplu_transport_failed')) }, { once: true })
      req.write(body); req.end()
    })
    if (response.status === 401 || response.status === 403) fail('vplu_auth_rejected')
    if (response.status < 200 || response.status >= 300) fail('vplu_transport_failed')
    return parseVpluResponse(response.body, testUpc)
  } finally { agent.destroy() }
}

async function readBoundedStdin() {
  const chunks = []; let size = 0
  for await (const chunk of process.stdin) { size += chunk.length; if (size > 8192) fail('vplu_transport_failed'); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('vplu_transport_failed') }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  readBoundedStdin().then(async (input) => {
    const result = await requestVplu({ baseUrl: input.base_url, sessionCookie: input.session_cookie, testUpc: input.test_upc, caCertPath: input.ca_cert_path, timeoutMs: input.timeout_ms })
    process.stdout.write(JSON.stringify({ authentication_succeeded: true, vplu_request_succeeded: true, test_product_found: result.test_product_found, product_count: result.product_count, error_code: result.test_product_found ? null : 'test_product_not_found' }))
  }).catch((error) => process.stdout.write(JSON.stringify({ authentication_succeeded: true, vplu_request_succeeded: false, test_product_found: false, product_count: null, error_code: ['vplu_transport_failed', 'vplu_auth_rejected', 'vplu_response_invalid'].includes(error.message) ? error.message : 'vplu_transport_failed' })))
}
