import { assertCommanderPriceAdapter } from './commander-price-adapter.mjs'
import { createPosPublishApiClient } from './pos-publish-api-client.mjs'
import { createPosPublishWorker } from './pos-publish-worker.mjs'
import { readFileSync } from 'node:fs'

const CLAIM_PATH = '/functions/v1/claim-pos-publish-job'
const REPORT_PATH = '/functions/v1/report-pos-publish-job-status'
const TRUSTED_SOURCE_PATHS = new Set([
  '/functions/v1/ingest-pos-transactions',
  '/functions/v1/report-pos-connector-heartbeat',
])
const SAFE_LOG_FIELDS = new Set(['event', 'job_id', 'operation', 'attempt', 'status', 'error_code', 'duration_ms'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STOREPULSE_ORIGIN_POLICY_PATH = new URL('./storepulse-origin-policy.json', import.meta.url)

export function loadPosPublishResultContract(path = new URL('./pos-publish-result-contract.json', import.meta.url)) {
  let value
  try { value = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error('invalid_result_contract') }
  const required = ['properties', 'outcomes', 'states', 'error_codes', 'parent_error_codes']
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== required.length || required.some((key) => !Object.hasOwn(value, key))) {
    throw new Error('invalid_result_contract')
  }
  for (const key of required) {
    const entries = value[key]
    if (!Array.isArray(entries) || entries.length === 0 || entries.some((entry) => typeof entry !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(entry)) || new Set(entries).size !== entries.length) {
      throw new Error('invalid_result_contract')
    }
  }
  if (value.properties.length !== 4 || value.properties.join('|') !== 'outcome|state|last_job_id|last_error_code') throw new Error('invalid_result_contract')
  return Object.freeze({
    properties: Object.freeze([...value.properties]),
    outcomes: new Set(value.outcomes),
    states: new Set(value.states),
    errorCodes: new Set(value.error_codes),
    parentErrorCodes: new Set(value.parent_error_codes),
  })
}

export const POS_PUBLISH_RESULT_CONTRACT = loadPosPublishResultContract()
export const POS_PUBLISH_CHILD_RESULT_KEYS = POS_PUBLISH_RESULT_CONTRACT.properties
export const POS_PUBLISH_CHILD_OUTCOMES = POS_PUBLISH_RESULT_CONTRACT.outcomes
export const POS_PUBLISH_CHILD_STATES = POS_PUBLISH_RESULT_CONTRACT.states
export const POS_PUBLISH_CHILD_ERROR_CODES = POS_PUBLISH_RESULT_CONTRACT.errorCodes
export const POS_PUBLISH_PARENT_ERROR_CODES = POS_PUBLISH_RESULT_CONTRACT.parentErrorCodes

function parsePolicyOrigin(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('%')) throw new Error('invalid_origin_policy')
  if (!/^https:\/\/[a-z0-9.-]+$/.test(value) || value.includes('*')) throw new Error('invalid_origin_policy')
  let url
  try { url = new URL(value) } catch { throw new Error('invalid_origin_policy') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('invalid_origin_policy')
  }
  if (url.origin !== value) throw new Error('invalid_origin_policy')
  return value
}

export function loadStorePulseOriginPolicy(path = STOREPULSE_ORIGIN_POLICY_PATH) {
  let value
  try { value = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error('invalid_origin_policy') }
  const required = ['version', 'allowed_https_origins']
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== required.length || required.some((key) => !Object.hasOwn(value, key)) || value.version !== 1 || !Array.isArray(value.allowed_https_origins) || value.allowed_https_origins.length === 0) {
    throw new Error('invalid_origin_policy')
  }
  const origins = value.allowed_https_origins.map(parsePolicyOrigin)
  if (new Set(origins).size !== origins.length) throw new Error('invalid_origin_policy')
  return Object.freeze({ version: 1, allowedOrigins: new Set(origins) })
}

export const STOREPULSE_ORIGIN_POLICY = loadStorePulseOriginPolicy()

function safeLog(logger, fields) {
  const safeFields = {}
  for (const [key, value] of Object.entries(fields)) {
    if (SAFE_LOG_FIELDS.has(key) && value !== undefined) safeFields[key] = value
  }
  try { logger(safeFields) } catch {}
}

function parseTrustedSourceEndpoint(value) {
  if (typeof value !== 'string' || value.includes('\\') || value.includes('%')) throw new Error('invalid_endpoint')
  let url
  try { url = new URL(value) } catch { throw new Error('invalid_endpoint') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || !TRUSTED_SOURCE_PATHS.has(url.pathname)) {
    throw new Error('invalid_endpoint')
  }
  if (url.pathname.includes('//') || url.pathname.includes('/./') || url.pathname.includes('/../')) throw new Error('invalid_endpoint')
  const authorityMatch = /^https:\/\/([^/?#]+)(?:\/|$)/.exec(value)
  if (!authorityMatch) throw new Error('invalid_endpoint')
  const authority = authorityMatch[1]
  const portMatch = authority.startsWith('[')
    ? /^\[[0-9a-f:.]+\](?::([0-9]{1,5}))?$/i.exec(authority)
    : /^(?:[^:\s]+)(?::([0-9]{1,5}))?$/.exec(authority)
  if (!portMatch || (portMatch[1] !== undefined && (Number(portMatch[1]) < 1 || Number(portMatch[1]) > 65535))) {
    throw new Error('invalid_endpoint')
  }
  const origin = `https://${authority}`
  if (!STOREPULSE_ORIGIN_POLICY.allowedOrigins.has(origin)) throw new Error('invalid_endpoint')
  return { url, origin }
}

export function derivePosPublishEndpoints({ trustedSourceEndpointUrl, claimEndpointUrl, reportEndpointUrl } = {}) {
  const source = parseTrustedSourceEndpoint(trustedSourceEndpointUrl)
  const baseUrl = source.origin
  const derived = {
    baseUrl,
    claimEndpointUrl: `${baseUrl}${CLAIM_PATH}`,
    reportEndpointUrl: `${baseUrl}${REPORT_PATH}`,
  }
  if (claimEndpointUrl !== undefined && claimEndpointUrl !== derived.claimEndpointUrl) throw new Error('invalid_endpoint')
  if (reportEndpointUrl !== undefined && reportEndpointUrl !== derived.reportEndpointUrl) throw new Error('invalid_endpoint')
  return derived
}

export function validatePosPublishPollSeconds(value) {
  if (!Number.isSafeInteger(value) || value < 30 || value > 3600) throw new Error('invalid_poll_seconds')
  return value
}

function configurationResult(code) {
  return { outcome: 'configuration_error', state: 'configuration_error', last_error_code: code }
}

export function toSafePosPublishChildResult(result) {
  const candidate = {
    outcome: result?.outcome,
    state: result?.state,
    last_job_id: result?.job_id ?? null,
    last_error_code: result?.last_error_code ?? result?.failure_code ?? null,
  }
  if (!POS_PUBLISH_CHILD_OUTCOMES.has(candidate.outcome) || !POS_PUBLISH_CHILD_STATES.has(candidate.state)) {
    return { outcome: 'internal_error', state: 'error', last_job_id: null, last_error_code: 'internal_connector_error' }
  }
  if (candidate.last_job_id !== null && (typeof candidate.last_job_id !== 'string' || !UUID_PATTERN.test(candidate.last_job_id))) {
    return { outcome: 'internal_error', state: 'error', last_job_id: null, last_error_code: 'internal_connector_error' }
  }
  if (candidate.last_error_code !== null && !POS_PUBLISH_CHILD_ERROR_CODES.has(candidate.last_error_code)) {
    return { outcome: 'internal_error', state: 'error', last_job_id: null, last_error_code: 'internal_connector_error' }
  }
  return candidate
}

export function createPosPublishRuntime({
  enabled = false,
  pollSeconds = 60,
  trustedSourceEndpointUrl,
  claimEndpointUrl,
  reportEndpointUrl,
  connectorToken,
  workerVersion = 'storepulse-connector-runtime',
  commanderAdapter,
  logger = () => {},
  apiClientFactory = createPosPublishApiClient,
  workerFactory = createPosPublishWorker,
} = {}) {
  let processing = false
  if (!enabled) {
    return {
      pollSeconds: 60,
      async processOne() { return { outcome: 'disabled', state: 'disabled' } },
    }
  }

  let poll
  let endpoints
  try {
    poll = validatePosPublishPollSeconds(pollSeconds)
    endpoints = derivePosPublishEndpoints({ trustedSourceEndpointUrl, claimEndpointUrl, reportEndpointUrl })
  } catch {
    return { pollSeconds: 60, async processOne() { return configurationResult('pos_publish_configuration_invalid') } }
  }

  let worker
  try {
    // The production Commander adapter is intentionally absent. Validate it before creating an API client or claiming work.
    const adapter = assertCommanderPriceAdapter(commanderAdapter)
    const apiClient = apiClientFactory({ baseUrl: endpoints.baseUrl, connectorToken, workerVersion })
    worker = workerFactory({ apiClient, commanderAdapter: adapter, logger: (fields) => safeLog(logger, fields) })
  } catch {
    return { pollSeconds: poll, async processOne() { return configurationResult('commander_adapter_unavailable') } }
  }

  return {
    pollSeconds: poll,
    async processOne() {
      if (processing) return { outcome: 'busy', state: 'busy' }
      processing = true
      try {
        const result = await worker.processOne()
        return { ...result, state: result.outcome === 'completed' ? 'completed' : result.outcome }
      } catch {
        safeLog(logger, { event: 'pos_publish_runtime_failed', error_code: 'internal_connector_error' })
        return { outcome: 'internal_error', state: 'error', last_error_code: 'internal_connector_error' }
      } finally {
        processing = false
      }
    },
  }
}

export async function runPosPublishLoop({ runtime, signal, sleep = async () => {} }) {
  if (!runtime || typeof runtime.processOne !== 'function' || !Number.isSafeInteger(runtime.pollSeconds)) {
    throw new Error('invalid_runtime')
  }
  const outcomes = []
  while (!signal?.aborted) {
    outcomes.push(await runtime.processOne())
    if (signal?.aborted) break
    await sleep(runtime.pollSeconds, signal)
  }
  return outcomes
}
