import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { assertCommanderPriceAdapter, createCommanderPriceAdapter, createMockCommanderPriceAdapter } from '../lib/commander-price-adapter.mjs'
import { CommanderPriceAdapterError } from '../lib/pos-publish-errors.mjs'

test('Commander price adapter requires both injected operations', () => {
  assert.throws(() => assertCommanderPriceAdapter({}), CommanderPriceAdapterError)
  assert.throws(() => assertCommanderPriceAdapter({ updatePrice: async () => {} }), CommanderPriceAdapterError)
})

test('mock Commander adapter invokes injected operations without network behavior', async () => {
  const calls = []
  const adapter = createMockCommanderPriceAdapter({
    updatePrice: async (value) => calls.push(['update', value]),
    readProduct: async (value) => {
      calls.push(['read', value])
      return { upc: value.upc, modifier: value.modifier, price: '1.00' }
    },
  })
  await adapter.updatePrice({ upc: '00012345678901', modifier: '000', price: '1.00' })
  assert.deepEqual(await adapter.readProduct({ upc: '00012345678901', modifier: '000' }), { upc: '00012345678901', modifier: '000', price: '1.00' })
  assert.deepEqual(calls, [
    ['update', { upc: '00012345678901', modifier: '000', price: '1.00' }],
    ['read', { upc: '00012345678901', modifier: '000' }],
  ])
})

test('adapter normalizes an unexpected injected error to a typed safe error', async () => {
  const adapter = createMockCommanderPriceAdapter({
    updatePrice: async () => { throw new Error('token=not-safe-to-return') },
    readProduct: async () => ({ upc: '00012345678901', modifier: '000', price: '1.00' }),
  })
  await assert.rejects(adapter.updatePrice({ upc: '00012345678901', modifier: '000', price: '1.00' }), (error) => {
    assert.equal(error instanceof CommanderPriceAdapterError, true)
    assert.equal(String(error).includes('token='), false)
    return error.code === 'malformed_response'
  })
})

test('production adapter accepts an exact Commander identity and forwards one guarded update_price write', async () => {
  const reads = []
  const writes = []
  const product = {
    upc: '00999999999993',
    modifier: '000',
    description: 'STOREPULSE TEST',
    retail_price: '0.03',
  }
  const adapter = createCommanderPriceAdapter({
    origin: 'https://commander.fixture',
    sessionCookie: 'fixture-cookie',
    trust: { caBundle: Buffer.from('fixture'), serverName: 'commander.fixture', peerSha256: 'A'.repeat(64) },
    readCommanderProductImpl: async (input) => { reads.push(input); return { status: 'success', product } },
    sendSupportedProductWriteImpl: async (input) => { writes.push(input); return { status: 'success' } },
  })

  assert.deepEqual(await adapter.updatePrice({
    upc: '00999999999993', modifier: '000', expectedPrice: '0.03', price: '0.04',
  }), { idempotent: false })
  assert.equal(reads.length, 1)
  assert.equal(reads[0].upc, '00999999999993')
  assert.equal(reads[0].modifier, '000')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].command.command_type, 'update_price')
  assert.deepEqual(writes[0].command.expected_current, { retail_price: '0.03' })
  assert.deepEqual(writes[0].command.requested_changes, { retail_price: '0.04' })
  assert.equal(writes[0].product, product)
})

test('production price adapter defaults to the exact-product selector and does not import paged lookup', async () => {
  const source = await readFile(new URL('../lib/commander-price-adapter.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /commander-vplu-paged-product-reader\.mjs/)
  assert.doesNotMatch(source, /readCommanderProductFromPagedCatalog/)
  assert.match(source, /readCommanderProduct,\s*\n?\s*sendSupportedProductWrite/u)
  assert.match(source, /readCommanderProductImpl\s*=\s*readCommanderProduct/)
  assert.doesNotMatch(source, /buildCommanderVpluSelectXml/)
})

test('production adapter resolves each claimed UPC and modifier dynamically', async () => {
  const observed = []
  const writes = []
  const adapter = createCommanderPriceAdapter({
    origin: 'https://commander.fixture',
    sessionCookie: 'fixture-cookie',
    trust: {},
    readCommanderProductImpl: async ({ upc, modifier }) => ({
      status: 'success',
      product: { upc, modifier, description: 'FIXTURE PRODUCT', retail_price: '1.00' },
    }),
    sendSupportedProductWriteImpl: async (input) => { writes.push(input); return { status: 'success' } },
  })

  for (const identity of [
    { upc: '00719499005136', modifier: '000', price: '1.01' },
    { upc: '00619682994257', modifier: '000', price: '1.02' },
  ]) {
    observed.push(await adapter.updatePrice({
      upc: identity.upc,
      modifier: identity.modifier,
      expectedPrice: '1.00',
      price: identity.price,
    }))
  }

  assert.deepEqual(observed, [{ idempotent: false }, { idempotent: false }])
  assert.deepEqual(writes.map(({ product }) => ({ upc: product.upc, modifier: product.modifier })), [
    { upc: '00719499005136', modifier: '000' },
    { upc: '00619682994257', modifier: '000' },
  ])
})

test('production adapter blocks stale expected prices before uPLUs', async () => {
  let writes = 0
  const adapter = createCommanderPriceAdapter({
    origin: 'https://commander.fixture',
    sessionCookie: 'fixture-cookie',
    trust: {},
    readCommanderProductImpl: async () => ({
      status: 'success',
      product: { upc: '00719499005136', modifier: '000', description: 'FIXTURE PRODUCT', retail_price: '0.05' },
    }),
    sendSupportedProductWriteImpl: async () => { writes += 1; return { status: 'success' } },
  })
  await assert.rejects(
    adapter.updatePrice({ upc: '00719499005136', modifier: '000', expectedPrice: '0.03', price: '0.04' }),
    (error) => error instanceof CommanderPriceAdapterError && error.code === 'price_conflict',
  )
  assert.equal(writes, 0)
})

test('production adapter blocks stale expected prices before uPLUs', async () => {
  let writes = 0
  const adapter = createCommanderPriceAdapter({
    origin: 'https://commander.fixture',
    sessionCookie: 'fixture-cookie',
    trust: {},
    readCommanderProductImpl: async () => ({
      status: 'success',
      product: { upc: '00999999999993', modifier: '000', description: 'STOREPULSE TEST', retail_price: '0.05' },
    }),
    sendSupportedProductWriteImpl: async () => { writes += 1; return { status: 'success' } },
  })
  await assert.rejects(
    adapter.updatePrice({ upc: '00999999999993', modifier: '000', expectedPrice: '0.03', price: '0.04' }),
    (error) => error instanceof CommanderPriceAdapterError && error.code === 'price_conflict',
  )
  assert.equal(writes, 0)
})

test('production adapter treats an already-applied requested price as idempotent without another write', async () => {
  let writes = 0
  const adapter = createCommanderPriceAdapter({
    origin: 'https://commander.fixture', sessionCookie: 'fixture-cookie', trust: {},
    readCommanderProductImpl: async () => ({
      status: 'success',
      product: { upc: '00999999999993', modifier: '000', description: 'STOREPULSE TEST', retail_price: '0.04' },
    }),
    sendSupportedProductWriteImpl: async () => { writes += 1; return { status: 'success' } },
  })
  assert.deepEqual(await adapter.updatePrice({ upc: '00999999999993', modifier: '000', expectedPrice: '0.03', price: '0.04' }), { idempotent: true })
  assert.equal(writes, 0)
})

test('production adapter rejects malformed identities and validates returned UPC and modifier', async () => {
  let reads = 0
  const adapter = createCommanderPriceAdapter({
    origin: 'https://commander.fixture', sessionCookie: 'fixture-cookie', trust: {},
    readCommanderProductImpl: async () => { reads += 1; return {
      status: 'success',
      product: { upc: '00999999999993', modifier: '001', description: 'SAFE DESCRIPTION', retail_price: '0.03' },
    } },
    sendSupportedProductWriteImpl: async () => ({ status: 'success' }),
  })
  await assert.rejects(
    adapter.updatePrice({ upc: '00000000000017', modifier: '00', expectedPrice: '0.03', price: '0.04' }),
    (error) => error instanceof CommanderPriceAdapterError && error.code === 'identity_mismatch',
  )
  assert.equal(reads, 0)
  await assert.rejects(
    adapter.readProduct({ upc: '00999999999993', modifier: '000' }),
    (error) => error instanceof CommanderPriceAdapterError && error.code === 'identity_mismatch',
  )
  assert.equal(reads, 1)
})
