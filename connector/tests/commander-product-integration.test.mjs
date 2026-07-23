import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCommanderNaxmlBody, sendCommanderNaxml } from '../lib/commander/commander-naxml-client.mjs'
import { buildProductWriteXml, buildSourceProductKey, buildVpluReadXml, createIdempotencyStore, executeProductCommand, normalizePlu, normalizeProductIdentity, parseVpluResponse, readCommanderCatalog, readCommanderProduct, reconcileCommanderCatalog, sendSupportedProductWrite, validateFutureProductQueueCommand, validateProductCommand } from '../lib/commander/commander-product-integration.mjs'

const UPC = '012345678905'
const XML = `<domain:PLUs page="1" ofPages="1" xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01" xmlns:vs="urn:vfi-sapphire:vs.2001-10-01"><domain:PLU><upc>${UPC}</upc><upcModifier>000</upcModifier><description>STOREPULSE TEST</description><department>1</department><fees><fee>0</fee></fees><pcode>0</pcode><price>0.02</price><flags><domain:flag sysid="1"/></flags><taxRates><domain:taxRate sysid="1"/></taxRates><idChecks><domain:idCheck sysid="1"/></idChecks><SellUnit>1.000</SellUnit><taxableRebate><amount>0.00</amount></taxableRebate><maxQtyPerTrans>0.00</maxQtyPerTrans></domain:PLU></domain:PLUs>`
const identity = { plu: '00042', modifier: '000', upc: UPC }
function command(price = '0.75', key = 'k1') { return { command_id: 'command-1', command_type: 'update_price', source_product_key: buildSourceProductKey(identity), identity, expected_current: { retail_price: '0.02' }, requested_changes: { retail_price: price }, approval: null, created_at: '2026-07-17T00:00:00.000Z', idempotency_key: key } }

test('NAXML framing is exact, encoded, bounded, and does not expose the cookie in errors', async () => {
  const cookie = 'cookie token'
  assert.equal(buildCommanderNaxmlBody({ command: 'vPLUs', sessionCookie: cookie, xml: '<x/>' }), `cmd=vPLUs&cookie=${encodeURIComponent(cookie)}\r\n\r\n<x/>`)
  await assert.rejects(() => sendCommanderNaxml({ origin: 'http://bad', request: { command: 'vPLUs', sessionCookie: cookie, xml: '<x/>' }, transport: async () => ({}) }), error => !error.message.includes(cookie))
})

test('the reusable NAXML client uses an injected offline transport with fixed path and bounded result', async () => {
  let call
  const response = await sendCommanderNaxml({ origin: 'https://commander.fixture', request: { command: 'vPLUs', sessionCookie: 'fixture-cookie', xml: '<test/>' }, transport: async input => { call = input; return { status: 200, body: '<ok/>' } } })
  assert.deepEqual(response, { status: 200, body: '<ok/>' })
  assert.equal(call.url, 'https://commander.fixture/cgi-bin/NAXML?')
  assert.equal(call.options.rejectUnauthorized, true)
  await assert.rejects(() => sendCommanderNaxml({ origin: 'https://commander.fixture', request: { command: 'vPLUs', sessionCookie: 'fixture-cookie', xml: '<test/>' }, transport: async () => ({ status: 200, body: 'x'.repeat(1024 * 1024 + 1) }) }), /transport_failed/)
})

test('identity preserves leading zeroes, modifiers, and never treats UPC as globally unique', () => {
  assert.equal(buildSourceProductKey(identity), 'plu:00042|modifier:000')
  assert.notEqual(buildSourceProductKey({ ...identity, modifier: '001' }), buildSourceProductKey(identity))
  assert.equal(normalizeProductIdentity({ upc: UPC, modifier: '000' }).source_product_key, `upc:${UPC}|modifier:000`)
  assert.notEqual(normalizeProductIdentity({ plu: '00043', modifier: '000', upc: UPC }).source_product_key, buildSourceProductKey(identity))
  assert.equal(normalizePlu('e\u0301'), 'é')
  assert.throws(() => normalizeProductIdentity({ plu: 'x\n', upc: UPC }), /validation_failed/)
})

test('parses only the historically evidenced vPLUs shape and preserves no raw payload', () => {
  const [product] = parseVpluResponse(XML)
  assert.equal(product.upc, UPC); assert.equal(product.retail_price, '0.02'); assert.equal(product.department_number, '1')
  assert.equal(product.identity_provisional, true)
  assert.equal(Object.hasOwn(product, 'raw_xml'), false)
  assert.equal(buildVpluReadXml({ upc: UPC }).includes(`<upc source="keyboard">${UPC}</upc>`), true)
  assert.deepEqual(buildProductWriteXml(command(), product).supported, true)
  assert.match(buildProductWriteXml(command(), product).xml, /<price>0.75<\/price>/)
  assert.equal(buildProductWriteXml({ ...command(), command_type: 'create_product', requested_changes: {} }, product).error_code, 'create_product_schema_unverified')
})

test('rejects duplicate identities and unverified pagination is explicit', () => {
  assert.throws(() => parseVpluResponse(XML.replace('</domain:PLUs>', XML.match(/<domain:PLU>[\s\S]*<\/domain:PLU>/)[0] + '</domain:PLUs>')), /duplicate_product_identity/)
  assert.throws(() => validateProductCommand({ ...command(), requested_changes: { retail_price: '-1' } }), /validation_failed/)
  assert.throws(() => validateProductCommand({ ...command(), approval: { raw_xml: '<uPLUs/>' } }), /validation_failed/)
  assert.throws(() => validateProductCommand({ ...command(), expected_current: { raw_xml: '<uPLUs/>' } }), /validation_failed/)
})

test('single-product reads and writes use only fixture transport; catalog reads remain schema-blocked', async () => {
  const calls = []
  const transport = async input => { calls.push(input); return { status: 200, body: XML } }
  const read = await readCommanderProduct({ origin: 'https://commander.fixture', sessionCookie: 'fixture-cookie', upc: UPC, transport })
  assert.equal(read.status, 'success'); assert.equal(calls.length, 1); assert.equal(calls[0].body.startsWith('cmd=vPLUs&cookie='), true)
  assert.deepEqual(await readCommanderCatalog(), { status: 'unsupported_operation', error_code: 'pagination_schema_unverified' })
  const product = { ...read.product, ...normalizeProductIdentity(identity) }
  const write = await sendSupportedProductWrite({ origin: 'https://commander.fixture', sessionCookie: 'fixture-cookie', command: command(), product, transport: async input => ({ status: 200, body: '<VFI:Response xmlns:VFI="urn:vfi-sapphire:np.domain.2001-07-01"/>' }) })
  assert.deepEqual(write, { status: 'success' })
  assert.deepEqual(await sendSupportedProductWrite({ origin: 'https://commander.fixture', sessionCookie: 'fixture-cookie', command: { ...command(), command_type: 'delete_product', requested_changes: {} }, product, transport }), { status: 'unsupported_operation', error_code: 'permanent_delete_not_supported' })
})

test('offline write workflow reads before writing, readbacks every write, detects conflicts and idempotency', async () => {
  const product = { ...parseVpluResponse(XML)[0], ...normalizeProductIdentity(identity) }
  let reads = 0; let writes = 0; let state = product
  const store = createIdempotencyStore()
  const dependencies = {
    sessionProvider: async () => ({ opaque: true }),
    readProduct: async () => { reads++; return state },
    writeProduct: async ({ xml }) => { writes++; state = { ...state, retail_price: /<price>0.75<\/price>/.test(xml) ? '0.75' : state.retail_price }; return { ok: true } },
  }
  const first = await executeProductCommand({ command: command(), ...dependencies, idempotencyStore: store })
  assert.deepEqual(first, { status: 'success', idempotent: false }); assert.equal(reads, 2); assert.equal(writes, 1)
  assert.deepEqual(await executeProductCommand({ command: command(), ...dependencies, idempotencyStore: store }), first); assert.equal(writes, 1)
  assert.deepEqual(await executeProductCommand({ command: command('0.74'), ...dependencies, idempotencyStore: store }), { status: 'validation_failed', error_code: 'idempotency_key_conflict' })
  assert.deepEqual(await executeProductCommand({ command: { ...command('0.74', 'k2'), expected_current: { retail_price: '0.01' } }, ...dependencies }), { status: 'product_conflict' })
  assert.deepEqual(await executeProductCommand({ command: command('0.74', 'k3'), sessionProvider: async () => ({}), readProduct: async () => ({ ...product }), writeProduct: async () => { throw new Error('timeout') } }), { status: 'write_outcome_unknown' })
  assert.deepEqual(await executeProductCommand({ command: command('0.74', 'k4'), sessionProvider: async () => ({}), readProduct: (() => { let pass = 0; return async () => (++pass === 1 ? product : { ...product, retail_price: '0.02' }) })(), writeProduct: async () => ({ ok: true }) }), { status: 'readback_mismatch' })
})

test('reconciliation never proposes deactivation for a partial catalog and queue commands remain disabled', () => {
  const c = { ...normalizeProductIdentity(identity), raw_payload_hash: 'a' }
  const s = { source_product_key: c.source_product_key, pos_payload_hash: 'b' }
  assert.equal(reconcileCommanderCatalog({ commanderProducts: [], storePulseProducts: [s], completeCatalog: false }).proposed_deactivations.length, 0)
  assert.equal(reconcileCommanderCatalog({ commanderProducts: [], storePulseProducts: [s], completeCatalog: true }).proposed_deactivations.length, 1)
  assert.deepEqual(validateFutureProductQueueCommand({ command_type: 'create_product' }), { valid: true, executable: false, error_code: 'product_queue_execution_disabled' })
})

test('verified trust is forwarded through single-product read and write transports', async () => {
  const trust = {
    caBundle: Buffer.from('fixture-ca'),
    serverName: 'commander.fixture',
    peerSha256: 'A'.repeat(64),
  }

  let readCall = null

  const read = await readCommanderProduct({
    origin: 'https://commander.fixture',
    sessionCookie: 'fixture-cookie',
    trust,
    upc: UPC,
    modifier: '000',
    transport: async input => {
      readCall = input
      return { status: 200, body: XML }
    },
  })

  assert.equal(read.status, 'success')
  assert.equal(readCall.options.rejectUnauthorized, true)
  assert.equal(readCall.options.servername, 'commander.fixture')

  const product = {
    ...read.product,
    ...normalizeProductIdentity(identity),
  }

  let writeCall = null

  const write = await sendSupportedProductWrite({
    origin: 'https://commander.fixture',
    sessionCookie: 'fixture-cookie',
    trust,
    command: command(),
    product,
    transport: async input => {
      writeCall = input

      return {
        status: 200,
        body: '<VFI:Response xmlns:VFI="urn:vfi-sapphire:np.domain.2001-07-01"/>',
      }
    },
  })

  assert.deepEqual(write, { status: 'success' })
  assert.equal(writeCall.options.rejectUnauthorized, true)
  assert.equal(writeCall.options.servername, 'commander.fixture')
})
