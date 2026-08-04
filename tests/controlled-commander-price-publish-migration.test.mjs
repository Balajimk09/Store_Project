import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationPath = new URL('../supabase/migrations/20260804000000_generalize_commander_manual_price_publish.sql', import.meta.url)

test('migration defines an owner-only generic request RPC backed by an exact Commander source identity', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /create or replace function public\.request_commander_price_update/)
  assert.match(sql, /auth\.uid\(\)/)
  assert.match(sql, /store\.owner_id = v_user_id/)
  assert.match(sql, /identity\.source_system = 'commander'/)
  assert.match(sql, /identity\.source_upc ~ '\^\[0-9\]\{14\}\$'/)
  assert.match(sql, /identity\.source_modifier ~ '\^\[0-9\]\{3\}\$'/)
  assert.match(sql, /identity\.source_product_key = identity\.source_upc \|\| '\/' \|\| identity\.source_modifier/)
  assert.match(sql, /v_observation\.source_price is distinct from p_expected_price/)
  assert.match(sql, /pos_publish_jobs_active_store_product_uidx/)
  assert.match(sql, /grant execute on function public\.request_commander_price_update[^;]+to authenticated/)
})

test('claim and completion propagate exact UPC/modifier identity and persist only verified data', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /returns table \([\s\S]*?upc text,[\s\S]*?modifier text,[\s\S]*?expected_price text,[\s\S]*?price text/)
  assert.match(sql, /v_identity\.source_upc, v_identity\.source_modifier/)
  assert.match(sql, /p_verification_modifier text default null/)
  assert.match(sql, /p_verification_modifier is null or p_verification_modifier !~ '\^\[0-9\]\{3\}\$'/)
  const completion = sql.slice(sql.indexOf("elsif p_status = 'completed'"), sql.indexOf('  else', sql.indexOf("elsif p_status = 'completed'")))
  assert.match(completion, /update public\.products set selling_price = v_job\.requested_price/)
  assert.match(completion, /update public\.pos_catalog_source_observations[\s\S]*?set source_price = v_job\.requested_price/)
  assert.match(completion, /p_verification_upc is distinct from v_identity\.source_upc/)
  assert.match(completion, /p_verification_modifier is distinct from v_identity\.source_modifier/)
})

test('migration cannot create, delete, bulk-publish, or retain Commander secrets', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.doesNotMatch(sql, /create_product|delete_product|bulk|session_cookie|commander_username|commander_password|certificate_path|raw_xml|request_xml|response_xml|https?:\/\//i)
  assert.match(sql, /operation, status,[\s\S]*?'update_price', 'pending'/)
  assert.match(sql, /p_expected_price <= 0/)
  assert.match(sql, /p_requested_price <= 0/)
})
