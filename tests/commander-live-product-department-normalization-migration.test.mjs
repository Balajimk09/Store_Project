import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260811004034_normalize_live_commander_product_departments.sql', import.meta.url)
const uuidFixUrl = new URL('../supabase/migrations/20260810235510_fix_commander_master_data_uuid_aggregate.sql', import.meta.url)

test('live product department migration normalizes current Commander rows without creating department zero', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  assert.match(sql, /new\.source_department_key := case when v_department_number = '0' then null else v_department_number end/iu)
  assert.match(sql, /new\.source_department_id := null/iu)
  assert.match(sql, /observation\.last_seen_sync_run_id is not null/iu)
  assert.match(sql, /current_run\.status = 'completed'/iu)
  assert.match(sql, /catalog_contract' = 'live_source_catalog_v1'/iu)
  assert.match(sql, /not exists \([\s\S]*?newer_run/iu)
  assert.doesNotMatch(sql, /insert into public\.products|product_source_identities|pos_publish_jobs|uPLUs/iu)
})

test('local master-data promotion migration reproduces the already-live UUID-safe aggregate correction only', async () => {
  const sql = await readFile(uuidFixUrl, 'utf8')
  assert.match(sql, /pg_get_functiondef\(/iu)
  assert.match(sql, /array_agg\(m\.canonical_tax_category_id order by m\.canonical_tax_category_id\)\)\[1\]/iu)
  assert.match(sql, /array_agg\(m\.canonical_age_restriction_id order by m\.canonical_age_restriction_id\)\)\[1\]/iu)
  assert.match(sql, /master_data_mapping_uuid_aggregate_predecessor_invalid/iu)
  assert.doesNotMatch(sql, /public\.products|pos_publish_jobs|uPLUs|https?:\/\//iu)
})
