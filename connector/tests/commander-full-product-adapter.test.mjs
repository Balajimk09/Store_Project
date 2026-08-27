import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseVpluResponse,
} from '../lib/commander/commander-product-integration.mjs'

import {
  createCommanderPriceAdapter,
} from '../lib/commander-price-adapter.mjs'

const UPC = '00810195100184'
const MODIFIER = '000'

const XML =
  `<domain:PLUs page="1" ofPages="1" `
  + `xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01" `
  + `xmlns:vs="urn:vfi-sapphire:vs.2001-10-01">`
  + `<domain:PLU>`
  + `<upc>${UPC}</upc>`
  + `<upcModifier>${MODIFIER}</upcModifier>`
  + `<description>FULL PRODUCT TEST</description>`
  + `<department>24</department>`
  + `<fees><fee>0</fee></fees>`
  + `<pcode>0</pcode>`
  + `<price>20.99</price>`
  + `<flags><domain:flag sysid="1"/><domain:flag sysid="7"/></flags>`
  + `<taxRates><domain:taxRate sysid="2"/></taxRates>`
  + `<idChecks><domain:idCheck sysid="2"/></idChecks>`
  + `<SellUnit>1.000</SellUnit>`
  + `<taxableRebate><amount>0.00</amount></taxableRebate>`
  + `<maxQtyPerTrans>0.00</maxQtyPerTrans>`
  + `</domain:PLU>`
  + `</domain:PLUs>`

test(
  'same adapter carries extended fields through update_product',
  async () => {
    const [product] = parseVpluResponse(XML)
    const writes = []

    const adapter = createCommanderPriceAdapter({
      origin: 'https://commander.fixture',
      sessionCookie: 'fixture-cookie',
      trust: {},

      readCommanderProductImpl:
        async () => ({
          status: 'success',
          product,
        }),

      sendSupportedProductWriteImpl:
        async input => {
          writes.push(input)

          return {
            status: 'success',
          }
        },
    })

    const result = await adapter.updateProduct({
      upc: UPC,
      modifier: MODIFIER,

      expectedDescription:
        'FULL PRODUCT TEST',

      description:
        'FULL PRODUCT UPDATED',

      expectedDepartment:
        '24',

      department:
        '9',

      expectedPrice:
        '20.99',

      price:
        '21.99',

      expectedPaymentProductCode:
        '0',

      paymentProductCode:
        '400',

      expectedSellingUnit:
        '1.000',

      sellingUnit:
        '2.000',

      expectedMaxQtyPerTrans:
        '0.00',

      maxQtyPerTrans:
        '5.00',

      expectedTaxableRebate:
        '0.00',

      taxableRebate:
        '0.25',

      expectedTaxRateIds:
        ['2'],

      taxRateIds:
        ['1', '3'],

      expectedIdCheckIds:
        ['2'],

      idCheckIds:
        ['1'],
    })

    assert.deepEqual(
      result,
      {
        idempotent: false,
      },
    )

    assert.equal(writes.length, 1)

    assert.equal(
      writes[0].command.command_type,
      'update_product',
    )

    assert.deepEqual(
      writes[0].command.requested_changes,
      {
        description:
          'FULL PRODUCT UPDATED',

        department_number:
          '9',

        retail_price:
          '21.99',

        payment_product_code:
          '400',

        selling_unit:
          '2.000',

        maximum_quantity_per_transaction:
          '5.00',

        taxable_rebate:
          '0.25',

        tax_rate_ids:
          ['1', '3'],

        id_check_ids:
          ['1'],
      },
    )
  },
)

test(
  'adapter exposes extended Commander readback state',
  async () => {
    const [product] = parseVpluResponse(XML)

    const adapter = createCommanderPriceAdapter({
      origin: 'https://commander.fixture',
      sessionCookie: 'fixture-cookie',
      trust: {},

      readCommanderProductImpl:
        async () => ({
          status: 'success',
          product,
        }),

      sendSupportedProductWriteImpl:
        async () => ({
          status: 'success',
        }),
    })

    const detail =
      await adapter.readProductDetail({
        upc: UPC,
        modifier: MODIFIER,
      })

    assert.deepEqual(
      detail,
      {
        upc: UPC,
        modifier: MODIFIER,
        description: 'FULL PRODUCT TEST',
        department: '24',
        price: '20.99',
        payment_product_code: '0',
        selling_unit: '1.000',
        maximum_quantity_per_transaction: '0.00',
        taxable_rebate: '0.00',
        flag_ids: ['1', '7'],
        tax_rate_ids: ['2'],
        id_check_ids: ['2'],
      },
    )
  },
)

test(
  'stale extended Commander state blocks write',
  async () => {
    const [product] = parseVpluResponse(XML)

    let writes = 0

    const adapter = createCommanderPriceAdapter({
      origin: 'https://commander.fixture',
      sessionCookie: 'fixture-cookie',
      trust: {},

      readCommanderProductImpl:
        async () => ({
          status: 'success',
          product,
        }),

      sendSupportedProductWriteImpl:
        async () => {
          writes += 1

          return {
            status: 'success',
          }
        },
    })

    await assert.rejects(
      adapter.updateProduct({
        upc: UPC,
        modifier: MODIFIER,

        expectedDescription:
          'FULL PRODUCT TEST',

        description:
          'FULL PRODUCT UPDATED',

        expectedDepartment:
          '24',

        department:
          '9',

        expectedPrice:
          '20.99',

        price:
          '21.99',

        expectedTaxRateIds:
          ['99'],

        taxRateIds:
          ['1'],
      }),

      error =>
        error.code ===
        'price_conflict',
    )

    assert.equal(writes, 0)
  },
)