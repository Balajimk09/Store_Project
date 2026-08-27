import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseCommanderVpluResponse,
} from '../lib/commander/commander-vplu-read-client.mjs'

import {
  buildUpdateProductXml,
  parseVpluResponse,
} from '../lib/commander/commander-product-integration.mjs'

const UPC = '00000000000017'

function response(taxableRebate) {
  return [
    '<domain:PLUs',
    ' page="55"',
    ' ofPages="90"',
    ' xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"',
    ' xmlns:vs="urn:vfi-sapphire:vs.2001-10-01">',
    '<domain:PLU>',
    `<upc>${UPC}</upc>`,
    '<upcModifier>000</upcModifier>',
    '<description>REBATE VARIANT TEST</description>',
    '<department>1</department>',
    '<fees><fee>0</fee></fees>',
    '<pcode>0</pcode>',
    '<price>3.00</price>',
    '<flags><domain:flag sysid="1"/></flags>',
    '<taxRates><domain:taxRate sysid="1"/></taxRates>',
    '<idChecks><domain:idCheck sysid="3"/></idChecks>',
    '<SellUnit>1.000</SellUnit>',
    taxableRebate,
    '<maxQtyPerTrans>0.00</maxQtyPerTrans>',
    '</domain:PLU>',
    '</domain:PLUs>',
  ].join('')
}

const amountOnly =
  '<taxableRebate>'
  + '<amount>0.00</amount>'
  + '</taxableRebate>'

const amountPlusTaxRateWithSysid =
  '<taxableRebate>'
  + '<amount>0.00</amount>'
  + '<domain:taxRate sysid="2"/>'
  + '</taxableRebate>'

const amountPlusTaxRateWithoutAttributes =
  '<taxableRebate>'
  + '<amount>0.00</amount>'
  + '<domain:taxRate/>'
  + '</taxableRebate>'

test('shared reader retains existing amount-only contract', () => {
  const [product] =
    parseCommanderVpluResponse(
      response(amountOnly),
    )

  assert.equal(
    product.taxable_rebate,
    '0.00',
  )

  assert.deepEqual(
    product.tax_rate_ids,
    ['1'],
  )
})

test('shared reader accepts live taxableRebate amount-plus-taxRate shape', () => {
  for (const taxableRebate of [
    amountPlusTaxRateWithSysid,
    amountPlusTaxRateWithoutAttributes,
  ]) {
    const [product] =
      parseCommanderVpluResponse(
        response(taxableRebate),
      )

    assert.equal(
      product.taxable_rebate,
      '0.00',
    )

    /*
     * Rebate taxRate is a distinct nested Commander value.
     * Product-level tax_rate_ids still come from <taxRates>.
     */
    assert.deepEqual(
      product.tax_rate_ids,
      ['1'],
    )
  }
})

test('exact product reader accepts same live taxableRebate variant', () => {
  for (const taxableRebate of [
    amountOnly,
    amountPlusTaxRateWithSysid,
    amountPlusTaxRateWithoutAttributes,
  ]) {
    const [product] =
      parseVpluResponse(
        response(taxableRebate),
      )

    assert.equal(
      product.taxable_rebate,
      '0.00',
    )

    assert.deepEqual(
      product.tax_rate_ids,
      ['1'],
    )
  }
})

test('rebate update preserves nested taxRate while replacing amount', () => {
  const [product] =
    parseVpluResponse(
      response(
        amountPlusTaxRateWithSysid,
      ),
    )

  const xml =
    buildUpdateProductXml(
      product,
      {
        description: product.description,
        department_number: product.department_number,
        retail_price: product.retail_price,
        taxable_rebate: '0.25',
      },
    )

  assert.match(
    xml,
    /<taxableRebate><amount>0\.25<\/amount><domain:taxRate sysid="2"><\/domain:taxRate><\/taxableRebate>/,
  )

  const [readback] =
    parseVpluResponse(xml)

  assert.equal(
    readback.taxable_rebate,
    '0.25',
  )

  assert.deepEqual(
    readback.tax_rate_ids,
    ['1'],
  )
})

test('unknown taxableRebate child remains rejected', () => {
  const malformed =
    '<taxableRebate>'
    + '<amount>0.00</amount>'
    + '<unexpected/>'
    + '</taxableRebate>'

  assert.throws(
    () =>
      parseCommanderVpluResponse(
        response(malformed),
      ),
    /vplu_response_invalid/,
  )

  assert.throws(
    () =>
      parseVpluResponse(
        response(malformed),
      ),
    /vplu_response_invalid/,
  )
})

test('duplicate amount remains rejected', () => {
  const malformed =
    '<taxableRebate>'
    + '<amount>0.00</amount>'
    + '<amount>0.00</amount>'
    + '</taxableRebate>'

  assert.throws(
    () =>
      parseCommanderVpluResponse(
        response(malformed),
      ),
    /vplu_response_invalid/,
  )

  assert.throws(
    () =>
      parseVpluResponse(
        response(malformed),
      ),
    /vplu_response_invalid/,
  )
})

test('duplicate nested taxRate remains rejected', () => {
  const malformed =
    '<taxableRebate>'
    + '<amount>0.00</amount>'
    + '<domain:taxRate/>'
    + '<domain:taxRate/>'
    + '</taxableRebate>'

  assert.throws(
    () =>
      parseCommanderVpluResponse(
        response(malformed),
      ),
    /vplu_response_invalid/,
  )

  assert.throws(
    () =>
      parseVpluResponse(
        response(malformed),
      ),
    /vplu_response_invalid/,
  )
})

test('unexpected nested taxRate structures remain rejected', () => {
  const malformedValues = [
    '<taxableRebate>'
      + '<amount>0.00</amount>'
      + '<domain:taxRate name="unexpected"/>'
      + '</taxableRebate>',

    '<taxableRebate>'
      + '<amount>0.00</amount>'
      + '<domain:taxRate sysid="1" extra="x"/>'
      + '</taxableRebate>',

    '<taxableRebate>'
      + '<amount>0.00</amount>'
      + '<domain:taxRate><nested/></domain:taxRate>'
      + '</taxableRebate>',

    '<taxableRebate>'
      + '<amount>0.00</amount>'
      + '<domain:taxRate>text</domain:taxRate>'
      + '</taxableRebate>',
  ]

  for (const malformed of malformedValues) {
    assert.throws(
      () =>
        parseCommanderVpluResponse(
          response(malformed),
        ),
      /vplu_response_invalid/,
    )

    assert.throws(
      () =>
        parseVpluResponse(
          response(malformed),
        ),
      /vplu_response_invalid/,
    )
  }
})