import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const page = fs.readFileSync(new URL('../app/(store)/app/products/page.tsx', import.meta.url), 'utf8')
const helper = fs.readFileSync(new URL('../lib/pos/controlled-commander-product-publish.mjs', import.meta.url), 'utf8')
const route = fs.readFileSync(new URL('../app/api/products/commander-product/route.ts', import.meta.url), 'utf8')
const apiClient = fs.readFileSync(new URL('../connector/lib/pos-publish-api-client.mjs', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../connector/lib/pos-publish-worker.mjs', import.meta.url), 'utf8')
const integration = fs.readFileSync(new URL('../connector/lib/commander/commander-product-integration.mjs', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../supabase/migrations/20260814164500_generalize_commander_product_publish.sql', import.meta.url), 'utf8')

function sliceBetween(text, startNeedle, endNeedle) {
  const start = text.indexOf(startNeedle)
  const end = text.indexOf(endNeedle, start)
  assert.notEqual(start, -1, startNeedle)
  assert.notEqual(end, -1, endNeedle)
  return text.slice(start, end)
}

test('Edit Product routes name and department changes through the Commander product queue', () => {
  const save = sliceBetween(page, '  const saveProduct = async () => {', '  const handleProductImportFile = async')
  assert.match(save, /commanderNameChangedByUser/)
  assert.match(save, /commanderDepartmentChangedByUser/)
  assert.match(save, /submitCommanderProduct\(\{/)
  assert.match(save, /StorePulse product before the connector/)
  assert.ok(save.indexOf('submitCommanderProduct({') < save.indexOf('await updateProduct(productToSave'))
  assert.match(save, /requestedDescription: commanderNameChangedByUser/)
  assert.match(save, /requestedDepartment: commanderDepartmentChangedByUser/)
  assert.doesNotMatch(save, /product\.name !== editingProduct\.name[\s\S]{0,220}unsupportedCommanderProductChange/)
})

test('browser product request carries only desired bounded state while the server reloads full Commander context', () => {
  const normalize = sliceBetween(helper, 'export function normalizeCommanderProductRequest', 'export async function readBoundedCommanderProductJson')
  for (const required of [
    'store_id', 'product_id', 'requested_description', 'requested_department', 'requested_price',
    'requested_payment_product_code', 'requested_selling_unit', 'requested_max_qty_per_trans', 'requested_taxable_rebate',
    'requested_tax_category_id', 'requested_age_restriction_id', 'idempotency_key',
  ]) assert.match(normalize, new RegExp(`['\"]${required}['\"]`))
  for (const forbidden of ['expected_description', 'expected_department', 'expected_price', 'source_upc', 'source_modifier', 'flag_ids', 'xml', 'cookie', 'token', 'certificate']) {
    assert.doesNotMatch(normalize, new RegExp(forbidden, 'iu'))
  }
  assert.doesNotMatch(helper, /\.rpc\('expire_stale_commander_publish_jobs'/)
  assert.match(helper, /\.rpc\('get_commander_full_product_context'/)
  assert.match(helper, /p_expected_payment_product_code: context\.commander_payment_product_code/)
  assert.match(helper, /p_requested_payment_product_code: masterData\.paymentProductCode/)
  assert.match(helper, /resolveCommanderProductMasterData/)
  assert.match(helper, /pos_catalog_source_product_codes/)
  assert.match(helper, /last_master_data_run_id/)
  assert.match(helper, /source_product_code_key/)
  assert.match(normalize, /requested_payment_product_code/)
  assert.match(route, /requestCommanderProductUpdate/)
  assert.doesNotMatch(route, /service[_-]?role|uPLUs|session_cookie/iu)
})

test('full product queue call uses the exact deployed V2 request parameter names without an undeployed lease RPC', () => {
  const invocation = sliceBetween(
    helper,
    "const { data, error } = await client.rpc('request_commander_product_update', {",
    '  if (error) {',
  )
  const parameterNames = [...invocation.matchAll(/^\s+(p_[a-z_]+):/gm)].map((match) => match[1])
  assert.deepEqual(parameterNames, [
    'p_store_id',
    'p_product_id',
    'p_expected_description',
    'p_requested_description',
    'p_expected_department',
    'p_requested_department_name',
    'p_expected_price',
    'p_requested_price',
    'p_expected_payment_product_code',
    'p_requested_payment_product_code',
    'p_expected_selling_unit',
    'p_requested_selling_unit',
    'p_expected_max_qty_per_trans',
    'p_requested_max_qty_per_trans',
    'p_expected_taxable_rebate',
    'p_requested_taxable_rebate',
    'p_expected_tax_rate_ids',
    'p_requested_tax_rate_ids',
    'p_expected_id_check_ids',
    'p_requested_id_check_ids',
    'p_idempotency_key',
  ])
  assert.doesNotMatch(helper, /\.rpc\('expire_stale_commander_publish_jobs'/)
})

test('Products UI publishes current mapped tax and age selections plus bounded direct Commander fields only', () => {
  const save = sliceBetween(page, '  const saveProduct = async () => {', '  const handleProductImportFile = async')
  assert.match(save, /selectedTaxOptions\.length !== 1/)
  assert.match(save, /selectedAgeOptions\.length !== 1/)
  assert.match(save, /requestedTaxCategoryId: product\.taxable \? selectedTaxOptions\[0\]\.id : null/)
  assert.match(save, /requestedAgeRestrictionId: product\.ageVerification \? selectedAgeOptions\[0\]\.id : null/)
  assert.match(save, /requestedPaymentProductCode: editingCommanderEffectiveProductFields\.paymentProductCode/)
  assert.match(save, /requestedSellingUnit: editingCommanderEffectiveProductFields\.sellingUnit/)
  assert.match(save, /requestedMaxQtyPerTrans: editingCommanderEffectiveProductFields\.maxQtyPerTrans/)
  assert.match(save, /requestedTaxableRebate: editingCommanderEffectiveProductFields\.taxableRebate/)
  assert.match(save, /commanderTaxChangedByUser/)
  assert.match(save, /commanderAgeChangedByUser/)
  assert.doesNotMatch(save, /commander_flag_ids/)
})

test('Edit Product keeps untouched Commander V2 fields from its loaded context while rejecting invalid explicit edits', () => {
  const contextLoader = sliceBetween(page, '  const loadEditingCommanderProductContext = useCallback', '  const editingCommanderEffectiveProductFields = useMemo')
  const effectiveFields = sliceBetween(page, '  const editingCommanderEffectiveProductFields = useMemo', '  const refreshCommanderPriceJob = useCallback')
  const submit = sliceBetween(page, '  const submitCommanderProduct = useCallback', '  const resetNewProductReviewModal = useCallback')
  const save = sliceBetween(page, '  const saveProduct = async () => {', '  const handleProductImportFile = async')

  for (const [formField, contextField] of [
    ['paymentProductCode', 'commander_payment_product_code'],
    ['sellingUnit', 'commander_selling_unit'],
    ['maxQtyPerTrans', 'commander_max_qty_per_trans'],
    ['taxableRebate', 'commander_taxable_rebate'],
  ]) {
    assert.match(contextLoader, new RegExp(`${formField}: json\\.context\\.${contextField}`))
    assert.match(effectiveFields, new RegExp(`editingCommanderProductFieldEdits\\.${formField}[\\s\\S]*?editingCommanderProductContext\\.${contextField}`))
    const requestedField = `requested${formField[0].toUpperCase()}${formField.slice(1)}`
    assert.match(save, new RegExp(`${requestedField}: editingCommanderEffectiveProductFields\\.${formField}`))
  }

  assert.match(save, /commanderNameChangedByUser/)
  assert.match(save, /commanderDepartmentChangedByUser/)
  assert.match(page, /commanderFields=\{[\s\S]*?modalMode === 'edit' && editingCommanderProductContext[\s\S]*?editingCommanderEffectiveProductFields/)
  assert.match(page, /Object\.keys\(patch\)\.map\(\(field\) => \[field, true\]\)/)
  assert.match(submit, /!\/\^\\d\{1,16\}\$\/\.test\(normalizedPaymentProductCode\)/)
  assert.match(submit, /!normalizedSellingUnit/)
  assert.match(submit, /!normalizedMaxQtyPerTrans/)
  assert.match(submit, /!normalizedTaxableRebate/)
  assert.match(page, /mode === 'add'\s*\? 'Add Product'/)
})

test('connector capability and worker preserve price while adding update_product', () => {
  assert.match(apiClient, /capabilities = \['update_price', 'update_product', 'create_product'\]/)
  assert.match(worker, /job\.operation === 'update_product'/)
  assert.match(worker, /adapter\.updateProduct/)
  assert.match(worker, /adapter\.updatePrice/)
  assert.match(worker, /readProductDetail/)
  assert.match(worker, /description:\s*job\.description/)
  assert.match(worker, /department:\s*job\.department/)
})

test('Commander writer uses one template-preserving uPLUs for description department and price only', () => {
  const write = sliceBetween(integration, 'export function buildUpdateProductXml', 'export function buildProductWriteXml')
  assert.match(write, /description:/)
  assert.match(write, /department:/)
  assert.match(write, /price:/)
  assert.match(integration, /SUPPORTED_PRODUCT_COMMANDS = new Set\(\['update_price', 'create_product', 'update_product'\]\)/)
  assert.match(integration, /validated\.command_type === 'update_product'.*command: 'uPLUs'/s)
})

test('database keeps legacy price claim/report compatibility and gates canonical changes on verified update_product completion', () => {
  assert.match(migration, /create or replace function public\.claim_pos_publish_job\(p_connector_id uuid\)[\s\S]*?job\.operation::text = 'update_price'/)
  assert.match(migration, /create or replace function public\.claim_pos_publish_job\([\s\S]*?p_capabilities text\[\]/)
  assert.match(migration, /job\.operation::text = any\(p_capabilities\)/)
  assert.match(migration, /p_verification_description is distinct from \(v_job\.payload #>> '\{requested,description\}'\)/)
  assert.match(migration, /p_verification_department is distinct from \(v_job\.payload #>> '\{requested,department\}'\)/)
  const completion = sliceBetween(migration, "if v_job.operation::text = 'update_product' then", "elsif v_job.operation::text = 'update_price' then")
  assert.match(completion, /update public\.products/)
  assert.match(completion, /set item_name = v_job\.payload #>> '\{requested,description\}'/)
  assert.match(completion, /department = v_job\.payload #>> '\{requested,department_name\}'/)
  assert.match(completion, /selling_price = v_job\.requested_price/)
})
