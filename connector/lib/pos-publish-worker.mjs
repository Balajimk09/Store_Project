import { assertCommanderPriceAdapter } from './commander-price-adapter.mjs'
import { assertCanonicalUpc, assertDecimalPrice, validateClaimResponse } from './pos-publish-api-client.mjs'
import { PosPublishError, mapWorkerFailure } from './pos-publish-errors.mjs'

const ALLOWED_LOG_FIELDS = new Set(['event', 'job_id', 'operation', 'attempt', 'status', 'error_code', 'duration_ms'])

function safeLog(logger, fields) {
  const entry = {}
  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED_LOG_FIELDS.has(key) && value !== undefined) entry[key] = value
  }
  try { logger(entry) } catch {}
}

function validateReadProduct(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new PosPublishError('commander_response_invalid')
  }
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('upc') || !keys.includes('price') || keys.some((key) => key === '__proto__' || key === 'constructor' || key === 'prototype')) {
    throw new PosPublishError('commander_response_invalid')
  }
  try {
    return { upc: assertCanonicalUpc(value.upc, 'commander_response_invalid'), price: assertDecimalPrice(value.price, 'commander_response_invalid') }
  } catch {
    throw new PosPublishError('commander_response_invalid')
  }
}

function failureFor(error) {
  if (error instanceof PosPublishError && error.code === 'verification_upc_mismatch') {
    return { code: 'plu_identity_mismatch', message: 'Product identity did not match.' }
  }
  if (error instanceof PosPublishError && error.code === 'verification_price_mismatch') {
    return { code: 'verification_failed', message: 'Product price did not match.' }
  }
  if (error instanceof PosPublishError && error.code === 'commander_response_invalid') {
    return { code: 'internal_connector_error', message: 'Commander response was invalid.' }
  }
  return mapWorkerFailure(error)
}

export function createPosPublishWorker({ apiClient, commanderAdapter, logger = () => {}, now = () => Date.now(), executionGuard = new Set() }) {
  if (!apiClient || typeof apiClient.claim !== 'function' || typeof apiClient.report !== 'function') throw new PosPublishError('worker_configuration_invalid')
  if (typeof logger !== 'function' || typeof now !== 'function' || !(executionGuard instanceof Set)) throw new PosPublishError('worker_configuration_invalid')
  const adapter = assertCommanderPriceAdapter(commanderAdapter)
  let processing = false

  async function reportFailure(job, failure) {
    try {
      await apiClient.report({ job_id: job.job_id, status: 'failed', error_code: failure.code, error_message: failure.message })
      return true
    } catch {
      return false
    }
  }

  return {
    async processOne() {
      if (processing) return { outcome: 'busy' }
      processing = true
    try {
      let startedAt
      try {
        startedAt = now()
      } catch {
        safeLog(logger, { event: 'pos_publish_clock_failed', error_code: 'internal_connector_error' })
        return { outcome: 'internal_error', stage: 'clock' }
      }
      const elapsed = () => {
        try { return now() - startedAt } catch { return undefined }
      }
        let rawJob
        try {
          rawJob = await apiClient.claim()
        } catch {
          safeLog(logger, { event: 'pos_publish_claim_failed', error_code: 'internal_connector_error', duration_ms: elapsed() })
          return { outcome: 'status_report_failed', stage: 'claim' }
        }
        if (rawJob === undefined) {
          safeLog(logger, { event: 'pos_publish_idle', duration_ms: elapsed() })
          return { outcome: 'idle' }
        }

        let job
        try {
          job = validateClaimResponse(rawJob)
        } catch {
          safeLog(logger, { event: 'pos_publish_invalid_claim', error_code: 'internal_connector_error', duration_ms: elapsed() })
          return { outcome: 'invalid_claim' }
        }
        if (executionGuard.has(job.job_id)) {
          safeLog(logger, { event: 'pos_publish_duplicate_ignored', job_id: job.job_id, operation: job.operation, attempt: job.attempt, duration_ms: elapsed() })
          return { outcome: 'duplicate_ignored', job_id: job.job_id }
        }
        safeLog(logger, { event: 'pos_publish_claimed', job_id: job.job_id, operation: job.operation, attempt: job.attempt })

        try {
          await apiClient.report({ job_id: job.job_id, status: 'sending' })
        } catch {
          const failureReported = await reportFailure(job, { code: 'internal_connector_error', message: 'StorePulse status reporting failed.' })
          safeLog(logger, { event: 'pos_publish_status_report_failed', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'sending', error_code: 'internal_connector_error', duration_ms: elapsed() })
          return { outcome: 'status_report_failed', job_id: job.job_id, stage: 'sending', failure_reported: failureReported }
        }

        // The price update can now begin. Keep this ID for the process lifetime from this point onward.
        executionGuard.add(job.job_id)
        safeLog(logger, { event: 'pos_publish_sending', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'sending' })
        try {
          await adapter.updatePrice({ upc: job.upc, price: job.price })
        } catch (error) {
          const failure = failureFor(error)
          const failureReported = await reportFailure(job, failure)
          safeLog(logger, { event: 'pos_publish_failed', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'failed', error_code: failure.code, duration_ms: elapsed() })
          return { outcome: 'commander_failed', job_id: job.job_id, failure_code: failure.code, failure_reported: failureReported }
        }

        try {
          await apiClient.report({ job_id: job.job_id, status: 'verifying' })
        } catch {
          const failureReported = await reportFailure(job, { code: 'internal_connector_error', message: 'StorePulse status reporting failed.' })
          safeLog(logger, { event: 'pos_publish_status_report_failed', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'verifying', error_code: 'internal_connector_error', duration_ms: elapsed() })
          return { outcome: 'status_report_failed', job_id: job.job_id, stage: 'verifying', failure_reported: failureReported }
        }

        let product
        try {
          product = validateReadProduct(await adapter.readProduct({ upc: job.upc }))
          if (product.upc !== job.upc) throw new PosPublishError('verification_upc_mismatch')
          if (product.price !== job.price) throw new PosPublishError('verification_price_mismatch')
        } catch (error) {
          const failure = failureFor(error)
          const failureReported = await reportFailure(job, failure)
          safeLog(logger, { event: 'pos_publish_failed', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'failed', error_code: failure.code, duration_ms: elapsed() })
          return { outcome: 'commander_failed', job_id: job.job_id, failure_code: failure.code, failure_reported: failureReported }
        }

        try {
          await apiClient.report({ job_id: job.job_id, status: 'completed', verification: { upc: job.upc, price: job.price } })
        } catch {
          safeLog(logger, { event: 'pos_publish_status_report_failed', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'completed', error_code: 'internal_connector_error', duration_ms: elapsed() })
          return { outcome: 'status_report_failed', job_id: job.job_id, stage: 'completed', failure_reported: false }
        }
        safeLog(logger, { event: 'pos_publish_completed', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'completed', duration_ms: elapsed() })
        return { outcome: 'completed', job_id: job.job_id }
      } finally {
        processing = false
      }
    },
  }
}
