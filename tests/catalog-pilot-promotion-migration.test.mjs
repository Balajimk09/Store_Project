import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(testDirectory, '..')

const migration = readFileSync(
  resolve(
    repositoryRoot,
    'supabase/migrations/20260731190000_add_pos_catalog_pilot_promotion_rpc.sql',
  ),
  'utf8',
)

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length
}

test('promotion RPC accepts only a sync-run identifier and is service-role only', () => {
  assert.match(
    migration,
    /create or replace function public\.promote_pos_catalog_pilot_products\(\s*p_sync_run_id uuid\s*\)/i,
  )
  assert.match(migration, /language plpgsql[\s\S]*security invoker/i)
  assert.match(migration, /set search_path = ''/i)
  assert.match(
    migration,
    /revoke all on function public\.promote_pos_catalog_pilot_products\(uuid\)[\s\S]*from anon, authenticated;/i,
  )
  assert.match(
    migration,
    /grant execute on function public\.promote_pos_catalog_pilot_products\(uuid\)[\s\S]*to service_role;/i,
  )
  assert.doesNotMatch(
    migration,
    /p_(?:items|products|payload|description|price|department|category)\b/i,
  )
})

test('promotion remains selected-products only, incomplete-catalog, and limited to five', () => {
  assert.match(migration, /v_run\.import_mode <> 'selected_products'/i)
  assert.match(migration, /v_run\.catalog_complete <> false/i)
  assert.match(migration, /v_run\.selection_count > 5/i)
  assert.match(
    migration,
    /v_run\.received_product_count <> v_run\.selection_count/i,
  )
  assert.match(migration, /i\.source_modifier <> '000'/i)
  assert.doesNotMatch(migration, /full_catalog\s*'/i)
})

test('source values and UPC plus modifier identity must match the staged preview', () => {
  assert.match(
    migration,
    /'upc:' \|\| i\.source_upc \|\| '\|modifier:' \|\| i\.source_modifier/i,
  )
  assert.match(
    migration,
    /i\.source_values ->> 'sourceProductKey'[\s\S]*is distinct from i\.source_product_key/i,
  )
  assert.match(
    migration,
    /i\.source_values ->> 'payloadHash'[\s\S]*is distinct from i\.source_payload_hash/i,
  )
  assert.match(
    migration,
    /coalesce\([\s\S]*jsonb_typeof\(i\.source_values -> 'description'\)[\s\S]*\) <> 'string'/i,
  )
  assert.match(
    migration,
    /jsonb_typeof\(i\.source_values -> 'retailPrice'\)[\s\S]*not in \('number', 'null'\)/i,
  )
})

test('required staged identity fields fail closed under PostgreSQL NULL semantics', () => {
  assert.match(
    migration,
    /i\.source_system is distinct from v_run\.source_system/i,
  )
  assert.match(
    migration,
    /i\.source_modifier is null[\s\S]*i\.source_modifier <> '000'/i,
  )
  assert.match(
    migration,
    /i\.source_values ->> 'sourceSystem'[\s\S]*is distinct from v_run\.source_system/i,
  )
  assert.match(
    migration,
    /i\.source_values ->> 'sourceProductKey'[\s\S]*is distinct from i\.source_product_key/i,
  )
  assert.match(
    migration,
    /i\.source_values ->> 'upc'[\s\S]*is distinct from i\.source_upc/i,
  )
  assert.match(
    migration,
    /i\.source_values ->> 'modifier'[\s\S]*is distinct from i\.source_modifier/i,
  )
  assert.match(
    migration,
    /i\.source_values ->> 'payloadHash'[\s\S]*is distinct from i\.source_payload_hash/i,
  )
  assert.match(
    migration,
    /coalesce\([\s\S]*char_length\(i\.source_values ->> 'description'\)[\s\S]*0[\s\S]*\) not between 1 and 512/i,
  )
})

test('dynamic Commander values map to products without caller-provided values', () => {
  assert.match(
    migration,
    /v_description := v_source_values ->> 'description'/i,
  )
  assert.match(
    migration,
    /v_department := coalesce\([\s\S]*departmentName[\s\S]*departmentNumber/i,
  )
  assert.match(
    migration,
    /v_category := coalesce\([\s\S]*categoryName[\s\S]*categoryNumber/i,
  )
  assert.match(
    migration,
    /v_retail_price := case[\s\S]*retailPrice/i,
  )
  assert.match(
    migration,
    /insert into public\.products \([\s\S]*item_name[\s\S]*selling_price/i,
  )
  assert.match(
    migration,
    /update public\.products p[\s\S]*item_name = v_description/i,
  )
})

test('promotion atomically links product, identity, sync item, history, and run', () => {
  assert.equal(
    countMatches(migration, /insert into public\.products \(/gi),
    1,
  )
  assert.equal(
    countMatches(
      migration,
      /insert into public\.product_source_identities \(/gi,
    ),
    1,
  )
  assert.equal(
    countMatches(
      migration,
      /update public\.pos_catalog_sync_items i/gi,
    ),
    1,
  )
  assert.equal(
    countMatches(migration, /insert into public\.product_history \(/gi),
    1,
  )
  assert.equal(
    countMatches(migration, /update public\.pos_catalog_sync_runs r/gi),
    1,
  )
  assert.match(
    migration,
    /reconciliation_status = 'in_sync'/i,
  )
  assert.match(migration, /resolution = 'promoted'/i)
  assert.match(migration, /status = 'completed'/i)
})

test('existing identities and UPC matches update instead of duplicating products', () => {
  assert.match(
    migration,
    /from public\.product_source_identities psi[\s\S]*source_product_key = v_expected_source_key[\s\S]*for update/i,
  )
  assert.match(
    migration,
    /from public\.products p[\s\S]*p\.upc = v_item\.source_upc[\s\S]*for update/i,
  )
  assert.match(
    migration,
    /on conflict \(\s*store_id,\s*source_system,\s*source_product_key\s*\)/i,
  )
  assert.match(
    migration,
    /catalog_pilot_product_identity_conflict/i,
  )
})

test('a completed promotion retry returns stored counts without writing again', () => {
  assert.match(
    migration,
    /v_run\.status = 'completed'[\s\S]*catalog_pilot_promoted/i,
  )
  assert.match(
    migration,
    /promotion_promoted_count/i,
  )
  assert.ok(
    migration.indexOf("v_run.status = 'completed'")
      < migration.indexOf("insert into public.products"),
  )
})

test('RPC contains no Commander transport, publishing, destructive SQL, or dynamic SQL', () => {
  assert.doesNotMatch(
    migration,
    /\buPLUs\b|sendCommanderNaxml|readCommanderProduct|https?:\/\/|node:https|connector_token/i,
  )
  assert.doesNotMatch(
    migration,
    /\btruncate\b|\bdrop table\b|\bdelete\s+from\s+public\.products\b/i,
  )
  assert.doesNotMatch(
    migration,
    /\bexecute\s+format\b|\bdblink\b|\bhttp_(?:get|post)\b/i,
  )
  assert.doesNotMatch(
    migration,
    /automatic_publishing_enabled'\)::boolean,\s*false\s*\)\s*=\s*true/i,
  )
})
