import assert from 'node:assert/strict'
import test from 'node:test'

import { assertCommanderPriceAdapter, createMockCommanderPriceAdapter } from '../lib/commander-price-adapter.mjs'
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
      return { upc: value.upc, price: '1.00' }
    },
  })
  await adapter.updatePrice({ upc: '00012345678901', price: '1.00' })
  assert.deepEqual(await adapter.readProduct({ upc: '00012345678901' }), { upc: '00012345678901', price: '1.00' })
  assert.deepEqual(calls, [
    ['update', { upc: '00012345678901', price: '1.00' }],
    ['read', { upc: '00012345678901' }],
  ])
})

test('adapter normalizes an unexpected injected error to a typed safe error', async () => {
  const adapter = createMockCommanderPriceAdapter({
    updatePrice: async () => { throw new Error('token=not-safe-to-return') },
    readProduct: async () => ({ upc: '00012345678901', price: '1.00' }),
  })
  await assert.rejects(adapter.updatePrice({ upc: '00012345678901', price: '1.00' }), (error) => {
    assert.equal(error instanceof CommanderPriceAdapterError, true)
    assert.equal(String(error).includes('token='), false)
    return error.code === 'malformed_response'
  })
})
