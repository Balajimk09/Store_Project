import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProductWriteXml,
  parseVpluResponse,
} from '../lib/commander/commander-product-integration.mjs'
import { createCommanderPriceAdapter } from '../lib/commander-price-adapter.mjs'
import {
  createPosPublishApiClient,
  validateClaimResponse,
  validateReportPayload,
} from '../lib/pos-publish-api-client.mjs'
import { createPosPublishWorker } from '../lib/pos-publish-worker.mjs'

const UPC = '00810195100184'
const MODIFIER = '000'
const JOB_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'test-connector-token-0123456789abcdef'
const XML = `<domain:PLUs page="1" ofPages="1" xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01" xmlns:vs="urn:vfi-sapphire:vs.2001-10-01"><domain:PLU><upc>${UPC}</upc><upcModifier>${MODIFIER}</upcModifier><description>OPIA ULTRA 60MG $49.99</description><department>24</department><fees><fee>0</fee></fees><pcode>0</pcode><price>20.99</price><flags><domain:flag sysid="1"/></flags><taxRates><domain:taxRate sysid="2"/></taxRates><idChecks><domain:idCheck sysid="2"/></idChecks><SellUnit>1.000</SellUnit><taxableRebate><amount>0.00</amount></taxableRebate><maxQtyPerTrans>0.00</maxQtyPerTrans></domain:PLU></domain:PLUs>`

function command() {
  return {
    command_id: 'product-test',
    command_type: 'update_product',
    source_product_key: `upc:${UPC}|modifier:${MODIFIER}`,
    identity: { upc: UPC, modifier: MODIFIER },
    expected_current: {
      description: 'OPIA ULTRA 60MG $49.99',
      department_number: '24',
      retail_price: '20.99',
    },
    requested_changes: {
      description: 'OPIA ULTRA 60MG $21.99',
      department_number: '9',
      retail_price: '21.99',
    },
    approval: null,
    created_at: '2026-08-14T16:00:00Z',
    idempotency_key: 'product-test-key',
  }
}

function productJob() {
  return {
    job_id: JOB_ID,
    operation: 'update_product',
    product_id: PRODUCT_ID,
    upc: UPC,
    modifier: MODIFIER,
    expected_description: 'OPIA ULTRA 60MG $49.99',
    description: 'OPIA ULTRA 60MG $21.99',
    expected_department: '24',
    department: '9',
    expected_price: '20.99',
    price: '21.99',
    attempt: 1,
    claimed_at: '2026-08-14T16:00:00Z',
  }
}

test('update_product changes only description, department, and price inside one template-preserving uPLUs', () => {
  const [product] = parseVpluResponse(XML)
  const write = buildProductWriteXml(command(), product)

  assert.equal(write.supported, true)
  assert.equal(write.command, 'uPLUs')
  assert.match(write.xml, /<description>OPIA ULTRA 60MG \$21\.99<\/description>/)
  assert.match(write.xml, /<department>9<\/department>/)
  assert.match(write.xml, /<price>21\.99<\/price>/)
  for (const preserved of [
    '<pcode>0</pcode>',
    '<SellUnit>1.000</SellUnit>',
    '<maxQtyPerTrans>0.00</maxQtyPerTrans>',
    '<domain:taxRate sysid="2"></domain:taxRate>',
    '<domain:idCheck sysid="2"></domain:idCheck>',
  ]) assert.equal(write.xml.includes(preserved), true, preserved)
  assert.equal((write.xml.match(/<domain:PLU>/g) || []).length, 1)
})

test('production adapter pre-reads exact product state before one guarded update_product write', async () => {
  const [product] = parseVpluResponse(XML)
  const writes = []
  const adapter = createCommanderPriceAdapter({
    origin: 'https://commander.fixture',
    sessionCookie: 'fixture-cookie',
    trust: {},
    resolveCatalogPageHintImpl: async () => ({ page: 7 }),
    readCommanderProductImpl: async () => ({ status: 'success', product }),
    sendSupportedProductWriteImpl: async (input) => { writes.push(input); return { status: 'success' } },
  })

  assert.deepEqual(await adapter.updateProduct({
    upc: UPC,
    modifier: MODIFIER,
    expectedDescription: 'OPIA ULTRA 60MG $49.99',
    description: 'OPIA ULTRA 60MG $21.99',
    expectedDepartment: '24',
    department: '9',
    expectedPrice: '20.99',
    price: '21.99',
  }), { idempotent: false })

  assert.equal(writes.length, 1)
  assert.equal(writes[0].command.command_type, 'update_product')
  assert.deepEqual(writes[0].command.requested_changes, {
    description: 'OPIA ULTRA 60MG $21.99',
    department_number: '9',
    retail_price: '21.99',
  })
})

test('production adapter blocks a stale description or department before uPLUs', async () => {
  const [product] = parseVpluResponse(XML)
  let writes = 0
  const adapter = createCommanderPriceAdapter({
    origin: 'https://commander.fixture',
    sessionCookie: 'fixture-cookie',
    trust: {},
    readCommanderProductImpl: async () => ({ status: 'success', product }),
    sendSupportedProductWriteImpl: async () => { writes += 1; return { status: 'success' } },
  })

  await assert.rejects(
    adapter.updateProduct({
      upc: UPC,
      modifier: MODIFIER,
      expectedDescription: 'STALE DESCRIPTION',
      description: 'NEW DESCRIPTION',
      expectedDepartment: '24',
      department: '9',
      expectedPrice: '20.99',
      price: '21.99',
    }),
    (error) => error.code === 'price_conflict',
  )
  assert.equal(writes, 0)
})

test('connector claim and report validators accept the bounded update_product contract', () => {
  const job = productJob()
  assert.deepEqual(validateClaimResponse(job), job)
  assert.deepEqual(validateReportPayload({
    job_id: JOB_ID,
    status: 'completed',
    verification: {
      upc: UPC,
      modifier: MODIFIER,
      description: job.description,
      department: job.department,
      price: job.price,
    },
  }), {
    job_id: JOB_ID,
    status: 'completed',
    verification: {
      upc: UPC,
      modifier: MODIFIER,
      description: job.description,
      department: job.department,
      price: job.price,
    },
  })
})

test('worker executes update_product then verifies all supported fields before completion', async () => {
  const job = productJob()
  const events = []
  const reports = []
  const adapter = {
    updatePrice: async () => { throw new Error('price path must not run') },
    readProduct: async () => ({ upc: UPC, modifier: MODIFIER, price: job.price }),
    updateProduct: async (input) => { events.push(['update', input]) },
    readProductDetail: async () => {
      events.push(['read'])
      return {
        upc: UPC,
        modifier: MODIFIER,
        description: job.description,
        department: job.department,
        price: job.price,
      }
    },
  }
  const apiClient = {
    claim: async () => job,
    report: async (payload) => {
      reports.push(payload)
      return { job_id: payload.job_id, status: payload.status }
    },
  }

  const worker = createPosPublishWorker({ apiClient, commanderAdapter: adapter })
  assert.deepEqual(await worker.processOne(), { outcome: 'completed', job_id: JOB_ID })
  assert.deepEqual(events.map(([kind]) => kind), ['update', 'read'])
  assert.deepEqual(reports.map(({ status }) => status), ['sending', 'verifying', 'completed'])
  assert.deepEqual(reports[2].verification, {
    upc: UPC,
    modifier: MODIFIER,
    description: job.description,
    department: job.department,
    price: job.price,
  })
})

test('new connector advertises all approved bounded mutation capabilities without credentials', async () => {
  let request
  const client = createPosPublishApiClient({
    baseUrl: 'http://127.0.0.1:54321',
    connectorToken: TOKEN,
    workerVersion: 'offline-test.1',
    fetchImpl: async (url, options) => {
      request = { url: String(url), options }
      return new Response(JSON.stringify(productJob()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  assert.equal((await client.claim()).operation, 'update_product')
  assert.deepEqual(JSON.parse(request.options.body), {
    worker_version: 'offline-test.1',
    capabilities: ['update_price', 'update_product', 'create_product'],
  })
  assert.equal(request.options.credentials, 'omit')
})
