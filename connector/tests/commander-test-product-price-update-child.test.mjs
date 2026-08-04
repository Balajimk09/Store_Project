import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CONTROLLED_PRODUCT,
  runTestProductPriceUpdateChild,
  validateChildInput,
} from '../research/commander-test-product-price-update-child.mjs'

function product(price = '0.02', overrides = {}) {
  return {
    upc: CONTROLLED_PRODUCT.upc,
    modifier: CONTROLLED_PRODUCT.modifier,
    description: CONTROLLED_PRODUCT.description,
    retail_price: price,
    ...overrides,
  }
}

function dependencies({
  initial = product('0.02'),
  readback = product('0.03'),
  writeStatus = 'success',
  throwWrite = false,
} = {}) {
  const calls = []
  let reads = 0
  return {
    calls,
    deps: {
      loadConfig: async () => ({ commander_ip: 'commander.fixture' }),
      resolveTrust: async () => ({
        caBundle: Buffer.from('fixture-ca'),
        serverName: 'commander.fixture',
        peerSha256: 'A'.repeat(64),
      }),
      readProduct: async (input) => {
        calls.push({ type: 'read', input })
        reads += 1
        return {
          status: 'success',
          product: reads === 1 ? initial : readback,
        }
      },
      writeProduct: async (input) => {
        calls.push({ type: 'write', input })
        if (throwWrite) throw new Error('timeout')
        return { status: writeStatus }
      },
      now: () => new Date('2026-08-03T22:00:00.000Z'),
    },
  }
}

test('stdin contract accepts only a bounded session cookie', () => {
  assert.equal(validateChildInput({ session_cookie: 'fixture-cookie' }), 'fixture-cookie')
  assert.throws(() => validateChildInput({ session_cookie: 'x', requested_price: '0.03' }), /invalid_input/)
  assert.throws(() => validateChildInput({ session_cookie: 'x&y' }), /invalid_input/)
  assert.throws(() => validateChildInput({ session_cookie: 'x'.repeat(4097) }), /invalid_input/)
})

test('success performs exactly vPLUs, uPLUs, vPLUs for only the controlled product', async () => {
  const { calls, deps } = dependencies()
  const result = await runTestProductPriceUpdateChild(
    { session_cookie: 'fixture-cookie' },
    '0.02',
    '0.03',
    deps,
  )

  assert.deepEqual(
    calls.map((entry) => entry.type),
    ['read', 'write', 'read'],
  )
  assert.equal(calls[0].input.upc, '00999999999993')
  assert.equal(calls[0].input.modifier, '000')
  assert.equal(calls[2].input.upc, '00999999999993')
  assert.equal(calls[1].input.command.command_type, 'update_price')
  assert.deepEqual(
    calls[1].input.command.requested_changes,
    { retail_price: '0.03' },
  )
  assert.deepEqual(
    calls[1].input.command.expected_current,
    { retail_price: '0.02' },
  )
  assert.equal(result.ok, true)
  assert.equal(result.write_attempted, true)
  assert.equal(result.write_succeeded, true)
  assert.equal(result.readback_matched, true)
  assert.equal(result.observed_readback_price, '0.03')
  assert.equal(JSON.stringify(result).includes('fixture-cookie'), false)
  assert.equal(JSON.stringify(result).includes('<domain:'), false)
})

test('current-price conflict blocks uPLUs completely', async () => {
  const { calls, deps } = dependencies({ initial: product('0.04') })
  const result = await runTestProductPriceUpdateChild(
    { session_cookie: 'fixture-cookie' },
    '0.02',
    '0.03',
    deps,
  )
  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'current_price_conflict')
  assert.equal(result.write_attempted, false)
  assert.deepEqual(calls.map((entry) => entry.type), ['read'])
})

test('identity or description mismatch blocks uPLUs completely', async () => {
  for (const initial of [
    product('0.02', { upc: '00000000000017' }),
    product('0.02', { description: 'NOT THE CONTROLLED PRODUCT' }),
  ]) {
    const { calls, deps } = dependencies({ initial })
    const result = await runTestProductPriceUpdateChild(
      { session_cookie: 'fixture-cookie' },
      '0.02',
      '0.03',
      deps,
    )
    assert.equal(result.ok, false)
    assert.equal(result.write_attempted, false)
    assert.deepEqual(calls.map((entry) => entry.type), ['read'])
  }
})

test('same requested price is rejected before configuration, trust, or HTTPS work', async () => {
  let touched = false
  const result = await runTestProductPriceUpdateChild(
    { session_cookie: 'fixture-cookie' },
    '0.02',
    '0.02',
    { loadConfig: async () => { touched = true } },
  )
  assert.equal(result.error_code, 'requested_price_unchanged')
  assert.equal(result.write_attempted, false)
  assert.equal(touched, false)
})

test('every attempted write is followed by readback, including uncertain writes', async () => {
  const { calls, deps } = dependencies({ throwWrite: true, readback: product('0.03') })
  const result = await runTestProductPriceUpdateChild(
    { session_cookie: 'fixture-cookie' },
    '0.02',
    '0.03',
    deps,
  )
  assert.deepEqual(calls.map((entry) => entry.type), ['read', 'write', 'read'])
  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'write_outcome_unknown')
  assert.equal(result.readback_attempted, true)
  assert.equal(result.readback_matched, true)
})

test('known write success fails safely when mandatory readback does not match', async () => {
  const { calls, deps } = dependencies({ readback: product('0.02') })
  const result = await runTestProductPriceUpdateChild(
    { session_cookie: 'fixture-cookie' },
    '0.02',
    '0.03',
    deps,
  )
  assert.deepEqual(calls.map((entry) => entry.type), ['read', 'write', 'read'])
  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'readback_mismatch')
  assert.equal(result.write_succeeded, true)
  assert.equal(result.readback_matched, false)
})

test('invalid prices never reach configuration or HTTPS dependencies', async () => {
  for (const invalid of ['-1', '1.234', 'NaN', '1000000.00']) {
    let touched = false
    const result = await runTestProductPriceUpdateChild(
      { session_cookie: 'fixture-cookie' },
      '0.02',
      invalid,
      { loadConfig: async () => { touched = true } },
    )
    assert.equal(result.ok, false)
    assert.equal(result.error_code, 'invalid_input')
    assert.equal(touched, false)
  }
})
