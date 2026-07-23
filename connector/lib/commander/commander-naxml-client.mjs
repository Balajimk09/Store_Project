import { Agent, request as httpsRequest } from 'node:https'
import { readFile } from 'node:fs/promises'
import { checkServerIdentity } from 'node:tls'
import { createHash } from 'node:crypto'

export const COMMANDER_NAXML_PATH = '/cgi-bin/NAXML?'
export const COMMANDER_NAXML_COMMANDS = Object.freeze(['vPLUs', 'uPLUs'])
export const COMMANDER_REQUEST_TIMEOUT_MS = 15_000
export const COMMANDER_MAX_RESPONSE_BYTES = 1024 * 1024

/** @typedef {{ code: string }} CommanderNaxmlFailure */
/** @typedef {{ command: 'vPLUs'|'uPLUs', sessionCookie: string, xml: string }} CommanderNaxmlRequest */
/** @typedef {{ status: number, body: string }} CommanderNaxmlResponse */

export class CommanderNaxmlError extends Error {
  constructor(code) {
    super(code)
    this.name = 'CommanderNaxmlError'
    this.code = code
  }
}

function fail(code) { throw new CommanderNaxmlError(code) }
function tlsFailure(error) {
  if (error?.message === 'commander_tls_peer_mismatch') return new CommanderNaxmlError('commander_tls_peer_mismatch')
  if (error?.code === 'ERR_TLS_CERT_ALTNAME_INVALID') return new CommanderNaxmlError('commander_tls_hostname_invalid')
  return new CommanderNaxmlError('transport_failed')
}

function assertSafeCookie(cookie) {
  if (typeof cookie !== 'string' || cookie.length === 0 || cookie.length > 4096 || /[\u0000-\u001f\u007f-\u009f&=]/u.test(cookie)) fail('transport_failed')
}

export function validateCommanderOrigin(origin) {
  if (typeof origin !== 'string' || origin.includes('\\') || origin.includes('%')) fail('transport_failed')
  let url
  try { url = new URL(origin) } catch { fail('transport_failed') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || (url.pathname !== '' && url.pathname !== '/')) fail('transport_failed')
  return url
}

export function buildCommanderNaxmlBody({ command, sessionCookie, xml }) {
  if (!COMMANDER_NAXML_COMMANDS.includes(command) || typeof xml !== 'string' || xml.length === 0 || Buffer.byteLength(xml, 'utf8') > COMMANDER_MAX_RESPONSE_BYTES) fail('request_invalid')
  assertSafeCookie(sessionCookie)
  return `cmd=${command}&cookie=${encodeURIComponent(sessionCookie)}\r\n\r\n${xml}`
}

export async function createPinnedCommanderAgent(certificatePath, readCertificate = readFile) {
  if (typeof certificatePath !== 'string' || certificatePath.length === 0) fail('transport_failed')
  let certificate
  try { certificate = await readCertificate(certificatePath, 'utf8') } catch { fail('transport_failed') }
  if (typeof certificate !== 'string' || certificate.length === 0 || certificate.length > 128 * 1024 || /-----BEGIN(?: RSA| EC| ENCRYPTED)? PRIVATE KEY-----/i.test(certificate) || !/-----BEGIN CERTIFICATE-----/.test(certificate)) fail('transport_failed')
  return new Agent({ ca: certificate, allowPartialTrustChain: true, rejectUnauthorized: true })
}

export function createVerifiedCommanderAgent(trust) {
  if (!trust || !Buffer.isBuffer(trust.caBundle) || typeof trust.serverName !== 'string' || !/^[A-F0-9]{64}$/.test(trust.peerSha256 || '')) fail('transport_failed')
  return new Agent({
    ca: trust.caBundle,
    allowPartialTrustChain: true,
    rejectUnauthorized: true,
    checkServerIdentity: (_host, certificate) => {
      const hostnameError = checkServerIdentity(trust.serverName, certificate)
      if (hostnameError) return hostnameError
      const raw = certificate?.raw
      if (!Buffer.isBuffer(raw)) return new Error('commander_tls_peer_mismatch')
      return createHash('sha256').update(raw).digest('hex').toUpperCase() === trust.peerSha256 ? undefined : new Error('commander_tls_peer_mismatch')
    },
  })
}

export async function defaultTransport({ url, options, body, timeoutMs, requestFactory = httpsRequest }) {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (callback, value) => { if (!settled) { settled = true; callback(value) } }
    const request = requestFactory(url, options, (response) => {
      const chunks = []
      let bytes = 0
      response.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > COMMANDER_MAX_RESPONSE_BYTES) {
          request.destroy()
          settle(reject, new CommanderNaxmlError('response_too_large'))
        } else chunks.push(chunk)
      })
      response.on('end', () => {
        if (!settled) {
          let text
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) } catch { return settle(reject, new CommanderNaxmlError('response_invalid')) }
          settle(resolve, { status: response.statusCode || 0, body: text })
        }
      })
      response.on('error', (error) => settle(reject, tlsFailure(error)))
    })
    request.setTimeout(timeoutMs, () => { request.destroy(); settle(reject, new CommanderNaxmlError('timeout')) })
    request.on('error', (error) => settle(reject, tlsFailure(error)))
    request.write(body)
    request.end()
  })
}

/**
 * Sends one NAXML request. Tests should inject `transport`; no network work occurs on import.
 * `transport` receives only the already-framed request and must return `{ status, body }`.
 */
export async function sendCommanderNaxml({ origin, request, certificatePath, trust, timeoutMs = COMMANDER_REQUEST_TIMEOUT_MS, transport, requestFactory }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) fail('request_invalid')
  const url = validateCommanderOrigin(origin)
  const body = buildCommanderNaxmlBody(request)
  const endpoint = `${url.origin}${COMMANDER_NAXML_PATH}`
  let agent
  try {
    const options = { method: 'POST', headers: { 'content-type': 'text/plain; charset=UTF-8', 'content-length': Buffer.byteLength(body) }, rejectUnauthorized: true, ...(trust ? { servername: trust.serverName } : {}) }
    if (transport) {
      const response = await transport({ url: endpoint, options, body, timeoutMs })
      if (!response || !Number.isInteger(response.status) || typeof response.body !== 'string' || Buffer.byteLength(response.body, 'utf8') > COMMANDER_MAX_RESPONSE_BYTES) fail('transport_failed')
      return response
    }
    agent = trust ? createVerifiedCommanderAgent(trust) : await createPinnedCommanderAgent(certificatePath)
    return await defaultTransport({ url: endpoint, options: { ...options, agent }, body, timeoutMs, requestFactory })
  } catch (error) {
    if (error instanceof CommanderNaxmlError) throw error
    fail('transport_failed')
  } finally {
    if (agent) agent.destroy()
  }
}
