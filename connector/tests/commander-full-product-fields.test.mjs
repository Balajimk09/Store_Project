import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProductWriteXml,
  parseVpluResponse,
} from '../lib/commander/commander-product-integration.mjs'

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
  + `<flags>`
  + `<domain:flag sysid="1"/>`
  + `<domain:flag sysid="7"/>`
  + `</flags>`
  + `<taxRates>`
  + `<domain:taxRate sysid="2"/>`
  + `</taxRates>`
  + `<idChecks>`
  + `<domain:idCheck sysid="2"/>`
  + `</idChecks>`
  + `<SellUnit>1.000</SellUnit>`
  + `<taxableRebate><amount>0.00</amount></taxableRebate>`
  + `<maxQtyPerTrans>0.00</maxQtyPerTrans>`
  + `</domain:PLU>`
  + `</domain:PLUs>`

function fullCommand() {
  return {
    command_id: 'phase1-full-product',

    command_type: 'update_product',

    source_product_key:
      `upc:${UPC}|modifier:${MODIFIER}`,

    identity: {
      upc: UPC,
      modifier: MODIFIER,
    },

    expected_current: {
      description: 'FULL PRODUCT TEST',
      department_number: '24',
      retail_price: '20.99',
      payment_product_code: '0',
      selling_unit: '1.000',
      maximum_quantity_per_transaction: '0.00',
      taxable_rebate: '0.00',
      tax_rate_ids: ['2'],
      id_check_ids: ['2'],
    },

    requested_changes: {
      description: 'FULL PRODUCT UPDATED',
      department_number: '9',
      retail_price: '21.99',
      payment_product_code: '400',
      selling_unit: '2.000',
      maximum_quantity_per_transaction: '5.00',
      taxable_rebate: '0.25',
      tax_rate_ids: ['1', '3'],
      id_check_ids: ['1'],
    },

    approval: null,

    created_at:
      '2026-08-14T22:00:00Z',

    idempotency_key:
      'phase1-full-product-key',
  }
}

test(
  'vPLUs exposes bounded full product fields',
  () => {
    const [product] = parseVpluResponse(XML)

    assert.equal(
      product.payment_product_code,
      '0',
    )

    assert.equal(
      product.selling_unit,
      '1.000',
    )

    assert.equal(
      product.maximum_quantity_per_transaction,
      '0.00',
    )

    assert.equal(
      product.taxable_rebate,
      '0.00',
    )

    assert.deepEqual(
      product.flag_ids,
      ['1', '7'],
    )

    assert.deepEqual(
      product.tax_rate_ids,
      ['2'],
    )

    assert.deepEqual(
      product.id_check_ids,
      ['2'],
    )

    assert.equal(
      Object.hasOwn(product, 'raw_xml'),
      false,
    )
  },
)

test(
  'one update_product changes all proven explicit fields',
  () => {
    const [product] = parseVpluResponse(XML)

    const write = buildProductWriteXml(
      fullCommand(),
      product,
    )

    assert.equal(write.supported, true)
    assert.equal(write.command, 'uPLUs')

    assert.match(
      write.xml,
      /<description>FULL PRODUCT UPDATED<\/description>/,
    )

    assert.match(
      write.xml,
      /<department>9<\/department>/,
    )

    assert.match(
      write.xml,
      /<pcode>400<\/pcode>/,
    )

    assert.match(
      write.xml,
      /<price>21\.99<\/price>/,
    )

    assert.match(
      write.xml,
      /<SellUnit>2\.000<\/SellUnit>/,
    )

    assert.match(
      write.xml,
      /<maxQtyPerTrans>5\.00<\/maxQtyPerTrans>/,
    )

    assert.match(
      write.xml,
      /<taxableRebate><amount>0\.25<\/amount><\/taxableRebate>/,
    )

    assert.match(
      write.xml,
      /<taxRates><domain:taxRate sysid="1"><\/domain:taxRate><domain:taxRate sysid="3"><\/domain:taxRate><\/taxRates>/,
    )

    assert.match(
      write.xml,
      /<idChecks><domain:idCheck sysid="1"><\/domain:idCheck><\/idChecks>/,
    )

    // Unknown Commander flags must be preserved.
    assert.match(
      write.xml,
      /<flags><domain:flag sysid="1"><\/domain:flag><domain:flag sysid="7"><\/domain:flag><\/flags>/,
    )

    const [readback] =
      parseVpluResponse(write.xml)

    assert.equal(
      readback.description,
      'FULL PRODUCT UPDATED',
    )

    assert.equal(
      readback.department_number,
      '9',
    )

    assert.equal(
      readback.retail_price,
      '21.99',
    )

    assert.equal(
      readback.payment_product_code,
      '400',
    )

    assert.equal(
      readback.selling_unit,
      '2.000',
    )

    assert.equal(
      readback.maximum_quantity_per_transaction,
      '5.00',
    )

    assert.equal(
      readback.taxable_rebate,
      '0.25',
    )

    assert.deepEqual(
      readback.tax_rate_ids,
      ['1', '3'],
    )

    assert.deepEqual(
      readback.id_check_ids,
      ['1'],
    )

    assert.deepEqual(
      readback.flag_ids,
      ['1', '7'],
    )
  },
)

test(
  'caller cannot inject XML through tax sysids',
  () => {
    const [product] = parseVpluResponse(XML)

    const command = fullCommand()

    command.requested_changes = {
      ...command.requested_changes,
      tax_rate_ids: [
        '2" /><evil',
      ],
    }

    assert.throws(
      () =>
        buildProductWriteXml(
          command,
          product,
        ),
      /validation_failed/,
    )
  },
)

test(
  'malformed or duplicate reference ids are rejected',
  () => {
    const duplicateTax = XML.replace(
      '<taxRates><domain:taxRate sysid="2"/></taxRates>',
      '<taxRates><domain:taxRate sysid="2"/><domain:taxRate sysid="2"/></taxRates>',
    )

    assert.throws(
      () => parseVpluResponse(duplicateTax),
      /vplu_response_invalid/,
    )

    const unsafeIdCheck = XML.replace(
      '<domain:idCheck sysid="2"/>',
      '<domain:idCheck sysid="2" unsafe="1"/>',
    )

    assert.throws(
      () => parseVpluResponse(unsafeIdCheck),
      /vplu_response_invalid/,
    )
  },
)

test('missing optional containers normalize empty and requested tax/id containers can be synthesized', () => {
  const withoutOptional = XML
    .replace(/<flags>[\s\S]*?<\/flags>/, '')
    .replace(/<taxRates>[\s\S]*?<\/taxRates>/, '')
    .replace(/<idChecks>[\s\S]*?<\/idChecks>/, '')
  const [product] = parseVpluResponse(withoutOptional)
  assert.deepEqual(product.flag_ids, [])
  assert.deepEqual(product.tax_rate_ids, [])
  assert.deepEqual(product.id_check_ids, [])

  const write = buildProductWriteXml(fullCommand(), product)
  assert.equal(write.supported, true)
  assert.match(write.xml, /<taxRates><domain:taxRate sysid="1"><\/domain:taxRate><domain:taxRate sysid="3"><\/domain:taxRate><\/taxRates>/)
  assert.match(write.xml, /<idChecks><domain:idCheck sysid="1"><\/domain:idCheck><\/idChecks>/)
  assert.doesNotMatch(write.xml, /<flags>/)

  const [readback] = parseVpluResponse(write.xml)
  assert.deepEqual(readback.flag_ids, [])
  assert.deepEqual(readback.tax_rate_ids, ['1', '3'])
  assert.deepEqual(readback.id_check_ids, ['1'])
})

test('unrequested unknown Commander template fields are preserved, not rejected', () => {
  const withUnknown = XML.replace(
    '<SellUnit>1.000</SellUnit>',
    '<futureCommanderField mode="preserve">opaque</futureCommanderField><SellUnit>1.000</SellUnit>',
  )
  const [product] = parseVpluResponse(withUnknown)
  const command = fullCommand()
  command.expected_current = {
    description: command.expected_current.description,
    department_number: command.expected_current.department_number,
    retail_price: command.expected_current.retail_price,
  }
  command.requested_changes = {
    description: 'FULL PRODUCT UPDATED',
    department_number: command.requested_changes.department_number,
    retail_price: command.requested_changes.retail_price,
  }
  const write = buildProductWriteXml(command, product)
  assert.match(write.xml, /<futureCommanderField mode="preserve">opaque<\/futureCommanderField>/)
})
