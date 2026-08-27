import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildCommanderVpluRequestBody,
  buildCommanderVpluSelectXml,
  parseCommanderVpluResponse,
  readCommanderVpluProduct,
} from '../lib/commander/commander-vplu-read-client.mjs'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(testDirectory, '../..')

const source = readFileSync(
  resolve(
    repositoryRoot,
    'connector/lib/commander/commander-vplu-read-client.mjs',
  ),
  'utf8',
)

function responseXml({
  upc = '00999999999993',
  modifier = '000',
  description = 'STOREPULSE TEST',
  price = '0.02',
} = {}) {
  return (
    '<?xml version="1.0"?>'
    + '<domain:PLUs '
    + 'xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01" '
    + 'page="1" ofPages="1">'
    + '<domain:PLU>'
    + `<upc>${upc}</upc>`
    + `<upcModifier>${modifier}</upcModifier>`
    + `<description>${description}</description>`
    + '<department>10</department>'
    + `<price>${price}</price>`
    + '</domain:PLU>'
    + '</domain:PLUs>'
  )
}


function extendedResponseXml({
  includeFlags = false,
  includeTaxRates = false,
  includeIdChecks = false,
  omitCore = null,
} = {}) {
  const core = {
    pcode: '<pcode>400</pcode>',
    SellUnit: '<SellUnit>1.000</SellUnit>',
    maxQtyPerTrans: '<maxQtyPerTrans>2.00</maxQtyPerTrans>',
    taxableRebate: '<taxableRebate><amount>0.00</amount></taxableRebate>',
  }
  if (omitCore) delete core[omitCore]
  return responseXml().replace(
    '<price>0.02</price>',
    '<price>0.02</price>'
      + Object.values(core).join('')
      + (includeFlags ? '<flags><domain:flag sysid="7"/></flags>' : '')
      + (includeTaxRates ? '<taxRates><domain:taxRate sysid="2"/></taxRates>' : '')
      + (includeIdChecks ? '<idChecks><domain:idCheck sysid="3"/></idChecks>' : ''),
  )
}

test('read client contains no Commander product-write capability', () => {
  assert.doesNotMatch(
    source,
    /uPLUs|buildProductWriteXml|buildUpdatePriceXml|writeCommanderProduct|requested_changes|command_type/,
  )
  assert.doesNotMatch(
    source,
    /COMMANDER_NAXML_COMMANDS|command\s*[,}:]/,
  )
  assert.match(source, /cmd=vPLUs/)
})

test('request body is permanently fixed to vPLUs', () => {
  const body = buildCommanderVpluRequestBody({
    sessionCookie: 'safe-cookie',
    upc: '00000000000017',
    modifier: '000',
  })

  assert.match(body, /^cmd=vPLUs&cookie=safe-cookie\r\n\r\n/)
  assert.match(body, /<upc source="keyboard">00000000000017<\/upc>/)
  assert.match(body, /<upcModifier>000<\/upcModifier>/)
})

test('selection XML preserves UPC leading zeroes', () => {
  const xml = buildCommanderVpluSelectXml({
    upc: '00000000034524',
    modifier: '000',
  })
  assert.match(xml, />00000000034524</)
})

test('response parser emits only read contract fields', () => {
  const [product] = parseCommanderVpluResponse(responseXml())

  assert.deepEqual(Object.keys(product), [
    'upc',
    'modifier',
    'description',
    'retail_price',
    'cost',
    'department_number',
    'department_name',
    'category_number',
    'category_name',
    'tax_number',
    'tax_name',
    'age_restriction',
    'active',
    'raw_payload_hash',
  ])
  assert.equal(product.upc, '00999999999993')
  assert.equal(product.retail_price, '0.02')
  assert.equal(product.department_number, '10')
  assert.match(product.raw_payload_hash, /^[0-9a-f]{64}$/)
  assert.equal(Object.hasOwn(product, '_write_template'), false)
})

test('read performs one verified vPLUs request and returns selected product', async () => {
  const calls = []
  const result = await readCommanderVpluProduct({
    origin: 'https://192.168.31.11',
    sessionCookie: 'safe-cookie',
    trust: {
      serverName: 'sitecontroller',
      peerSha256: 'A'.repeat(64),
      caBundle: Buffer.from('certificate'),
    },
    upc: '00999999999993',
    modifier: '000',
    transport: async (request) => {
      calls.push(request)
      return { status: 200, body: responseXml() }
    },
  })

  assert.equal(result.status, 'success')
  assert.equal(result.product.description, 'STOREPULSE TEST')
  assert.equal(calls.length, 1)
  assert.equal(
    calls[0].url,
    'https://192.168.31.11/cgi-bin/NAXML?',
  )
  assert.match(calls[0].body, /^cmd=vPLUs&/)
  assert.equal(calls[0].options.rejectUnauthorized, true)
  assert.equal(calls[0].options.servername, 'sitecontroller')
})

test('wrong selected identity returns product not found', async () => {
  const result = await readCommanderVpluProduct({
    origin: 'https://192.168.31.11',
    sessionCookie: 'safe-cookie',
    trust: {
      serverName: 'sitecontroller',
      peerSha256: 'A'.repeat(64),
      caBundle: Buffer.from('certificate'),
    },
    upc: '00000000000017',
    modifier: '000',
    transport: async () => ({
      status: 200,
      body: responseXml(),
    }),
  })

  assert.deepEqual(result, { status: 'product_not_found' })
})

test('authentication and malformed response fail safely', async () => {
  const base = {
    origin: 'https://192.168.31.11',
    sessionCookie: 'safe-cookie',
    trust: {
      serverName: 'sitecontroller',
      peerSha256: 'A'.repeat(64),
      caBundle: Buffer.from('certificate'),
    },
    upc: '00999999999993',
    modifier: '000',
  }

  assert.deepEqual(
    await readCommanderVpluProduct({
      ...base,
      transport: async () => ({ status: 401, body: '' }),
    }),
    { status: 'session_failed' },
  )

  assert.deepEqual(
    await readCommanderVpluProduct({
      ...base,
      transport: async () => ({
        status: 200,
        body: '<not-valid>',
      }),
    }),
    { status: 'readback_failed' },
  )
})

test('XML parser rejects entities, duplicates, and oversized values', () => {
  assert.throws(
    () => parseCommanderVpluResponse(
      '<!DOCTYPE x><domain:PLUs></domain:PLUs>',
    ),
    /vplu_response_invalid/,
  )

  assert.throws(
    () => parseCommanderVpluResponse(
      responseXml().replace(
        '</domain:PLUs>',
        responseXml().replace(
          /^<\?xml version="1\.0"\?><domain:PLUs[^>]*>|<\/domain:PLUs>$/g,
          '',
        ) + '</domain:PLUs>',
      ),
    ),
    /duplicate_product_identity/,
  )
})


test('V2 core fields accept missing optional Commander containers as empty arrays', () => {
  const [product] = parseCommanderVpluResponse(extendedResponseXml())
  assert.equal(product.payment_product_code, '400')
  assert.equal(product.selling_unit, '1.000')
  assert.equal(product.maximum_quantity_per_transaction, '2.00')
  assert.equal(product.taxable_rebate, '0.00')
  assert.deepEqual(product.flag_ids, [])
  assert.deepEqual(product.tax_rate_ids, [])
  assert.deepEqual(product.id_check_ids, [])
})

test('present optional Commander containers remain bounded and normalized', () => {
  const [product] = parseCommanderVpluResponse(extendedResponseXml({
    includeFlags: true,
    includeTaxRates: true,
    includeIdChecks: true,
  }))
  assert.deepEqual(product.flag_ids, ['7'])
  assert.deepEqual(product.tax_rate_ids, ['2'])
  assert.deepEqual(product.id_check_ids, ['3'])
})

test('partial V2 core fails closed rather than becoming an ambiguous legacy product', () => {
  for (const field of ['pcode', 'SellUnit', 'maxQtyPerTrans', 'taxableRebate']) {
    assert.throws(
      () => parseCommanderVpluResponse(extendedResponseXml({ omitCore: field })),
      /vplu_response_invalid/,
    )
  }
})
