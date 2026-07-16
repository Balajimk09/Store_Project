import { PUBLISH_FAILURE_CODES, PosPublishError, assertFailureCode, safeFailureMessage } from './pos-publish-errors.mjs'

const CLAIM_PATH = '/functions/v1/claim-pos-publish-job'
const REPORT_PATH = '/functions/v1/report-pos-publish-job-status'
const MAX_RESPONSE_BYTES = 64 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PRICE_PATTERN = /^(?:0|[1-9]\d*)\.\d{2}$/
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=[A-Za-z0-9._-]+)?$/i
const HTTP_LOOPBACK_URL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?\/?$/i
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const NO_CONTENT = Symbol('no_content')

export const CANONICAL_UPC_LENGTH = 14
const CANONICAL_UPC_PATTERN = /^[0-9]{14}$/

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function assertSafeRecord(value, keys, code) {
  if (!isPlainRecord(value)) throw new PosPublishError(code)
  const received = Object.keys(value)
  if (received.some((key) => DANGEROUS_KEYS.has(key)) || received.length !== keys.length || received.some((key) => !keys.includes(key))) {
    throw new PosPublishError(code)
  }
}

function assertUuid(value, code) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new PosPublishError(code)
  return value.toLowerCase()
}

export function assertCanonicalUpc(value, code = 'api_response_invalid') {
  if (typeof value !== 'string' || !CANONICAL_UPC_PATTERN.test(value)) {
    throw new PosPublishError(code)
  }
  return value
}

export function assertDecimalPrice(value, code = 'api_response_invalid') {
  if (typeof value !== 'string' || !PRICE_PATTERN.test(value) || !Number.isFinite(Number(value)) || Number(value) <= 0) {
    throw new PosPublishError(code)
  }
  return value
}

export function assertRfc3339Timestamp(value, code = 'api_response_invalid') {
  if (typeof value !== 'string') throw new PosPublishError(code)
  const match = RFC3339_PATTERN.exec(value)
  if (!match) throw new PosPublishError(code)
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const offsetHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3))
  const offsetMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6))
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 || offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0) || !Number.isFinite(Date.parse(value))) {
    throw new PosPublishError(code)
  }
  return value
}

function assertBaseUrl(value) {
  if (typeof value !== 'string') throw new PosPublishError('api_url_invalid')
  let url
  try { url = new URL(value) } catch { throw new PosPublishError('api_url_invalid') }
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new PosPublishError('api_url_invalid')
  if (url.protocol === 'http:') {
    const literal = HTTP_LOOPBACK_URL.exec(value)
    if (!literal || (literal[2] !== undefined && (Number(literal[2]) < 1 || Number(literal[2]) > 65535))) {
      throw new PosPublishError('api_url_invalid')
    }
    return url
  }
  if (url.protocol !== 'https:') throw new PosPublishError('api_url_invalid')
  return url
}

function assertJsonResponse(response) {
  const contentType = response.headers?.get('content-type')?.trim() ?? ''
  if (!JSON_CONTENT_TYPE.test(contentType)) throw new PosPublishError('api_response_invalid')
}

async function readBoundedJson(response, maxBytes) {
  assertJsonResponse(response)
  const contentLength = response.headers?.get('content-length')
  if (contentLength !== null && contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)) || Number(contentLength) > maxBytes) {
      throw new PosPublishError(contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes ? 'api_response_too_large' : 'api_response_invalid')
    }
  }
  if (!response.body) throw new PosPublishError('api_response_invalid')
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        try { await reader.cancel() } catch {}
        throw new PosPublishError('api_response_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (total === 0) throw new PosPublishError('api_response_invalid')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new PosPublishError('api_response_invalid') }
}

export function validateClaimResponse(value) {
  assertSafeRecord(value, ['job_id', 'operation', 'product_id', 'upc', 'price', 'attempt', 'claimed_at'], 'api_response_invalid')
  if (value.operation !== 'update_price' || !Number.isSafeInteger(value.attempt) || value.attempt < 1) throw new PosPublishError('api_response_invalid')
  return {
    job_id: assertUuid(value.job_id, 'api_response_invalid'),
    operation: 'update_price',
    product_id: assertUuid(value.product_id, 'api_response_invalid'),
    upc: assertCanonicalUpc(value.upc),
    price: assertDecimalPrice(value.price),
    attempt: value.attempt,
    claimed_at: assertRfc3339Timestamp(value.claimed_at),
  }
}

export function validateReportPayload(payload) {
  if (!isPlainRecord(payload)) throw new PosPublishError('report_payload_invalid')
  try {
    const job_id = assertUuid(payload.job_id, 'report_payload_invalid')
    if (payload.status === 'sending' || payload.status === 'verifying') {
      assertSafeRecord(payload, ['job_id', 'status'], 'report_payload_invalid')
      return { job_id, status: payload.status }
    }
    if (payload.status === 'completed') {
      assertSafeRecord(payload, ['job_id', 'status', 'verification'], 'report_payload_invalid')
      assertSafeRecord(payload.verification, ['upc', 'price'], 'report_payload_invalid')
      return { job_id, status: 'completed', verification: { upc: assertCanonicalUpc(payload.verification.upc, 'report_payload_invalid'), price: assertDecimalPrice(payload.verification.price, 'report_payload_invalid') } }
    }
    if (payload.status === 'failed') {
      assertSafeRecord(payload, ['job_id', 'status', 'error_code', 'error_message'], 'report_payload_invalid')
      assertFailureCode(payload.error_code)
      const message = safeFailureMessage(payload.error_message)
      if (!message) throw new PosPublishError('report_payload_invalid')
      return { job_id, status: 'failed', error_code: payload.error_code, error_message: message }
    }
  } catch {
    throw new PosPublishError('report_payload_invalid')
  }
  throw new PosPublishError('report_payload_invalid')
}

export function createPosPublishApiClient({ baseUrl, connectorToken, workerVersion, fetchImpl = globalThis.fetch, timeoutMs = 10_000, maxResponseBytes = MAX_RESPONSE_BYTES, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  const origin = assertBaseUrl(baseUrl)
  if (typeof connectorToken !== 'string' || connectorToken.length < 32 || connectorToken.length > 512) throw new PosPublishError('api_configuration_invalid')
  if (typeof workerVersion !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(workerVersion)) throw new PosPublishError('api_configuration_invalid')
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) throw new PosPublishError('api_configuration_invalid')

  async function request(path, payload, allowNoContent = false) {
    const controller = new AbortController()
    const timeout = setTimeoutFn(() => controller.abort(), timeoutMs)
    try {
      let response
      try {
        response = await fetchImpl(new URL(path, origin), {
          method: 'POST',
          redirect: 'manual',
          credentials: 'omit',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', 'x-storepulse-connector-token': connectorToken },
          body: JSON.stringify(payload),
        })
      } catch {
        if (controller.signal.aborted) throw new PosPublishError('api_timeout')
        throw new PosPublishError('api_request_failed')
      }
      if (!response || typeof response.status !== 'number') throw new PosPublishError('api_request_failed')
      if (allowNoContent && response.status === 204) return NO_CONTENT
      if (response.status !== 200 || response.redirected) throw new PosPublishError('api_request_failed')
      return await readBoundedJson(response, maxResponseBytes)
    } finally {
      clearTimeoutFn(timeout)
    }
  }

  return {
    async claim() {
      const body = await request(CLAIM_PATH, { worker_version: workerVersion, capabilities: ['update_price'] }, true)
      return body === NO_CONTENT ? undefined : validateClaimResponse(body)
    },
    async report(payload) {
      const safePayload = validateReportPayload(payload)
      const body = await request(REPORT_PATH, safePayload)
      assertSafeRecord(body, ['job_id', 'status'], 'api_response_invalid')
      if (body.job_id !== safePayload.job_id || body.status !== safePayload.status) throw new PosPublishError('api_response_invalid')
      return { job_id: body.job_id, status: body.status }
    },
  }
}

export { PUBLISH_FAILURE_CODES }
