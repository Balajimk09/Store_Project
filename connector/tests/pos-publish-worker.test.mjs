import assert from 'node:assert/strict'
import test from 'node:test'

import { createPosPublishWorker } from '../lib/pos-publish-worker.mjs'
import { CommanderPriceAdapterError } from '../lib/pos-publish-errors.mjs'

const JOB = {
  job_id: '11111111-1111-4111-8111-111111111111',
  operation: 'update_price',
  product_id: '22222222-2222-4222-8222-222222222222',
  upc: '00012345678901',
  modifier: '000',
  expected_price: '0.99',
  price: '1.00',
  attempt: 1,
  claimed_at: '2026-07-16T12:00:00.000Z',
}

const CREATE_JOB = Object.freeze({
  job_id: '33333333-3333-4333-8333-333333333333',
  operation: 'create_product',
  product_id: '44444444-4444-4444-8444-444444444444',
  upc: '00000000000017',
  modifier: '000',
  description: 'CREATE PRODUCT',
  department: '18',
  price: '1.00',
  payment_product_code: '400',
  selling_unit: '1.000',
  max_qty_per_trans: '0.00',
  taxable_rebate: '0.00',
  tax_rate_ids: ['2'],
  id_check_ids: ['1'],
  flag_ids: ['1', '5'],
  attempt: 1,
  claimed_at: '2026-08-26T12:00:00.000Z',
})

function makeWorker({ claim = async () => JOB, reportFailure, adapter = {}, logger = () => {}, guard = new Set(), now = () => 100 } = {}) {
  const events = []
  const reports = []
  const calls = { update: 0, read: 0 }
  const updateInputs = []
  const apiClient = {
    claim: async () => { events.push('claim'); return claim() },
    report: async (payload) => {
      events.push(`report:${payload.status}`)
      reports.push(payload)
      if (reportFailure?.(payload)) throw new Error('report unavailable')
      return { job_id: payload.job_id, status: payload.status }
    },
  }
  const commanderAdapter = {
    updatePrice: async (value) => { calls.update += 1; updateInputs.push(value); events.push('update'); return adapter.updatePrice?.(value) },
    readProduct: async (value) => { calls.read += 1; events.push('read'); return adapter.readProduct?.(value) ?? { upc: value.upc, modifier: value.modifier, price: '1.00' } },
  }
  return { worker: createPosPublishWorker({ apiClient, commanderAdapter, logger, now, executionGuard: guard }), events, reports, calls, updateInputs, guard }
}

function createProductDetail(overrides = {}) {
  return {
    upc: CREATE_JOB.upc,
    modifier: CREATE_JOB.modifier,
    description: CREATE_JOB.description,
    department: CREATE_JOB.department,
    price: CREATE_JOB.price,
    payment_product_code: CREATE_JOB.payment_product_code,
    selling_unit: CREATE_JOB.selling_unit,
    maximum_quantity_per_transaction: CREATE_JOB.max_qty_per_trans,
    taxable_rebate: CREATE_JOB.taxable_rebate,
    tax_rate_ids: CREATE_JOB.tax_rate_ids,
    id_check_ids: CREATE_JOB.id_check_ids,
    flag_ids: CREATE_JOB.flag_ids,
    ...overrides,
  }
}

function makeCreateWorker({ createProduct = async () => {}, readProductDetail = async () => createProductDetail(), reportFailure, sleep = async () => {}, guard = new Set() } = {}) {
  const reports = []
  const calls = { create: 0, read: 0 }
  const apiClient = {
    claim: async () => CREATE_JOB,
    report: async (payload) => {
      reports.push(payload)
      if (reportFailure?.(payload)) throw new Error('report unavailable')
      return { job_id: payload.job_id, status: payload.status }
    },
  }
  const commanderAdapter = {
    updatePrice: async () => {},
    readProduct: async () => ({ upc: CREATE_JOB.upc, modifier: CREATE_JOB.modifier, price: CREATE_JOB.price }),
    createProduct: async (input) => { calls.create += 1; return await createProduct(input) },
    readProductDetail: async (input) => { calls.read += 1; return await readProductDetail(input) },
  }
  return { worker: createPosPublishWorker({ apiClient, commanderAdapter, sleep, executionGuard: guard }), reports, calls, guard }
}

test('idle claim performs no Commander work', async () => {
  const { worker, events } = makeWorker({ claim: async () => undefined })
  assert.deepEqual(await worker.processOne(), { outcome: 'idle' })
  assert.deepEqual(events, ['claim'])
})

test('a throwing clock returns safely, releases the active guard, and permits the next cycle', async () => {
  let throwClock = true
  const fixture = makeWorker({ now: () => {
    if (throwClock) throw new Error('clock unavailable')
    return 100
  } })
  assert.deepEqual(await fixture.worker.processOne(), { outcome: 'internal_error', stage: 'clock' })
  assert.deepEqual(fixture.events, [])
  assert.deepEqual(fixture.calls, { update: 0, read: 0 })
  throwClock = false
  assert.equal((await fixture.worker.processOne()).outcome, 'completed')
  assert.equal(fixture.calls.update, 1)
})

test('valid job follows the exact safe sequence once', async () => {
  const { worker, events, calls, updateInputs } = makeWorker()
  assert.deepEqual(await worker.processOne(), { outcome: 'completed', job_id: JOB.job_id })
  assert.deepEqual(events, ['claim', 'report:sending', 'update', 'report:verifying', 'read', 'report:completed'])
  assert.deepEqual(calls, { update: 1, read: 1 })
  assert.deepEqual(updateInputs, [{ upc: JOB.upc, modifier: JOB.modifier, expectedPrice: JOB.expected_price, price: JOB.price }])
})

test('logger errors are isolated across progress, completion, and failure logging', async () => {
  const progress = makeWorker({ logger: () => { throw new Error('logger failed') } })
  assert.equal((await progress.worker.processOne()).outcome, 'completed')
  assert.deepEqual(progress.reports.map((report) => report.status), ['sending', 'verifying', 'completed'])

  const failure = makeWorker({
    logger: () => { throw new Error('logger failed') },
    adapter: { updatePrice: async () => { throw new CommanderPriceAdapterError('update_rejected', 'Update rejected.') } },
  })
  const result = await failure.worker.processOne()
  assert.equal(result.outcome, 'commander_failed')
  assert.deepEqual(failure.reports.map((report) => report.status), ['sending', 'failed'])
})

test('completed report success remains completed even if the completion logger fails', async () => {
  const { worker, reports } = makeWorker({ logger: (entry) => { if (entry.event === 'pos_publish_completed') throw new Error('logger failed') } })
  assert.equal((await worker.processOne()).outcome, 'completed')
  assert.deepEqual(reports.map((report) => report.status), ['sending', 'verifying', 'completed'])
})

test('completed report failure does not report failed, repeat update, or release lifetime protection', async () => {
  const { worker, reports, calls, guard } = makeWorker({ reportFailure: (payload) => payload.status === 'completed' })
  assert.deepEqual(await worker.processOne(), { outcome: 'status_report_failed', job_id: JOB.job_id, stage: 'completed', failure_reported: false })
  assert.deepEqual(reports.map((report) => report.status), ['sending', 'verifying', 'completed'])
  assert.equal(calls.update, 1)
  assert.equal(guard.has(JOB.job_id), true)
  assert.deepEqual(await worker.processOne(), { outcome: 'duplicate_ignored', job_id: JOB.job_id })
  assert.equal(calls.update, 1)
})

test('sending report failure performs no Commander work and does not retain the job guard', async () => {
  const guard = new Set()
  const { worker, reports, calls } = makeWorker({ guard, reportFailure: (payload) => payload.status === 'sending' })
  const result = await worker.processOne()
  assert.equal(result.outcome, 'status_report_failed')
  assert.equal(result.stage, 'sending')
  assert.equal(calls.update, 0)
  assert.equal(calls.read, 0)
  assert.equal(guard.has(JOB.job_id), false)
  assert.deepEqual(reports.map((report) => report.status), ['sending', 'failed'])
})

test('sending and failed-report failure still permits a later retry before Commander work', async () => {
  const guard = new Set()
  let first = true
  const fixture = makeWorker({ guard, reportFailure: (payload) => first && ['sending', 'failed'].includes(payload.status) })
  assert.equal((await fixture.worker.processOne()).outcome, 'status_report_failed')
  first = false
  assert.equal((await fixture.worker.processOne()).outcome, 'completed')
  assert.equal(fixture.calls.update, 1)
})

test('verifying report failure blocks readback and preserves duplicate protection', async () => {
  const { worker, calls, guard, reports } = makeWorker({ reportFailure: (payload) => payload.status === 'verifying' })
  const result = await worker.processOne()
  assert.equal(result.outcome, 'status_report_failed')
  assert.equal(result.stage, 'verifying')
  assert.equal(calls.update, 1)
  assert.equal(calls.read, 0)
  assert.equal(guard.has(JOB.job_id), true)
  assert.deepEqual(reports.map((report) => report.status), ['sending', 'verifying', 'failed'])
})

test('Commander failures map safely and remain guarded after update starts', async (t) => {
  const cases = [
    ['product_not_found', 'plu_not_found'], ['auth_failed', 'commander_auth_failed'], ['unreachable', 'commander_unreachable'],
    ['tls_failed', 'commander_tls_failed'], ['update_rejected', 'update_rejected'], ['price_conflict', 'price_conflict'], ['timeout', 'job_expired'], ['malformed_response', 'internal_connector_error'],
  ]
  for (const [kind, code] of cases) {
    await t.test(kind, async () => {
      const fixture = makeWorker({ adapter: { updatePrice: async () => { throw new CommanderPriceAdapterError(kind, 'Safe failure.') } } })
      const result = await fixture.worker.processOne()
      assert.equal(result.outcome, 'commander_failed')
      assert.equal(result.failure_code, code)
      assert.equal(fixture.guard.has(JOB.job_id), true)
      assert.deepEqual(fixture.reports.map((report) => report.status), ['sending', 'failed'])
    })
  }
})

test('malformed and mismatched readback never completes', async (t) => {
  const dangerous = JSON.parse('{"upc":"00012345678901","modifier":"000","price":"1.00","__proto__":{}}')
  const cases = [
    [null, 'internal_connector_error'], [[], 'internal_connector_error'], [{ upc: JOB.upc }, 'internal_connector_error'],
    [{ price: JOB.price }, 'internal_connector_error'], [{ upc: 'bad', modifier: JOB.modifier, price: JOB.price }, 'internal_connector_error'],
    [{ upc: JOB.upc, modifier: JOB.modifier, price: 1 }, 'internal_connector_error'], [{ upc: JOB.upc, modifier: JOB.modifier, price: JOB.price, extra: true }, 'internal_connector_error'], [dangerous, 'internal_connector_error'],
    [{ upc: '99999999999999', modifier: JOB.modifier, price: JOB.price }, 'plu_identity_mismatch'], [{ upc: JOB.upc, modifier: '001', price: JOB.price }, 'plu_identity_mismatch'], [{ upc: JOB.upc, modifier: JOB.modifier, price: '0.99' }, 'verification_failed'],
  ]
  for (const [response, code] of cases) {
    await t.test(JSON.stringify(response), async () => {
      const fixture = makeWorker({ adapter: { readProduct: async () => response } })
      const result = await fixture.worker.processOne()
      assert.equal(result.failure_code, code)
      assert.deepEqual(fixture.reports.map((report) => report.status), ['sending', 'verifying', 'failed'])
    })
  }
})

test('readback not-found error maps to plu_not_found', async () => {
  const fixture = makeWorker({ adapter: { readProduct: async () => { throw new CommanderPriceAdapterError('product_not_found', 'Not found.') } } })
  assert.equal((await fixture.worker.processOne()).failure_code, 'plu_not_found')
})

test('invalid injected claims are rejected before reports, guards, or Commander calls', async (t) => {
  const polluted = JSON.parse('{"job_id":"11111111-1111-4111-8111-111111111111","operation":"update_price","product_id":"22222222-2222-4222-8222-222222222222","upc":"00012345678901","modifier":"000","expected_price":"0.99","price":"1.00","attempt":1,"claimed_at":"2026-07-16T12:00:00Z","__proto__":{}}')
  const cases = [
    { ...JOB, job_id: 'bad' }, { ...JOB, operation: 'other' }, { ...JOB, upc: 'ABC' }, { ...JOB, upc: '1'.repeat(13) }, { ...JOB, upc: '1'.repeat(15) }, { ...JOB, upc: '1'.repeat(65) }, { ...JOB, modifier: '00' }, { ...JOB, modifier: 0 },
    { ...JOB, expected_price: '1.2' }, { ...JOB, expected_price: 1 }, { ...JOB, expected_price: JOB.price },
    { ...JOB, price: '1.2' }, { ...JOB, price: 1 }, { ...JOB, attempt: 0 }, { ...JOB, claimed_at: '2026-07-16' },
    { ...JOB, claimed_at: 'July 16, 2026' }, (() => { const value = { ...JOB }; delete value.upc; return value })(), (() => { const value = { ...JOB }; delete value.modifier; return value })(),
    (() => { const value = { ...JOB }; delete value.expected_price; return value })(), { ...JOB, extra: true },
    polluted, { ...JOB, constructor: {} }, { ...JOB, prototype: {} }, null, [], 'job', 1,
  ]
  for (const value of cases) {
    await t.test(typeof value, async () => {
      const fixture = makeWorker({ claim: async () => value })
      assert.deepEqual(await fixture.worker.processOne(), { outcome: 'invalid_claim' })
      assert.deepEqual(fixture.reports, [])
      assert.deepEqual(fixture.calls, { update: 0, read: 0 })
      assert.equal(fixture.guard.size, 0)
    })
  }
})

test('failed status reporting does not repeat Commander work or expose error contents', async () => {
  const secret = 'test-connector-token-0123456789abcdef'
  const logs = []
  const fixture = makeWorker({
    logger: (entry) => logs.push(entry),
    reportFailure: (payload) => payload.status === 'failed',
    adapter: { updatePrice: async () => { throw new CommanderPriceAdapterError('unreachable', `Bearer ${secret}`) } },
  })
  const result = await fixture.worker.processOne()
  assert.deepEqual(result, { outcome: 'commander_failed', job_id: JOB.job_id, failure_code: 'commander_unreachable', failure_reported: false })
  assert.equal(fixture.calls.update, 1)
  assert.equal(JSON.stringify(fixture.reports).includes(secret), false)
  assert.equal(JSON.stringify(logs).includes(secret), false)
})

test('create retries a delayed readback, reports the create operation, and completes with flags', async () => {
  const waits = []
  let reads = 0
  const fixture = makeCreateWorker({
    readProductDetail: async () => {
      reads += 1
      if (reads === 1) throw new CommanderPriceAdapterError('product_not_found', 'Not found.')
      return createProductDetail()
    },
    sleep: async (delayMs) => { waits.push(delayMs) },
  })

  assert.deepEqual(await fixture.worker.processOne(), { outcome: 'completed', job_id: CREATE_JOB.job_id })
  assert.equal(fixture.calls.create, 1)
  assert.equal(fixture.calls.read, 2)
  assert.deepEqual(waits, [250])
  assert.deepEqual(fixture.reports.map((report) => report.status), ['sending', 'verifying', 'completed'])
  assert.equal(fixture.reports.every((report) => report.operation === 'create_product'), true)
  assert.deepEqual(fixture.reports.at(-1).verification.flag_ids, CREATE_JOB.flag_ids)
})

test('create readback mismatch or exception after verifying reports a terminal create failure', async () => {
  const mismatch = makeCreateWorker({
    readProductDetail: async () => createProductDetail({ description: 'DIFFERENT' }),
  })
  const mismatchResult = await mismatch.worker.processOne()
  assert.equal(mismatchResult.outcome, 'commander_failed')
  assert.equal(mismatchResult.failure_code, 'verification_failed')
  assert.equal(mismatch.calls.create, 1)
  assert.deepEqual(mismatch.reports.map((report) => report.status), ['sending', 'verifying', 'failed'])
  assert.equal(mismatch.reports.every((report) => report.operation === 'create_product'), true)

  const waits = []
  const exception = makeCreateWorker({
    readProductDetail: async () => { throw new CommanderPriceAdapterError('product_not_found', 'Not found.') },
    sleep: async (delayMs) => { waits.push(delayMs) },
  })
  const exceptionResult = await exception.worker.processOne()
  assert.equal(exceptionResult.outcome, 'commander_failed')
  assert.equal(exceptionResult.failure_code, 'plu_not_found')
  assert.equal(exception.calls.create, 1)
  assert.equal(exception.calls.read, 3)
  assert.deepEqual(waits, [250, 250])
  assert.deepEqual(exception.reports.map((report) => report.status), ['sending', 'verifying', 'failed'])
  assert.equal(exception.reports.every((report) => report.operation === 'create_product'), true)
})

test('create completion-report failure attempts a terminal create failure without another write', async () => {
  const fixture = makeCreateWorker({
    reportFailure: (payload) => payload.status === 'completed',
  })
  const result = await fixture.worker.processOne()
  assert.deepEqual(result, { outcome: 'status_report_failed', job_id: CREATE_JOB.job_id, stage: 'completed', failure_reported: true })
  assert.equal(fixture.calls.create, 1)
  assert.deepEqual(fixture.reports.map((report) => report.status), ['sending', 'verifying', 'completed', 'failed'])
  assert.equal(fixture.reports.every((report) => report.operation === 'create_product'), true)
})

test('only one run is active and the in-flight guard clears after success and failure', async () => {
  let release
  const blocked = new Promise((resolve) => { release = resolve })
  const fixture = makeWorker({ adapter: { updatePrice: async () => blocked } })
  const first = fixture.worker.processOne()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(await fixture.worker.processOne(), { outcome: 'busy' })
  release()
  assert.equal((await first).outcome, 'completed')

  const failed = makeWorker({ adapter: { updatePrice: async () => { throw new CommanderPriceAdapterError('update_rejected', 'Rejected.') } }, claim: async () => undefined })
  assert.equal((await failed.worker.processOne()).outcome, 'idle')
})
