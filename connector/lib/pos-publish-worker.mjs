import { assertCommanderPriceAdapter } from './commander-price-adapter.mjs'
import { assertCanonicalUpc, assertDecimalPrice, validateClaimResponse } from './pos-publish-api-client.mjs'
import { PosPublishError, mapWorkerFailure } from './pos-publish-errors.mjs'

const ALLOWED_LOG_FIELDS = new Set(['event', 'job_id', 'operation', 'attempt', 'status', 'error_code', 'duration_ms'])
const CREATE_READBACK_MAX_ATTEMPTS = 3
const CREATE_READBACK_RETRY_DELAY_MS = 250

function waitForCreateReadback(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

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
  if (keys.length !== 3 || !keys.includes('upc') || !keys.includes('modifier') || !keys.includes('price') || keys.some((key) => key === '__proto__' || key === 'constructor' || key === 'prototype')) {
    throw new PosPublishError('commander_response_invalid')
  }
  try {
    if (typeof value.modifier !== 'string' || !/^\d{3}$/.test(value.modifier)) throw new Error('modifier_invalid')
    return { upc: assertCanonicalUpc(value.upc, 'commander_response_invalid'), modifier: value.modifier, price: assertDecimalPrice(value.price, 'commander_response_invalid') }
  } catch {
    throw new PosPublishError('commander_response_invalid')
  }
}

function validateReadProductDetail(value) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value)
      !== Object.prototype
  ) {
    throw new PosPublishError(
      'commander_response_invalid',
    )
  }

  const keys =
    Object.keys(value)

  const v1Keys = [
    'upc',
    'modifier',
    'description',
    'department',
    'price',
  ]

  const v2Keys = [
    'upc',
    'modifier',
    'description',
    'department',
    'price',

    'payment_product_code',
    'selling_unit',
    'maximum_quantity_per_transaction',
    'taxable_rebate',

    'flag_ids',
    'tax_rate_ids',
    'id_check_ids',
  ]

  const exact =
    expected =>
      keys.length === expected.length
      && keys.every(
        key => expected.includes(key),
      )

  const v1 = exact(v1Keys)
  const v2 = exact(v2Keys)

  if (!v1 && !v2) {
    throw new PosPublishError(
      'commander_response_invalid',
    )
  }

  const sysid = input => {
    if (
      typeof input !== 'string'
      || !/^\d{1,16}$/.test(input)
    ) {
      throw new Error(
        'sysid_invalid',
      )
    }

    return input
  }

  const decimal = (
    input,
    fractionDigits,
  ) => {
    if (typeof input !== 'string') {
      throw new Error(
        'decimal_invalid',
      )
    }

    const pattern =
      new RegExp(
        `^(?:0|[1-9]\\d{0,5})(?:\\.\\d{1,${fractionDigits}})?$`,
      )

    if (!pattern.test(input)) {
      throw new Error(
        'decimal_invalid',
      )
    }

    const amount = Number(input)

    if (
      !Number.isFinite(amount)
      || amount < 0
    ) {
      throw new Error(
        'decimal_invalid',
      )
    }

    return amount.toFixed(
      fractionDigits,
    )
  }

  const money = input => {
    if (
      typeof input !== 'string'
      || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(input)
    ) {
      throw new Error(
        'money_invalid',
      )
    }

    const amount = Number(input)

    if (
      !Number.isFinite(amount)
      || amount < 0
      || amount > 999999.99
    ) {
      throw new Error(
        'money_invalid',
      )
    }

    return amount.toFixed(2)
  }

  const ids = input => {
    if (
      !Array.isArray(input)
      || input.length > 16
    ) {
      throw new Error(
        'ids_invalid',
      )
    }

    const result =
      input.map(sysid)

    if (
      new Set(result).size
      !== result.length
    ) {
      throw new Error(
        'ids_invalid',
      )
    }

    return result
  }

  try {
    if (
      typeof value.modifier !== 'string'
      || !/^\d{3}$/.test(
        value.modifier,
      )
    ) {
      throw new Error(
        'modifier_invalid',
      )
    }

    if (
      typeof value.description !== 'string'
      || value.description.length < 1
      || value.description.length > 512
      || /[\u0000-\u001f\u007f-\u009f]/u
        .test(value.description)
    ) {
      throw new Error(
        'description_invalid',
      )
    }

    if (
      typeof value.department !== 'string'
      || !/^\d{1,16}$/
        .test(value.department)
    ) {
      throw new Error(
        'department_invalid',
      )
    }

    const result = {
      upc:
        assertCanonicalUpc(
          value.upc,
          'commander_response_invalid',
        ),

      modifier:
        value.modifier,

      description:
        value.description,

      department:
        value.department,

      price:
        assertDecimalPrice(
          value.price,
          'commander_response_invalid',
        ),
    }

    if (v2) {
      Object.assign(
        result,
        {
          payment_product_code:
            sysid(
              value.payment_product_code,
            ),

          selling_unit:
            decimal(
              value.selling_unit,
              3,
            ),

          maximum_quantity_per_transaction:
            decimal(
              value.maximum_quantity_per_transaction,
              2,
            ),

          taxable_rebate:
            money(
              value.taxable_rebate,
            ),

          flag_ids:
            ids(
              value.flag_ids,
            ),

          tax_rate_ids:
            ids(
              value.tax_rate_ids,
            ),

          id_check_ids:
            ids(
              value.id_check_ids,
            ),
        },
      )
    }

    return result
  } catch {
    throw new PosPublishError(
      'commander_response_invalid',
    )
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

export function createPosPublishWorker({ apiClient, commanderAdapter, logger = () => {}, now = () => Date.now(), sleep = waitForCreateReadback, executionGuard = new Set() }) {
  if (!apiClient || typeof apiClient.claim !== 'function' || typeof apiClient.report !== 'function') throw new PosPublishError('worker_configuration_invalid')
  if (typeof logger !== 'function' || typeof now !== 'function' || typeof sleep !== 'function' || !(executionGuard instanceof Set)) throw new PosPublishError('worker_configuration_invalid')
  const adapter = assertCommanderPriceAdapter(commanderAdapter)
  let processing = false

  function reportPayload(job, payload) {
    return job.operation === 'create_product'
      ? { ...payload, operation: 'create_product' }
      : payload
  }

  async function reportFailure(job, failure) {
    try {
      await apiClient.report(reportPayload(job, { job_id: job.job_id, status: 'failed', error_code: failure.code, error_message: failure.message }))
      return true
    } catch {
      return false
    }
  }

  async function readCreateProductDetail(job) {
    let lastError
    for (let attempt = 0; attempt < CREATE_READBACK_MAX_ATTEMPTS; attempt += 1) {
      try {
        return validateReadProductDetail(await adapter.readProductDetail({ upc: job.upc, modifier: job.modifier }))
      } catch (error) {
        lastError = error
        if (attempt + 1 < CREATE_READBACK_MAX_ATTEMPTS) {
          await sleep(CREATE_READBACK_RETRY_DELAY_MS)
        }
      }
    }
    throw lastError
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
          await apiClient.report(reportPayload(job, { job_id: job.job_id, status: 'sending' }))
        } catch {
          const failureReported = await reportFailure(job, { code: 'internal_connector_error', message: 'StorePulse status reporting failed.' })
          safeLog(logger, { event: 'pos_publish_status_report_failed', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'sending', error_code: 'internal_connector_error', duration_ms: elapsed() })
          return { outcome: 'status_report_failed', job_id: job.job_id, stage: 'sending', failure_reported: failureReported }
        }

        // The Commander mutation can now begin. Keep this ID for the process lifetime from this point onward.
        executionGuard.add(job.job_id)
        safeLog(logger, { event: 'pos_publish_sending', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'sending' })
        try {
          if (job.operation === 'create_product') {
            if (typeof adapter.createProduct !== 'function') throw new PosPublishError('worker_configuration_invalid')
            await adapter.createProduct({ upc: job.upc, modifier: job.modifier, description: job.description, department: job.department, price: job.price, paymentProductCode: job.payment_product_code, sellingUnit: job.selling_unit, maxQtyPerTrans: job.max_qty_per_trans, taxableRebate: job.taxable_rebate, taxRateIds: job.tax_rate_ids, idCheckIds: job.id_check_ids, flagIds: job.flag_ids, jobId: job.job_id })
          } else if (job.operation === 'update_product') {
            if (typeof adapter.updateProduct !== 'function') throw new PosPublishError('worker_configuration_invalid')
            const updateInput = {
              upc: job.upc,
              modifier: job.modifier,
              expectedDescription: job.expected_description,
              description: job.description,
              expectedDepartment: job.expected_department,
              department: job.department,
              expectedPrice: job.expected_price,
              price: job.price,
              ...(Object.hasOwn(job, 'payment_product_code')
                ? {
                    expectedPaymentProductCode: job.expected_payment_product_code,
                    paymentProductCode: job.payment_product_code,
                    expectedSellingUnit: job.expected_selling_unit,
                    sellingUnit: job.selling_unit,
                    expectedMaxQtyPerTrans: job.expected_max_qty_per_trans,
                    maxQtyPerTrans: job.max_qty_per_trans,
                    expectedTaxableRebate: job.expected_taxable_rebate,
                    taxableRebate: job.taxable_rebate,
                    expectedTaxRateIds: job.expected_tax_rate_ids,
                    taxRateIds: job.tax_rate_ids,
                    expectedIdCheckIds: job.expected_id_check_ids,
                    idCheckIds: job.id_check_ids,
                  }
                : {}),
            }
            await adapter.updateProduct(updateInput)
          } else {
            await adapter.updatePrice({ upc: job.upc, modifier: job.modifier, expectedPrice: job.expected_price, price: job.price })
          }
        } catch (error) {
          const failure = failureFor(error)
          const failureReported = await reportFailure(job, failure)
          safeLog(logger, { event: 'pos_publish_failed', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'failed', error_code: failure.code, duration_ms: elapsed() })
          return { outcome: 'commander_failed', job_id: job.job_id, failure_code: failure.code, failure_reported: failureReported }
        }

        try {
          await apiClient.report(reportPayload(job, { job_id: job.job_id, status: 'verifying' }))
        } catch {
          const failureReported = await reportFailure(job, { code: 'internal_connector_error', message: 'StorePulse status reporting failed.' })
          safeLog(logger, { event: 'pos_publish_status_report_failed', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'verifying', error_code: 'internal_connector_error', duration_ms: elapsed() })
          return { outcome: 'status_report_failed', job_id: job.job_id, stage: 'verifying', failure_reported: failureReported }
        }

        let product
        try {
          if (job.operation === 'update_product' || job.operation === 'create_product') {
            if (typeof adapter.readProductDetail !== 'function') throw new PosPublishError('worker_configuration_invalid')
            product = job.operation === 'create_product'
              ? await readCreateProductDetail(job)
              : validateReadProductDetail(await adapter.readProductDetail({ upc: job.upc, modifier: job.modifier }))
            if (product.upc !== job.upc || product.modifier !== job.modifier) throw new PosPublishError('verification_upc_mismatch')
            if (
              product.description !== job.description
              || product.department !== job.department
              || product.price !== job.price
            ) {
              throw new PosPublishError(
                'verification_price_mismatch',
              )
            }

            if (
              job.operation === 'create_product' || Object.hasOwn(job, 'payment_product_code')
            ) {
              const sameIds = (
                left,
                right,
              ) =>
                Array.isArray(left)
                && Array.isArray(right)
                && left.length === right.length
                && left.every(
                  (item, index) =>
                    item === right[index],
                )

              if (
                product.payment_product_code
                  !== job.payment_product_code

                || product.selling_unit
                  !== job.selling_unit

                || product.maximum_quantity_per_transaction
                  !== job.max_qty_per_trans

                || product.taxable_rebate
                  !== job.taxable_rebate

                || !sameIds(
                  product.tax_rate_ids,
                  job.tax_rate_ids,
                )

                || !sameIds(
                  product.id_check_ids,
                  job.id_check_ids,
                )
              ) {
                throw new PosPublishError(
                  'verification_price_mismatch',
                )
              }
            }
          } else {
            product = validateReadProduct(await adapter.readProduct({ upc: job.upc, modifier: job.modifier }))
            if (product.upc !== job.upc || product.modifier !== job.modifier) throw new PosPublishError('verification_upc_mismatch')
            if (product.price !== job.price) throw new PosPublishError('verification_price_mismatch')
          }
        } catch (error) {
          const failure = failureFor(error)
          const failureReported = await reportFailure(job, failure)
          safeLog(logger, { event: 'pos_publish_failed', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'failed', error_code: failure.code, duration_ms: elapsed() })
          return { outcome: 'commander_failed', job_id: job.job_id, failure_code: failure.code, failure_reported: failureReported }
        }

        try {
          const verification =
            job.operation === 'update_product' || job.operation === 'create_product'
              ? {
                  upc: job.upc,
                  modifier: job.modifier,

                  description:
                    job.description,

                  department:
                    job.department,

                  price:
                    job.price,

                  ...(job.operation === 'create_product' || Object.hasOwn(job, 'payment_product_code')
                    ? {
                        payment_product_code:
                          job.payment_product_code,

                        selling_unit:
                          job.selling_unit,

                        maximum_quantity_per_transaction:
                          job.max_qty_per_trans,

                        taxable_rebate:
                          job.taxable_rebate,

                        tax_rate_ids:
                          job.tax_rate_ids,

                        id_check_ids:
                          job.id_check_ids,
                        ...(job.operation === 'create_product' ? { flag_ids: job.flag_ids } : {}),
                      }
                    : {}),
                }
              : {
                  upc: job.upc,
                  modifier: job.modifier,
                  price: job.price,
                }
          await apiClient.report(reportPayload(job, { job_id: job.job_id, status: 'completed', verification }))
        } catch {
          const failureReported = job.operation === 'create_product'
            ? await reportFailure(job, { code: 'internal_connector_error', message: 'StorePulse completion status reporting failed.' })
            : false
          safeLog(logger, { event: 'pos_publish_status_report_failed', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'completed', error_code: 'internal_connector_error', duration_ms: elapsed() })
          return { outcome: 'status_report_failed', job_id: job.job_id, stage: 'completed', failure_reported: failureReported }
        }
        safeLog(logger, { event: 'pos_publish_completed', job_id: job.job_id, operation: job.operation, attempt: job.attempt, status: 'completed', duration_ms: elapsed() })
        return { outcome: 'completed', job_id: job.job_id }
      } finally {
        processing = false
      }
    },
  }
}
