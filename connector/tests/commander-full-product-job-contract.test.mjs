import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validateClaimResponse,
  validateReportPayload,
} from '../lib/pos-publish-api-client.mjs'

import {
  createPosPublishWorker,
} from '../lib/pos-publish-worker.mjs'

const JOB_ID =
  '11111111-1111-4111-8111-111111111111'

const PRODUCT_ID =
  '22222222-2222-4222-8222-222222222222'

const UPC =
  '00810195100184'

const MODIFIER =
  '000'

function fullJob() {
  return {
    job_id: JOB_ID,
    operation: 'update_product',
    product_id: PRODUCT_ID,

    upc: UPC,
    modifier: MODIFIER,

    expected_description:
      'FULL PRODUCT TEST',

    description:
      'FULL PRODUCT UPDATED',

    expected_department:
      '24',

    department:
      '9',

    expected_price:
      '20.99',

    price:
      '21.99',

    expected_payment_product_code:
      '0',

    payment_product_code:
      '400',

    expected_selling_unit:
      '1.000',

    selling_unit:
      '2.000',

    expected_max_qty_per_trans:
      '0.00',

    max_qty_per_trans:
      '5.00',

    expected_taxable_rebate:
      '0.00',

    taxable_rebate:
      '0.25',

    expected_tax_rate_ids:
      ['2'],

    tax_rate_ids:
      ['1', '3'],

    expected_id_check_ids:
      ['2'],

    id_check_ids:
      ['1'],

    attempt: 1,

    claimed_at:
      '2026-08-14T22:00:00Z',
  }
}

test(
  'claim validator accepts the full update_product job',
  () => {
    const job = fullJob()

    assert.deepEqual(
      validateClaimResponse(job),
      job,
    )
  },
)

test(
  'completion validator accepts full verified state',
  () => {
    const job = fullJob()

    const payload = {
      job_id: JOB_ID,

      status: 'completed',

      verification: {
        upc: UPC,
        modifier: MODIFIER,

        description:
          job.description,

        department:
          job.department,

        price:
          job.price,

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
      },
    }

    assert.deepEqual(
      validateReportPayload(payload),
      payload,
    )
  },
)

test(
  'worker sends and verifies full state through the same update_product path',
  async () => {
    const job = fullJob()

    const reports = []
    const updates = []

    const commanderAdapter = {
      updatePrice:
        async () => {
          throw new Error(
            'price_only_path_must_not_run',
          )
        },

      readProduct:
        async () => ({
          upc: UPC,
          modifier: MODIFIER,
          price: job.price,
        }),

      updateProduct:
        async input => {
          updates.push(input)

          return {
            idempotent: false,
          }
        },

      readProductDetail:
        async () => ({
          upc: UPC,
          modifier: MODIFIER,

          description:
            job.description,

          department:
            job.department,

          price:
            job.price,

          payment_product_code:
            job.payment_product_code,

          selling_unit:
            job.selling_unit,

          maximum_quantity_per_transaction:
            job.max_qty_per_trans,

          taxable_rebate:
            job.taxable_rebate,

          flag_ids:
            ['7'],

          tax_rate_ids:
            job.tax_rate_ids,

          id_check_ids:
            job.id_check_ids,
        }),
    }

    const apiClient = {
      claim:
        async () => job,

      report:
        async payload => {
          reports.push(payload)

          return {
            job_id:
              payload.job_id,

            status:
              payload.status,
          }
        },
    }

    const worker =
      createPosPublishWorker({
        apiClient,
        commanderAdapter,
      })

    assert.deepEqual(
      await worker.processOne(),
      {
        outcome: 'completed',
        job_id: JOB_ID,
      },
    )

    assert.equal(
      updates.length,
      1,
    )

    assert.deepEqual(
      updates[0],
      {
        upc: UPC,
        modifier: MODIFIER,

        expectedDescription:
          job.expected_description,

        description:
          job.description,

        expectedDepartment:
          job.expected_department,

        department:
          job.department,

        expectedPrice:
          job.expected_price,

        price:
          job.price,

        expectedPaymentProductCode:
          job.expected_payment_product_code,

        paymentProductCode:
          job.payment_product_code,

        expectedSellingUnit:
          job.expected_selling_unit,

        sellingUnit:
          job.selling_unit,

        expectedMaxQtyPerTrans:
          job.expected_max_qty_per_trans,

        maxQtyPerTrans:
          job.max_qty_per_trans,

        expectedTaxableRebate:
          job.expected_taxable_rebate,

        taxableRebate:
          job.taxable_rebate,

        expectedTaxRateIds:
          job.expected_tax_rate_ids,

        taxRateIds:
          job.tax_rate_ids,

        expectedIdCheckIds:
          job.expected_id_check_ids,

        idCheckIds:
          job.id_check_ids,
      },
    )

    const completed =
      reports.find(
        report =>
          report.status === 'completed',
      )

    assert.ok(completed)

    assert.deepEqual(
      completed.verification,
      {
        upc: UPC,
        modifier: MODIFIER,

        description:
          job.description,

        department:
          job.department,

        price:
          job.price,

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
      },
    )
  },
)

test(
  'full worker rejects mismatched tax readback',
  async () => {
    const job = fullJob()

    let completed = false

    const commanderAdapter = {
      updatePrice:
        async () => {},

      readProduct:
        async () => ({
          upc: UPC,
          modifier: MODIFIER,
          price: job.price,
        }),

      updateProduct:
        async () => ({
          idempotent: false,
        }),

      readProductDetail:
        async () => ({
          upc: UPC,
          modifier: MODIFIER,

          description:
            job.description,

          department:
            job.department,

          price:
            job.price,

          payment_product_code:
            job.payment_product_code,

          selling_unit:
            job.selling_unit,

          maximum_quantity_per_transaction:
            job.max_qty_per_trans,

          taxable_rebate:
            job.taxable_rebate,

          flag_ids:
            ['7'],

          tax_rate_ids:
            ['999'],

          id_check_ids:
            job.id_check_ids,
        }),
    }

    const apiClient = {
      claim:
        async () => job,

      report:
        async payload => {
          if (
            payload.status === 'completed'
          ) {
            completed = true
          }

          return {
            job_id:
              payload.job_id,

            status:
              payload.status,
          }
        },
    }

    const worker =
      createPosPublishWorker({
        apiClient,
        commanderAdapter,
      })

    const result =
      await worker.processOne()

    assert.notEqual(
      result.outcome,
      'completed',
    )

    assert.equal(
      completed,
      false,
    )
  },
)
