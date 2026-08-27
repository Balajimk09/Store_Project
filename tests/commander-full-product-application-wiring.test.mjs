import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CommanderProductPublishError,
  getCommanderProductContext,
  getCommanderProductJob,
  normalizeCreateRequest,
  normalizeCommanderProductRequest,
  requestCommanderProductCreate,
  requestCommanderProductUpdate,
  resolveCommanderProductMasterData,
} from '../lib/pos/controlled-commander-product-publish.mjs'

const STORE_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const TAX_ID = '44444444-4444-4444-8444-444444444444'
const AGE_ID = '55555555-5555-4555-8555-555555555555'
const TAX_TWO_ID = '44444444-4444-4444-8444-444444444445'
const AGE_TWO_ID = '55555555-5555-4555-8555-555555555556'
const RUN_ID = '66666666-6666-4666-8666-666666666666'

function context() {
  return {
    product_id: PRODUCT_ID,
    source_product_key: '00012000007460/000',
    source_upc: '00012000007460',
    source_modifier: '000',
    commander_description: 'DEW D 2LITTER',
    commander_department_key: '24',
    commander_department_name: 'DRINKS',
    commander_price: '2.29',
    commander_payment_product_code: '0',
    commander_selling_unit: '1.000',
    commander_max_qty_per_trans: '0.00',
    commander_taxable_rebate: '0.00',
    commander_tax_rate_ids: ['2'],
    commander_id_check_ids: ['3'],
    commander_flag_ids: ['1', '7'],
    canonical_description: 'DEW D 2LITTER',
    canonical_department: 'Drinks',
    canonical_price: '2.29',
    observed_at: '2026-08-15T12:00:00Z',
  }
}

function query(result) {
  const filters = new Map()
  const resolve = () => typeof result === 'function' ? result(filters) : result
  return {
    select() { return this },
    eq(column, value) { filters.set(column, value); return this },
    order() { return this },
    limit() { return this },
    in() { return this },
    maybeSingle() { return Promise.resolve(resolve()) },
    then(onfulfilled, onrejected) { return Promise.resolve(resolve()).then(onfulfilled, onrejected) },
  }
}

function createClient({ contextRow = context(), taxMappings = [{ source_key: '2' }], ageMappings = [{ source_key: '3' }], taxRows = [{ source_tax_key: '2' }], ageRows = [{ source_age_validation_key: '3' }] } = {}) {
  const rpcCalls = []
  return {
    rpcCalls,
    rpc(name, params) {
      rpcCalls.push({ name, params })
      if (name === 'get_commander_full_product_context') return Promise.resolve({ data: [contextRow], error: null })
      if (name === 'request_commander_product_update') {
        return Promise.resolve({
          data: [{
            job_id: '77777777-7777-4777-8777-777777777777',
            status: 'pending',
            expected_price: '2.29',
            requested_price: '2.40',
            created_at: '2026-08-15T12:00:01Z',
          }],
          error: null,
        })
      }
      throw new Error(`unexpected RPC: ${name}`)
    },
    from(table) {
      if (table === 'pos_catalog_source_master_data_runs') return query({ data: { id: RUN_ID }, error: null })
      if (table === 'pos_catalog_source_product_codes') return query((filters) => ({
        data: [{ source_product_code_key: filters.get('source_product_code_key') ?? '0' }],
        error: null,
      }))
      if (table === 'pos_catalog_source_master_data_mappings') return query((filters) => ({
        data: filters.get('entity_type') === 'tax' ? taxMappings : ageMappings,
        error: null,
      }))
      if (table === 'pos_catalog_source_tax_definitions') return query({ data: taxRows, error: null })
      if (table === 'pos_catalog_source_age_validations') return query({ data: ageRows, error: null })
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

function productJobRow(overrides = {}) {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    store_id: STORE_ID,
    product_id: PRODUCT_ID,
    operation: 'update_product',
    status: 'pending',
    // PostgREST parses PostgreSQL numeric values as JavaScript numbers.
    expected_price: 1,
    requested_price: 1.2,
    created_at: '2026-08-15T12:00:01Z',
    completed_at: null,
    failed_at: null,
    audit_metadata: {},
    ...overrides,
  }
}

function productJobClient({ job = productJobRow(), store = { id: STORE_ID } } = {}) {
  return {
    from(table) {
      if (table === 'stores') return query({ data: store, error: null })
      if (table === 'pos_publish_jobs') return query({ data: job, error: null })
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

function request() {
  return {
    store_id: STORE_ID,
    product_id: PRODUCT_ID,
    requested_description: 'DEW D 2LITTER',
    requested_department: null,
    requested_price: '2.40',
    requested_payment_product_code: '400',
    requested_selling_unit: '1.000',
    requested_max_qty_per_trans: '0.00',
    requested_taxable_rebate: '0.00',
    requested_tax_category_id: TAX_ID,
    requested_age_restriction_id: AGE_ID,
    idempotency_key: 'commander-product:test-request-0001',
  }
}

function createRequest({ taxCategoryId = TAX_ID, ageRestrictionId = AGE_ID } = {}) {
  return {
    store_id: STORE_ID,
    product_id: PRODUCT_ID,
    requested_tax_category_id: taxCategoryId,
    requested_age_restriction_id: ageRestrictionId,
    idempotency_key: 'commander-product:create-request-0001',
  }
}

function createProductClient({
  department = 'DEPARTMENT_ALPHA',
  sourceDepartmentKey = '101',
  paymentProductCode = '501',
  maxQtyPerTrans = '2.00',
  taxRateId = '11',
  idCheckId = '21',
} = {}) {
  const rpcCalls = []
  return {
    rpcCalls,
    rpc(name) {
      throw new Error(`unexpected user RPC: ${name}`)
    },
    from(table) {
      if (table === 'stores') return query({ data: { id: STORE_ID }, error: null })
      if (table === 'products') {
        return query({
          data: {
            id: PRODUCT_ID,
            store_id: STORE_ID,
            upc: '00012000007460',
            item_name: 'CREATE PRODUCT',
            department,
            selling_price: '1.00',
          },
          error: null,
        })
      }
      if (table === 'product_source_identities') return query({ data: [], error: null })
      if (table === 'pos_catalog_source_master_data_runs') return query({ data: { id: RUN_ID }, error: null })
      if (table === 'store_departments') return query({ data: [{ id: '77777777-7777-4777-8777-777777777777' }], error: null })
      if (table === 'pos_catalog_source_master_data_mappings') {
        return query((filters) => ({
          data: filters.get('entity_type') === 'department'
            ? [{ source_key: sourceDepartmentKey }]
            : filters.get('entity_type') === 'tax'
              ? [{ source_key: taxRateId }]
              : [{ source_key: idCheckId }],
          error: null,
        }))
      }
      if (table === 'pos_catalog_source_department_definitions') {
        return query({
          data: [{
            source_department_key: sourceDepartmentKey,
            source_product_code_key: paymentProductCode,
            source_values: { maximum_quantity_per_transaction: maxQtyPerTrans },
          }],
          error: null,
        })
      }
      if (table === 'pos_catalog_source_product_codes') return query({ data: [{ source_product_code_key: paymentProductCode }], error: null })
      if (table === 'pos_catalog_source_tax_definitions') return query({ data: [{ source_tax_key: taxRateId }], error: null })
      if (table === 'pos_catalog_source_age_validations') return query({ data: [{ source_age_validation_key: idCheckId }], error: null })
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

function createPrivilegedClient({ createProfileVersion = 'native_simple_create_v1' } = {}) {
  const rpcCalls = []
  return {
    rpcCalls,
    rpc(name, params) {
      rpcCalls.push({ name, params })
      if (name !== 'request_commander_product_create') throw new Error(`unexpected privileged RPC: ${name}`)
      return Promise.resolve({
        data: [{
          job_id: '88888888-8888-4888-8888-888888888888',
          status: 'pending',
          expected_price: '1.00',
          requested_price: '1.00',
          created_at: '2026-08-15T12:00:01Z',
        }],
        error: null,
      })
    },
    from(table) {
      if (table !== 'pos_source_create_profiles') throw new Error(`unexpected privileged table: ${table}`)
      return query({ data: { create_profile_version: createProfileVersion }, error: null })
    },
  }
}

test('full Commander context validates the normalized V2 source state and preserves leading-zero identity', async () => {
  const client = createClient()
  const value = await getCommanderProductContext({ client, userId: USER_ID, storeId: STORE_ID, productId: PRODUCT_ID })
  assert.equal(value.source_upc, '00012000007460')
  assert.equal(value.source_modifier, '000')
  assert.equal(value.source_product_key, '00012000007460/000')
  assert.deepEqual(value.commander_tax_rate_ids, ['2'])
  assert.deepEqual(value.commander_id_check_ids, ['3'])
  assert.deepEqual(value.commander_flag_ids, ['1', '7'])
})

test('full Commander context rejects malformed extended fields and duplicate Commander sysids', async () => {
  for (const contextRow of [
    { ...context(), commander_selling_unit: '1.00' },
    { ...context(), commander_tax_rate_ids: ['2', '2'] },
    { ...context(), commander_flag_ids: ['flag'] },
  ]) {
    await assert.rejects(
      getCommanderProductContext({ client: createClient({ contextRow }), userId: USER_ID, storeId: STORE_ID, productId: PRODUCT_ID }),
      (error) => error instanceof CommanderProductPublishError && error.code === 'publish_unavailable',
    )
  }
})

test('browser request cannot supply Commander expected values, source identity, or flag writes', () => {
  const parsed = normalizeCommanderProductRequest(request())
  assert.equal(parsed.productId, PRODUCT_ID)
  assert.equal(parsed.requestedTaxCategoryId, TAX_ID)
  for (const forbidden of ['expected_description', 'expected_price', 'source_upc', 'source_modifier', 'flag_ids']) {
    assert.throws(
      () => normalizeCommanderProductRequest({ ...request(), [forbidden]: 'unsafe' }),
      (error) => error instanceof CommanderProductPublishError && error.code === 'invalid_request',
    )
  }
})

test('create request accepts only canonical identifiers and resolves native-simple Commander fields server-side', async () => {
  const parsed = normalizeCreateRequest(createRequest())
  assert.equal(parsed.storeId, STORE_ID)
  assert.equal(parsed.productId, PRODUCT_ID)
  for (const forbidden of ['requested_payment_product_code', 'requested_selling_unit', 'requested_max_qty_per_trans', 'requested_taxable_rebate']) {
    assert.throws(
      () => normalizeCreateRequest({ ...createRequest(), [forbidden]: 'unsafe' }),
      (error) => error instanceof CommanderProductPublishError && error.code === 'invalid_request',
    )
  }

  for (const scenario of [
    {
      department: 'DEPARTMENT_ALPHA', sourceDepartmentKey: '101', paymentProductCode: '501', maxQtyPerTrans: '2.00',
      taxRateId: '11', idCheckId: '21', taxCategoryId: TAX_ID, ageRestrictionId: AGE_ID,
    },
    {
      department: 'DEPARTMENT_BETA', sourceDepartmentKey: '202', paymentProductCode: '802', maxQtyPerTrans: '7.00',
      taxRateId: '12', idCheckId: '22', taxCategoryId: TAX_TWO_ID, ageRestrictionId: AGE_TWO_ID,
    },
  ]) {
    const client = createProductClient(scenario)
    const privilegedClient = createPrivilegedClient()
    const job = await requestCommanderProductCreate({
      client,
      privilegedClient,
      userId: USER_ID,
      input: createRequest(scenario),
    })
    assert.equal(job.status, 'pending')
    assert.deepEqual(client.rpcCalls, [])
    assert.equal(privilegedClient.rpcCalls.length, 1)
    const params = privilegedClient.rpcCalls[0].params
    assert.equal(params.p_upc, '00012000007460')
    assert.equal(params.p_modifier, '000')
    assert.equal(params.p_department_name, scenario.department)
    assert.equal(params.p_payment_product_code, scenario.paymentProductCode)
    assert.equal(params.p_selling_unit, '1.000')
    assert.equal(params.p_max_qty_per_trans, scenario.maxQtyPerTrans)
    assert.equal(params.p_taxable_rebate, '0.00')
    assert.deepEqual(params.p_tax_rate_ids, [scenario.taxRateId])
    assert.deepEqual(params.p_id_check_ids, [scenario.idCheckId])
  }

  const client = createProductClient()
  const privilegedClient = createPrivilegedClient({ createProfileVersion: 'unverified_profile' })
  await assert.rejects(
    requestCommanderProductCreate({ client, privilegedClient, userId: USER_ID, input: createRequest() }),
    (error) => error instanceof CommanderProductPublishError && error.code === 'commander_create_profile_invalid',
  )
  assert.equal(privilegedClient.rpcCalls.length, 0)
})

test('direct Commander numeric fields require the exact bounded database formats', () => {
  for (const [field, value] of [
    ['requested_selling_unit', '1.00'],
    ['requested_max_qty_per_trans', '1.000'],
    ['requested_taxable_rebate', '1000000.00'],
  ]) {
    assert.throws(
      () => normalizeCommanderProductRequest({ ...request(), [field]: value }),
      (error) => error instanceof CommanderProductPublishError && error.code === 'invalid_product',
    )
  }
})

test('full update reloads expected state, resolves current mapped tax and age IDs, and invokes one existing full update RPC', async () => {
  const client = createClient()
  const job = await requestCommanderProductUpdate({ client, userId: USER_ID, input: request() })
  assert.equal(job.status, 'pending')
  assert.equal(client.rpcCalls.length, 2)
  assert.equal(client.rpcCalls[0].name, 'get_commander_full_product_context')
  assert.equal(client.rpcCalls[1].name, 'request_commander_product_update')
  const params = client.rpcCalls[1].params
  assert.equal(params.p_expected_description, 'DEW D 2LITTER')
  assert.equal(params.p_expected_department, '24')
  assert.equal(params.p_expected_price, '2.29')
  assert.equal(params.p_expected_payment_product_code, '0')
  assert.equal(params.p_requested_payment_product_code, '400')
  assert.equal(params.p_requested_selling_unit, '1.000')
  assert.equal(params.p_requested_max_qty_per_trans, '0.00')
  assert.equal(params.p_requested_taxable_rebate, '0.00')
  assert.deepEqual(params.p_requested_tax_rate_ids, ['2'])
  assert.deepEqual(params.p_requested_id_check_ids, ['3'])
  assert.equal(Object.hasOwn(params, 'p_requested_flag_ids'), false)
})

test('unchanged effective full state produces no product mutation RPC', async () => {
  const client = createClient()
  const unchanged = {
    ...request(),
    requested_price: '2.29',
    requested_payment_product_code: '0',
  }
  await assert.rejects(
    requestCommanderProductUpdate({ client, userId: USER_ID, input: unchanged }),
    (error) => error instanceof CommanderProductPublishError && error.code === 'product_unchanged',
  )
  assert.deepEqual(client.rpcCalls.map((call) => call.name), ['get_commander_full_product_context'])
})

test('missing or ambiguous current tax and age mappings fail closed', async () => {
  await assert.rejects(
    resolveCommanderProductMasterData({
      client: createClient({ taxMappings: [], ageMappings: [], taxRows: [], ageRows: [] }),
      storeId: STORE_ID,
      paymentProductCode: '400',
      taxCategoryId: TAX_ID,
      ageRestrictionId: AGE_ID,
    }),
    (error) => error instanceof CommanderProductPublishError && error.code === 'master_data_mapping_unavailable',
  )
  await assert.rejects(
    resolveCommanderProductMasterData({
      client: createClient({
        taxMappings: [{ source_key: '2' }, { source_key: '4' }],
        taxRows: [{ source_tax_key: '2' }, { source_tax_key: '4' }],
        ageRows: [{ source_age_validation_key: '3' }],
      }),
      storeId: STORE_ID,
      paymentProductCode: '400',
      taxCategoryId: TAX_ID,
      ageRestrictionId: AGE_ID,
    }),
    (error) => error instanceof CommanderProductPublishError && error.code === 'master_data_mapping_ambiguous',
  )
})

test('explicit no-tax and no-age selections become deliberate empty Commander identifier arrays', async () => {
  const result = await resolveCommanderProductMasterData({
    client: createClient(),
    storeId: STORE_ID,
    paymentProductCode: '400',
    taxCategoryId: null,
    ageRestrictionId: null,
  })
  assert.equal(result.paymentProductCode, '400')
  assert.deepEqual(result.taxRateIds, [])
  assert.deepEqual(result.idCheckIds, [])
})

test('product status polling accepts completed, failed, and active V2 jobs with database numeric prices', async () => {
  for (const [status, overrides] of [
    ['completed', { completed_at: '2026-08-15T12:01:00Z' }],
    ['failed', { failed_at: '2026-08-15T12:01:00Z', audit_metadata: { failure_code: 'verification_failed' } }],
    ['pending', {}],
    ['claimed', {}],
    ['sending', {}],
    ['verifying', {}],
  ]) {
    const job = await getCommanderProductJob({
      client: productJobClient({ job: productJobRow({ status, ...overrides }) }),
      userId: USER_ID,
      storeId: STORE_ID,
      jobId: '77777777-7777-4777-8777-777777777777',
    })
    assert.equal(job.status, status)
    assert.equal(job.expected_price, '1.00')
    assert.equal(job.requested_price, '1.20')
    assert.equal(job.failure_code, status === 'failed' ? 'verification_failed' : null)
  }
})

test('product status polling preserves store ownership and job scoping', async () => {
  await assert.rejects(
    getCommanderProductJob({
      client: productJobClient({ store: null }),
      userId: USER_ID,
      storeId: STORE_ID,
      jobId: '77777777-7777-4777-8777-777777777777',
    }),
    error => error instanceof CommanderProductPublishError && error.code === 'forbidden',
  )
  await assert.rejects(
    getCommanderProductJob({
      client: productJobClient({ job: null }),
      userId: USER_ID,
      storeId: STORE_ID,
      jobId: '77777777-7777-4777-8777-777777777777',
    }),
    error => error instanceof CommanderProductPublishError && error.code === 'job_not_found',
  )
})
