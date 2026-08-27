import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const operationMigration = read('../supabase/migrations/20260819005000_add_commander_create_product_operation.sql')
const migration = read('../supabase/migrations/20260819010000_add_commander_product_create_publish.sql')
const rpcFixMigration = read('../supabase/migrations/20260826032229_fix_commander_product_create_rpcs.sql')
const reportStatusFixMigration = read('../supabase/migrations/20260826190611_fix_commander_product_create_report_status_ambiguity.sql')
const helper = read('../lib/pos/controlled-commander-product-publish.mjs')
const route = read('../app/api/products/commander-product/route.ts')
const worker = read('../connector/lib/pos-publish-worker.mjs')
const adapter = read('../connector/lib/commander-price-adapter.mjs')
const edgeClaim = read('../supabase/functions/claim-pos-publish-job/index.ts')
const edgeReport = read('../supabase/functions/report-pos-publish-job-status/index.ts')
const productsPage = read('../app/(store)/app/products/page.tsx')
const productForm = read('../components/products/ProductForm.tsx')

test('Commander create profile is store scoped, idempotent, and never a global flag default', () => {
  assert.match(migration, /create table if not exists public\.pos_source_create_profiles/u)
  assert.match(migration, /primary key \(store_id, source_system\)/u)
  assert.match(migration, /native_simple_create_v1/u)
  assert.match(migration, /on conflict \(store_id, source_system\) do nothing/u)
  assert.doesNotMatch(helper, /DEFAULT_FLAGS/u)
  assert.doesNotMatch(route, /flagSysIds/u)
})

test('create_product enum value commits in a dedicated precursor migration', () => {
  assert.match(operationMigration, /alter type public\.pos_publish_job_operation\s+add value if not exists 'create_product';/u)
  assert.doesNotMatch(operationMigration, /create table|alter table|create(?:\s+or\s+replace)? function|create unique index|\brpc\b/iu)
  assert.doesNotMatch(migration, /alter type public\.pos_publish_job_operation\s+add value if not exists 'create_product';/u)
  assert.match(migration, /operation::text in \('update_price', 'update_product', 'create_product'\)/u)
  assert.match(migration, /where operation in \('update_price'::public\.pos_publish_job_operation, 'update_product'::public\.pos_publish_job_operation, 'create_product'::public\.pos_publish_job_operation\)/u)
})

test('create request RPC is explicitly service-role-only with the exact PostgreSQL signature', () => {
  const signature = 'uuid,uuid,uuid,text,text,text,numeric,text,text,text,text,text,text[],text[],text'
  const escaped = signature.replace(/[\[\]]/gu, '\\$&').replace(/,/gu, '\\s*,\\s*')
  const functionName = `public\\.request_commander_product_create\\(\\s*${escaped}\\s*\\)`
  assert.match(migration, new RegExp(`revoke all on function ${functionName} from public\\s*,\\s*anon\\s*,\\s*authenticated;`, 'u'))
  assert.match(migration, new RegExp(`grant execute on function ${functionName} to service_role;`, 'u'))
  assert.doesNotMatch(migration, new RegExp(`grant execute on function ${functionName} to authenticated`, 'u'))
  assert.match(migration, /language plpgsql security definer set search_path = pg_catalog, public/u)
})

test('service-only create RPC receives the requester explicitly and never depends on auth.uid()', () => {
  const start = migration.indexOf('create or replace function public.request_commander_product_create(')
  const end = migration.indexOf('create function public.claim_commander_product_create_job', start)
  assert.ok(start >= 0 && end > start)
  const createRpc = migration.slice(start, end)
  assert.match(createRpc, /p_requested_by uuid/u)
  assert.match(createRpc, /p_requested_by is null or not exists \(select 1 from public\.stores where id=p_store_id and owner_id=p_requested_by\)/u)
  assert.match(createRpc, /values\(p_store_id,p_product_id,p_requested_by,v_connector_id,'create_product'/u)
  assert.doesNotMatch(createRpc, /auth\.uid\(\)/u)
})

test('server owns durable linked routing and keeps UPC-only matching out of it', () => {
  assert.match(route, /hasCommanderProductSourceIdentity/u)
  assert.match(route, /requestCommanderProductUpdate/u)
  assert.match(route, /requestCommanderProductCreate/u)
  assert.match(helper, /product_source_identities/u)
  assert.match(helper, /source_system', COMMANDER_SOURCE_SYSTEM/u)
})

test('browser cannot provide raw Commander create values and the route escalates only after owner-store validation', () => {
  const normalize = helper.slice(
    helper.indexOf('export function normalizeCommanderProductRequest'),
    helper.indexOf('export async function readBoundedCommanderProductJson'),
  )
  for (const forbidden of ['flagSysIds', 'taxRateSysIds', 'idCheckSysIds', 'departmentSysId', 'modifier', 'source_modifier']) {
    assert.doesNotMatch(normalize, new RegExp(forbidden, 'u'))
  }
  assert.match(route, /import \{ getSupabaseAdmin \} from '@\/lib\/supabase-admin';/u)
  const linkedIndex = route.indexOf('const linked = await hasCommanderProductSourceIdentity')
  const adminIndex = route.indexOf('privilegedClient: getSupabaseAdmin()')
  assert.ok(linkedIndex >= 0 && adminIndex > linkedIndex)
  const create = helper.slice(helper.indexOf('export async function requestCommanderProductCreate'), helper.indexOf('export async function getCommanderProductJob'))
  assert.match(create, /loadCanonicalCreateProduct\(/u)
  assert.match(create, /resolveCommanderProductMasterData\(/u)
  assert.ok(create.indexOf('resolveCommanderProductMasterData') < create.indexOf("privilegedClient.rpc('request_commander_product_create'"))
  assert.ok(create.indexOf('loadCanonicalCreateProduct') < create.indexOf("privilegedClient.rpc('request_commander_product_create'"))
  assert.doesNotMatch(create, /client\.rpc\('request_commander_product_create'/u)
  assert.match(create, /p_payment_product_code: masterData\.paymentProductCode/u)
  assert.match(create, /p_tax_rate_ids: masterData\.taxRateIds/u)
  assert.match(create, /p_id_check_ids: masterData\.idCheckIds/u)
  assert.match(create, /p_requested_by: normalizedUserId/u)
})

test('create has a narrow canonical browser contract and resolves native-simple fields on the server', () => {
  const createNormalizer = helper.slice(
    helper.indexOf('export function normalizeCreateRequest'),
    helper.indexOf('/** Queues only a server-resolved Commander native-simple-create job. */'),
  )
  const create = helper.slice(helper.indexOf('export async function requestCommanderProductCreate'), helper.indexOf('export async function getCommanderProductJob'))
  const departmentResolver = helper.slice(
    helper.indexOf('async function resolveCommanderCreateDepartment'),
    helper.indexOf('export async function resolveCommanderProductMasterData'),
  )
  const createDefaults = helper.slice(
    helper.indexOf('async function resolveCommanderCreateDefaults'),
    helper.indexOf('export function normalizeCreateRequest'),
  )
  const createSubmit = productsPage.slice(
    productsPage.indexOf('  const submitCommanderProductCreate = useCallback'),
    productsPage.indexOf('  const resetNewProductReviewModal = useCallback'),
  )

  assert.doesNotMatch(createNormalizer, /normalizeCommanderProductRequest\(/u)
  for (const key of ['store_id', 'product_id', 'requested_tax_category_id', 'requested_age_restriction_id', 'idempotency_key']) {
    assert.match(createNormalizer, new RegExp(`['"]${key}['"]`, 'u'))
  }
  for (const forbidden of ['requested_payment_product_code', 'requested_selling_unit', 'requested_max_qty_per_trans', 'requested_taxable_rebate', 'modifier']) {
    assert.doesNotMatch(createNormalizer, new RegExp(forbidden, 'u'))
    assert.doesNotMatch(createSubmit, new RegExp(forbidden, 'u'))
  }
  assert.match(create, /resolveCommanderCreateDepartment\(/u)
  assert.match(departmentResolver, /pos_catalog_source_department_definitions/u)
  assert.match(departmentResolver, /source_product_code_key/u)
  assert.match(departmentResolver, /maximum_quantity_per_transaction/u)
  assert.match(createDefaults, /pos_source_create_profiles/u)
  assert.match(createDefaults, /create_profile_version/u)
  assert.match(createDefaults, /NATIVE_SIMPLE_CREATE_V1_PROFILE/u)
  assert.doesNotMatch(createDefaults, /default_flag_sysids/u)
  assert.match(create, /p_modifier: createDefaults\.modifier/u)
  assert.match(create, /p_selling_unit: createDefaults\.sellingUnit/u)
  assert.match(create, /p_max_qty_per_trans: department\.maxQtyPerTrans/u)
  assert.match(create, /p_taxable_rebate: createDefaults\.taxableRebate/u)
  assert.match(create, /p_tax_rate_ids: masterData\.taxRateIds/u)
  assert.match(create, /p_id_check_ids: masterData\.idCheckIds/u)
  assert.match(migration, /v_profile\.create_profile_version/u)
  assert.match(migration, /v_profile\.default_flag_sysids/u)
})

test('Add Product keeps UPC Enter as read-only lookup and routes unlinked saves through the narrow create submitter', () => {
  const barcodeFlowStart = productForm.indexOf('const handleUpcKeyDown')
  const barcodeFlow = productForm.slice(barcodeFlowStart, productForm.indexOf('const barcodeBlocksSubmit', barcodeFlowStart))
  const save = productsPage.slice(productsPage.indexOf('  const saveProduct = async () => {'), productsPage.indexOf('  const handleProductImportFile = async'))
  const createSubmit = productsPage.slice(
    productsPage.indexOf('  const submitCommanderProductCreate = useCallback'),
    productsPage.indexOf('  const resetNewProductReviewModal = useCallback'),
  )

  assert.match(barcodeFlow, /event\.preventDefault\(\)/u)
  assert.match(barcodeFlow, /onUpcEnter\?\.\(event\.currentTarget\.value\)/u)
  assert.match(save, /submitCommanderProductCreate\(\{/u)
  assert.match(save, /requestedTaxCategoryId: product\.taxable \? selectedTaxOptions\[0\]\.id : null/u)
  assert.match(save, /requestedAgeRestrictionId: product\.ageVerification \? selectedAgeOptions\[0\]\.id : null/u)
  assert.ok(save.indexOf("modalMode === 'add'") < save.indexOf('submitCommanderProductCreate({'))
  assert.equal((createSubmit.match(/fetch\('\/api\/products\/commander-product'/gu) ?? []).length, 1)
})

test('service-role access stays in the server route and linked updates remain on the existing user-client path', () => {
  assert.doesNotMatch(productsPage, /getSupabaseAdmin|SUPABASE_SERVICE_ROLE_KEY/u)
  assert.doesNotMatch(productForm, /getSupabaseAdmin|SUPABASE_SERVICE_ROLE_KEY/u)
  assert.match(route, /linked\s*\? await requestCommanderProductUpdate\(\{ client, userId: user\.id, input \}\)/u)
  assert.match(route, /: await requestCommanderProductCreate\(\{ client, privilegedClient: getSupabaseAdmin\(\), userId: user\.id, input \}\)/u)
})

test('create jobs use the existing queue and link only in verified completion', () => {
  assert.match(migration, /'create_product'/u)
  assert.match(migration, /claim_commander_product_create_job/u)
  assert.match(migration, /report_commander_product_create_status/u)
  assert.match(migration, /p_status='completed'/u)
  assert.match(migration, /insert into public\.product_source_identities/u)
  assert.match(migration, /source_identity_conflict/u)
  assert.match(migration, /p_status='failed'/u)
})

test('create validation is additive and preserves strict update validation and leases', () => {
  assert.match(migration, /when p_operation::text = 'update_product' then[\s\S]*p_payload = jsonb_build_object\(/u)
  assert.match(migration, /operation::text in \('update_price', 'update_product', 'create_product'\)/u)
  assert.match(migration, /array_agg\(value order by value\)/u)
  assert.match(migration, /commander_department_mapping_ambiguous/u)
})

test('create payload validation is Postgres-compatible and report hashing remains schema-qualified', () => {
  const validatorStart = migration.indexOf('create or replace function public.pos_publish_payload_is_valid')
  const validator = migration.slice(
    validatorStart,
    migration.indexOf('alter table public.pos_publish_jobs drop constraint', validatorStart),
  )
  const report = migration.slice(
    migration.indexOf('create function public.report_commander_product_create_status'),
    migration.indexOf('revoke all on function public.request_commander_product_create'),
  )

  assert.doesNotMatch(migration, /jsonb_object_length\s*\(/u)
  assert.match(validator, /pg_catalog\.jsonb_object_keys\(/u)
  assert.match(validator, /pg_catalog\.jsonb_typeof\(p_payload\) = 'object'/u)
  assert.match(validator, /else '\{\}'::jsonb/u)
  assert.match(validator, /\) = 13/u)
  assert.match(report, /extensions\.digest\(v_job\.payload::text,'sha256'\)/u)
  assert.match(report, /security definer set search_path=pg_catalog,public/u)
})

test('connector path delegates create to the proven integration instead of a second XML writer', () => {
  assert.match(adapter, /executeProductCommand/u)
  assert.match(adapter, /async createProduct/u)
  assert.match(worker, /job\.operation === 'create_product'/u)
  assert.match(worker, /adapter\.createProduct/u)
  assert.match(edgeClaim, /claim_commander_product_create_job/u)
  assert.match(edgeReport, /report_commander_product_create_status/u)
  assert.doesNotMatch(worker, /buildCreateProductXml/u)
})

test('verified create completion refreshes once and surfaces the bounded success notice', () => {
  assert.match(productsPage, /json\.job\.operation === 'create_product'/u)
  assert.match(productsPage, /setCommanderProductCompletionMessage\('Product created in Commander\.'\)/u)
})

test('forward create RPC repair selects one UUID-safe eligible connector and retains service-only execute', () => {
  const requestStart = rpcFixMigration.indexOf('create or replace function public.request_commander_product_create(')
  const claimStart = rpcFixMigration.indexOf('create or replace function public.claim_commander_product_create_job')
  const request = rpcFixMigration.slice(requestStart, claimStart)

  assert.ok(requestStart >= 0 && claimStart > requestStart)
  assert.doesNotMatch(request, /min\s*\(\s*(?:id|connector\.id)\s*\)/iu)
  assert.match(request, /select count\(\*\) into v_count from public\.store_pos_connectors connector where connector\.store_id=p_store_id and connector\.status='active' and connector\.commander_status='connected';/u)
  assert.match(request, /if v_count <> 1 then raise exception/u)
  assert.match(request, /select connector\.id into v_connector_id from public\.store_pos_connectors connector where connector\.store_id=p_store_id and connector\.status='active' and connector\.commander_status='connected' order by connector\.id limit 1;/u)
  assert.match(rpcFixMigration, /revoke all on function public\.request_commander_product_create\([^\n]+\) from public,anon,authenticated;/u)
  assert.match(rpcFixMigration, /grant execute on function public\.request_commander_product_create\([^\n]+\) to service_role;/u)
})

test('forward create claim repair qualifies job columns and preserves create claim lifecycle', () => {
  const claimStart = rpcFixMigration.indexOf('create or replace function public.claim_commander_product_create_job')
  const claimEnd = rpcFixMigration.indexOf('revoke all on function public.request_commander_product_create', claimStart)
  const claim = rpcFixMigration.slice(claimStart, claimEnd)

  assert.ok(claimStart >= 0 && claimEnd > claimStart)
  assert.match(claim, /jobs\.assigned_connector_id=p_connector_id/u)
  assert.match(claim, /jobs\.store_id=v_store_id/u)
  assert.match(claim, /jobs\.operation='create_product'/u)
  assert.match(claim, /jobs\.status='pending'/u)
  assert.match(claim, /order by jobs\.created_at,jobs\.id for update skip locked limit 1/u)
  assert.match(claim, /set status='claimed',claimed_by_connector_id=p_connector_id,claimed_at=v_now,attempt_count=attempt_count\+1/u)
  assert.match(claim, /return query select v_job\.id,'create_product'/u)
  assert.match(rpcFixMigration, /revoke all on function public\.claim_commander_product_create_job\(uuid\) from public,anon,authenticated;/u)
  assert.match(rpcFixMigration, /grant execute on function public\.claim_commander_product_create_job\(uuid\) to service_role;/u)
  assert.doesNotMatch(rpcFixMigration, /request_commander_product_update|claim_pos_publish_job|report_pos_publish_job_status|update_price/u)
})

test('forward create report repair qualifies connector status and preserves create reporting lifecycle', () => {
  const reportStart = reportStatusFixMigration.indexOf('create or replace function public.report_commander_product_create_status(')
  assert.ok(reportStart >= 0)
  const report = reportStatusFixMigration.slice(reportStart)

  assert.match(report, /returns table\(job_id uuid,status text\) language plpgsql security definer set search_path=pg_catalog,public/u)
  assert.match(report, /select connector\.store_id into v_store_id from public\.store_pos_connectors connector where connector\.id=p_connector_id and connector\.status='active';/u)
  assert.doesNotMatch(report, /from public\.store_pos_connectors where id=p_connector_id and status='active'/u)
  assert.match(report, /if not found or v_job\.store_id<>v_store_id or v_job\.assigned_connector_id<>p_connector_id or v_job\.claimed_by_connector_id<>p_connector_id or v_job\.operation<>'create_product' then raise exception using errcode='42501'/u)
  assert.match(report, /if p_status='sending' and v_job\.status='claimed' then update public\.pos_publish_jobs set status='sending'/u)
  assert.match(report, /elsif p_status='verifying' and v_job\.status='sending' then update public\.pos_publish_jobs set status='verifying'/u)
  assert.match(report, /else raise exception using errcode='23514',message='publishing job completion verification is invalid';/u)
  for (const field of ['upc', 'modifier', 'description', 'department', 'price', 'payment_product_code', 'selling_unit', 'max_qty_per_trans', 'taxable_rebate', 'tax_rate_ids', 'id_check_ids', 'flag_ids']) {
    assert.match(report, new RegExp(`p_verification_${field}`, 'u'))
  }
  assert.match(report, /insert into public\.product_source_identities/u)
  assert.match(report, /set status='completed'/u)
  assert.doesNotMatch(report, /update_product|update_price|sendCommander|uPLUs|vPLUs/u)
})

test('create reporting RPC retains service-role-only execution from the applied create contract', () => {
  const signature = 'uuid,uuid,text,text,text,text,text,numeric,text,text,text,text,text[],text[],text[],text,text'
  const escaped = signature.replace(/[\[\]]/gu, '\\$&').replace(/,/gu, '\\s*,\\s*')
  const functionName = `public\\.report_commander_product_create_status\\(\\s*${escaped}\\s*\\)`
  assert.match(migration, new RegExp(`revoke all on function ${functionName} from public\\s*,\\s*anon\\s*,\\s*authenticated;`, 'u'))
  assert.match(migration, new RegExp(`grant execute on function ${functionName} to service_role;`, 'u'))
  assert.doesNotMatch(migration, new RegExp(`grant execute on function ${functionName} to (?:anon|authenticated)`, 'u'))
})
