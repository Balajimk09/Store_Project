import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const STORE_A = '11111111-1111-4111-8111-111111111111'
const STORE_B = '22222222-2222-4222-8222-222222222222'
const RUN_A = '33333333-3333-4333-8333-333333333333'
const RUN_B = '44444444-4444-4444-8444-444444444444'

const mappingMigrationPath = new URL(
  '../supabase/migrations/20260813000000_fix_effective_product_rows_mapping_join.sql',
  import.meta.url,
)
const mappingSchemaPath = new URL(
  '../supabase/migrations/20260810234653_add_commander_master_data_canonical_mappings.sql',
  import.meta.url,
)
const effectiveRowsPath = new URL(
  '../supabase/migrations/20260812020000_add_commander_pre_promotion_review_resolutions.sql',
  import.meta.url,
)
const selectedPromotionPath = new URL(
  '../supabase/migrations/20260812040000_add_commander_live_catalog_single_product_promotion.sql',
  import.meta.url,
)

function resolveCurrentDepartmentMapping({ storeId, masterDataRunId, sourceDepartmentKey, mappings, departments }) {
  const currentDepartment = departments.find(department => (
    department.storeId === storeId
    && department.sourceSystem === 'commander'
    && department.sourceDepartmentKey === sourceDepartmentKey
    && department.lastMasterDataRunId === masterDataRunId
    && department.isPresent
  ))
  if (!currentDepartment) return null

  const matches = mappings.filter(mapping => (
    mapping.storeId === currentDepartment.storeId
    && mapping.sourceSystem === currentDepartment.sourceSystem
    && mapping.entityType === 'department'
    && mapping.sourceKey === currentDepartment.sourceDepartmentKey
    && mapping.sourceContextKey === ''
    && mapping.status === 'mapped'
  ))
  if (matches.length > 1) throw new Error('mapping_identity_ambiguous')
  return matches[0] ?? null
}

function currentDepartments() {
  return [
    { storeId: STORE_A, sourceSystem: 'commander', sourceDepartmentKey: 'DRINKS', lastMasterDataRunId: RUN_B, isPresent: true },
    { storeId: STORE_A, sourceSystem: 'commander', sourceDepartmentKey: 'TOBACCO', lastMasterDataRunId: RUN_B, isPresent: true },
    { storeId: STORE_B, sourceSystem: 'commander', sourceDepartmentKey: 'DRINKS', lastMasterDataRunId: RUN_B, isPresent: true },
  ]
}

function mappedDepartment(overrides = {}) {
  return {
    storeId: STORE_A,
    sourceSystem: 'commander',
    entityType: 'department',
    sourceKey: 'DRINKS',
    sourceContextKey: '',
    status: 'mapped',
    masterDataRunId: RUN_A,
    canonicalDepartmentId: '55555555-5555-4555-8555-555555555555',
    ...overrides,
  }
}

test('durable department mapping survives a later current master-data run without rewriting its audit run', () => {
  const mapping = mappedDepartment()
  const result = resolveCurrentDepartmentMapping({
    storeId: STORE_A,
    masterDataRunId: RUN_B,
    sourceDepartmentKey: 'DRINKS',
    mappings: [mapping],
    departments: currentDepartments(),
  })

  assert.equal(result, mapping)
  assert.equal(result.masterDataRunId, RUN_A)
})

test('mapping resolution remains exact by department, store, source system, and mapped status', () => {
  const mappings = [
    mappedDepartment({ sourceKey: 'TOBACCO', canonicalDepartmentId: '66666666-6666-4666-8666-666666666666' }),
    mappedDepartment({ storeId: STORE_B }),
    mappedDepartment({ sourceSystem: 'other' }),
    mappedDepartment({ status: 'ignored' }),
  ]

  assert.equal(resolveCurrentDepartmentMapping({
    storeId: STORE_A,
    masterDataRunId: RUN_B,
    sourceDepartmentKey: 'DRINKS',
    mappings,
    departments: currentDepartments(),
  }), null)
  assert.equal(resolveCurrentDepartmentMapping({
    storeId: STORE_A,
    masterDataRunId: RUN_B,
    sourceDepartmentKey: 'TOBACCO',
    mappings: [mappings[0]],
    departments: currentDepartments(),
  }).sourceKey, 'TOBACCO')
})

test('missing or duplicate durable mappings fail closed instead of creating a cross-department fan-out', () => {
  const options = {
    storeId: STORE_A,
    masterDataRunId: RUN_B,
    sourceDepartmentKey: 'DRINKS',
    departments: currentDepartments(),
  }

  assert.equal(resolveCurrentDepartmentMapping({ ...options, mappings: [] }), null)
  assert.throws(
    () => resolveCurrentDepartmentMapping({ ...options, mappings: [mappedDepartment(), mappedDepartment()] }),
    /mapping_identity_ambiguous/u,
  )
})

test('DEW D 2LITTER can become reconcilable only through its exact older durable DRINKS mapping', () => {
  const sourceProduct = {
    sourceProductKey: '00012000007460/000',
    sourceUpc: '00012000007460',
    sourceModifier: '000',
    sourceDepartmentKey: null,
    resolvedDepartmentMappingId: '55555555-5555-4555-8555-555555555555',
  }
  const mapping = mappedDepartment({ id: sourceProduct.resolvedDepartmentMappingId })
  const effectiveDepartment = resolveCurrentDepartmentMapping({
    storeId: STORE_A,
    masterDataRunId: RUN_B,
    sourceDepartmentKey: mapping.sourceKey,
    mappings: [mapping],
    departments: currentDepartments(),
  })

  assert.equal(sourceProduct.sourceProductKey, `${sourceProduct.sourceUpc}/${sourceProduct.sourceModifier}`)
  assert.equal(effectiveDepartment?.sourceKey, 'DRINKS')
  assert.equal(effectiveDepartment?.masterDataRunId, RUN_A)
})
