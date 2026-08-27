import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const prerequisiteUrl = new URL('../supabase/migrations/20260810230000_add_store_product_master_data_prerequisites.sql', import.meta.url)
const mappingsUrl = new URL('../supabase/migrations/20260810234653_add_commander_master_data_canonical_mappings.sql', import.meta.url)

test('Store Settings master-data prerequisites precede Commander canonical mappings', async () => {
  const [prerequisiteSql, mappingsSql] = await Promise.all([
    readFile(prerequisiteUrl, 'utf8'),
    readFile(mappingsUrl, 'utf8'),
  ])

  assert.ok('20260810230000' < '20260810234653')
  const expectedColumns = {
    tax_categories: ['id', 'store_id', 'name', 'rate', 'description', 'is_default', 'is_active', 'created_at', 'updated_at'],
    store_age_restriction_presets: ['id', 'store_id', 'name', 'minimum_age', 'restriction_type', 'is_active', 'created_at', 'updated_at'],
    store_departments: ['id', 'store_id', 'name', 'description', 'default_tax_rate', 'ebt_eligible', 'is_active', 'tax_category_id', 'age_restriction_id', 'created_at', 'updated_at'],
    store_categories: ['id', 'store_id', 'name', 'department_id', 'ebt_eligible', 'is_active', 'tax_category_id', 'age_restriction_id', 'created_at', 'updated_at'],
  }
  for (const [table, columns] of Object.entries(expectedColumns)) {
    assert.match(prerequisiteSql, new RegExp(`create table if not exists public\\.${table} \\(`, 'u'))
    assert.match(mappingsSql, new RegExp(`public\\.${table}`, 'u'))
    for (const column of columns) {
      assert.match(prerequisiteSql, new RegExp(`\\n  ${column} `, 'u'))
    }
  }

  assert.match(prerequisiteSql, /unique \(store_id, name\)/u)
  assert.match(mappingsSql, /references public\.tax_categories\(id, store_id\)/u)
  assert.match(mappingsSql, /references public\.store_age_restriction_presets\(id, store_id\)/u)
  assert.match(mappingsSql, /references public\.store_departments\(id, store_id\)/u)
  assert.match(mappingsSql, /references public\.store_categories\(id, store_id\)/u)
  assert.doesNotMatch(prerequisiteSql, /drop table|delete from|truncate /iu)
})
