import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildCreateProductXml,
  buildProductWriteXml,
  executeProductCommand,
  sendSupportedProductWrite,
  validateFutureProductQueueCommand,
} from '../lib/commander/commander-product-integration.mjs'

const SOURCE_PATH = new URL(
  '../lib/commander/commander-product-integration.mjs',
  import.meta.url,
)

function createInput(overrides = {}) {
  return {
    upc: '00000000000017',
    modifier: '003',
    description: 'Created & <verified>',
    price: '2.49',
    sellUnit: '2.000',
    departmentSysId: '25',
    maxQtyPerTrans: '4.00',
    pcode: '8',
    idCheckSysIds: ['13', '11'],
    taxRateSysIds: ['23', '21'],
    flagSysIds: ['33', '31'],
    taxableRebateAmount: '0.25',
    ...overrides,
  }
}

function createCommand(input = createInput(), overrides = {}) {
  const identity = { upc: input.upc, modifier: input.modifier }

  return {
    command_id: 'create-product-test',
    command_type: 'create_product',
    source_product_key: `upc:${input.upc}|modifier:${input.modifier}`,
    identity,
    expected_current: null,
    requested_changes: {
      description: input.description,
      retail_price: input.price,
      department_number: input.departmentSysId,
      payment_product_code: input.pcode,
      selling_unit: input.sellUnit,
      maximum_quantity_per_transaction: input.maxQtyPerTrans,
      taxable_rebate: input.taxableRebateAmount,
      tax_rate_ids: input.taxRateSysIds,
      id_check_ids: input.idCheckSysIds,
      flag_ids: input.flagSysIds,
    },
    approval: null,
    created_at: '2026-08-19T00:00:00.000Z',
    idempotency_key: 'create-product-test-key',
    ...overrides,
  }
}

function productFromInput(input, overrides = {}) {
  return {
    upc: input.upc,
    modifier: input.modifier,
    description: input.description,
    retail_price: input.price,
    department_number: input.departmentSysId,
    payment_product_code: input.pcode,
    selling_unit: input.sellUnit,
    maximum_quantity_per_transaction: input.maxQtyPerTrans,
    taxable_rebate: input.taxableRebateAmount,
    tax_rate_ids: input.taxRateSysIds,
    id_check_ids: input.idCheckSysIds,
    flag_ids: input.flagSysIds,
    ...overrides,
  }
}

test('buildCreateProductXml emits only the proven simple-create shape in native child order', () => {
  const input = createInput()
  const xml = buildCreateProductXml(input)

  assert.match(
    xml,
    /^<domain:PLUs xmlns:domain="urn:vfi-sapphire:np\.domain\.2001-07-01" xmlns:vs="urn:vfi-sapphire:vs\.2001-10-01" page="1" ofPages="1"><domain:PLU>/,
  )
  assert.equal(xml.includes('<fees>'), false)
  assert.equal(xml.includes('Blue'), false)
  assert.equal(xml.includes('Group'), false)
  assert.equal(xml.includes('Sequence'), false)
  assert.match(xml, /<upc>00000000000017<\/upc>/)
  assert.match(xml, /<upcModifier>003<\/upcModifier>/)
  assert.match(xml, /<description>Created &amp; &lt;verified&gt;<\/description>/)

  const childNames = [
    'upc',
    'upcModifier',
    'description',
    'price',
    'SellUnit',
    'department',
    'maxQtyPerTrans',
    'pcode',
    'idChecks',
    'taxRates',
    'flags',
    'taxableRebate',
  ]

  const offsets = childNames.map(name => xml.indexOf(`<${name}>`))
  assert.equal(offsets.every((offset, index) => (
    offset >= 0 && (index === 0 || offset > offsets[index - 1])
  )), true)
  assert.match(xml, /<department>25<\/department>/)
  assert.match(xml, /<pcode>8<\/pcode>/)
  assert.match(xml, /<domain:idCheck sysid="13"\/>/)
  assert.match(xml, /<domain:taxRate sysid="23"\/>/)
  assert.match(xml, /<domain:flag sysid="33"\/>/)
})

test('create input is strict, bounded, and has no global native-capture defaults', async () => {
  const invalidInputs = [
    createInput({ upc: '0000000000017' }),
    createInput({ modifier: '03' }),
    createInput({ price: '2.4' }),
    createInput({ sellUnit: '2.00' }),
    createInput({ maxQtyPerTrans: '4.0' }),
    createInput({ taxableRebateAmount: '0.2' }),
    createInput({ description: '' }),
    createInput({ departmentSysId: 'dept' }),
    createInput({ pcode: 'product-code' }),
    createInput({ idCheckSysIds: [] }),
    createInput({ taxRateSysIds: [] }),
    createInput({ flagSysIds: [] }),
  ]

  for (const input of invalidInputs) {
    assert.throws(() => buildCreateProductXml(input), /validation_failed/)
  }

  const deduplicated = buildCreateProductXml(createInput({
    taxRateSysIds: ['23', '21', '23'],
    idCheckSysIds: ['13', '11', '13'],
    flagSysIds: ['33', '31', '33'],
  }))
  assert.equal((deduplicated.match(/sysid="23"/g) || []).length, 1)
  assert.equal((deduplicated.match(/sysid="13"/g) || []).length, 1)
  assert.equal((deduplicated.match(/sysid="33"/g) || []).length, 1)

  const source = await readFile(SOURCE_PATH, 'utf8')
  assert.equal(source.includes('00000000099999'), false)
  assert.equal(source.includes("['5', '1']"), false)
})

test('create command writes exactly once only after its exact identity is absent and verifies every requested field', async () => {
  const input = createInput()
  const command = createCommand(input)
  const writes = []
  let reads = 0

  const result = await executeProductCommand({
    command,
    sessionProvider: async () => ({ opaque: true }),
    readProduct: async () => {
      reads += 1
      return reads === 1
        ? null
        : productFromInput(input, {
            tax_rate_ids: [...input.taxRateSysIds].reverse(),
            id_check_ids: [...input.idCheckSysIds].reverse(),
            flag_ids: [...input.flagSysIds].reverse(),
            fees: ['0'],
          })
    },
    writeProduct: async write => {
      writes.push(write)
      return { ok: true }
    },
  })

  assert.deepEqual(result, { status: 'success', idempotent: false })
  assert.equal(reads, 2)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].command, 'uPLUs')
  assert.match(writes[0].xml, /<upc>00000000000017<\/upc>/)
})

test('create readback retries transient propagation without a second uPLUs write', async () => {
  const input = createInput()
  const waits = []
  let reads = 0
  let writes = 0
  const result = await executeProductCommand({
    command: createCommand(input, { idempotency_key: 'create-readback-retry' }),
    sessionProvider: async () => ({ opaque: true }),
    readProduct: async () => {
      reads += 1
      if (reads === 1) return null
      if (reads === 2) throw new Error('Commander propagation pending')
      return productFromInput(input)
    },
    writeProduct: async () => { writes += 1; return { ok: true } },
    waitForCreateReadback: async (delayMs) => { waits.push(delayMs) },
  })

  assert.deepEqual(result, { status: 'success', idempotent: false })
  assert.equal(reads, 3)
  assert.equal(writes, 1)
  assert.deepEqual(waits, [250])
})

test('existing identity, failed writes, and invalid Commander responses fail closed without retries', async () => {
  const input = createInput()
  const command = createCommand(input)
  let writes = 0

  assert.deepEqual(
    await executeProductCommand({
      command,
      sessionProvider: async () => ({ opaque: true }),
      readProduct: async () => productFromInput(input),
      writeProduct: async () => { writes += 1; return { ok: true } },
    }),
    { status: 'product_already_exists' },
  )
  assert.equal(writes, 0)

  let successfulWrites = 0
  const successfulWrite = await sendSupportedProductWrite({
    origin: 'https://commander.fixture',
    sessionCookie: 'fixture-cookie',
    command,
    product: null,
    transport: async request => {
      successfulWrites += 1
      assert.equal(request.body.startsWith('cmd=uPLUs&'), true)
      return {
        status: 200,
        body: '<VFI:Response xmlns:VFI="urn:vfi-sapphire:np.domain.2001-07-01"/>',
      }
    },
  })
  assert.deepEqual(successfulWrite, { status: 'success' })
  assert.equal(successfulWrites, 1)

  for (const body of [
    '<VFI:Response xmlns:VFI="urn:vfi-sapphire:np.domain.2001-07-01"><VFI:Fault/></VFI:Response>',
    '<VFI:Response',
  ]) {
    const outcome = await sendSupportedProductWrite({
      origin: 'https://commander.fixture',
      sessionCookie: 'fixture-cookie',
      command,
      product: null,
      transport: async () => ({ status: 200, body }),
    })
    assert.deepEqual(outcome, { status: 'write_failed' })
  }
})

test('post-create absence or any requested-field mismatch fails verification', async () => {
  const input = createInput()
  const command = createCommand(input)
  const cases = [
    null,
    productFromInput(input, { description: 'different' }),
    productFromInput(input, { retail_price: '9.99' }),
    productFromInput(input, { department_number: '26' }),
    productFromInput(input, { payment_product_code: '9' }),
    productFromInput(input, { selling_unit: '1.000' }),
    productFromInput(input, { maximum_quantity_per_transaction: '0.00' }),
    productFromInput(input, { taxable_rebate: '0.00' }),
    productFromInput(input, { tax_rate_ids: ['99'] }),
    productFromInput(input, { id_check_ids: ['99'] }),
    productFromInput(input, { flag_ids: ['99'] }),
    productFromInput(input, { upc: '00000000000018' }),
    productFromInput(input, { modifier: '004' }),
  ]

  for (const readback of cases) {
    let reads = 0
    let writes = 0
    const result = await executeProductCommand({
      command: createCommand(input, {
        idempotency_key: `verification-${cases.indexOf(readback)}`,
      }),
      sessionProvider: async () => ({ opaque: true }),
      readProduct: async () => (++reads === 1 ? null : readback),
      writeProduct: async () => { writes += 1; return { ok: true } },
      waitForCreateReadback: async () => {},
    })
    assert.deepEqual(result, { status: 'create_verification_failed' })
    assert.equal(writes, 1)
  }
})

test('the exact create-only command is supported while unknown input remains rejected', () => {
  const command = createCommand()
  const write = buildProductWriteXml(command, null)
  assert.equal(write.supported, true)
  assert.equal(write.command, 'uPLUs')
  assert.throws(() => buildProductWriteXml(createCommand(createInput(), {
    requested_changes: { description: 'incomplete' },
  }), null), /validation_failed/)
  assert.throws(() => buildProductWriteXml(createCommand(createInput(), {
    requested_changes: {
      ...command.requested_changes,
      fees: ['0'],
    },
  }), null), /validation_failed/)
  assert.deepEqual(validateFutureProductQueueCommand(command), {
    valid: true,
    executable: true,
    error_code: null,
  })
})
