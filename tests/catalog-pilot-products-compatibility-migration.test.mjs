import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(testDirectory, '..')

const baseProductsMigration = readFileSync(
  resolve(
    repositoryRoot,
    'supabase/migrations/20260619010910_create_storepulse_tables.sql',
  ),
  'utf8',
)
const compatibilityMigration = readFileSync(
  resolve(
    repositoryRoot,
    'supabase/migrations/20260804193000_add_products_promotion_compatibility.sql',
  ),
  'utf8',
)
const promotionMigration = readFileSync(
  resolve(
    repositoryRoot,
    'supabase/migrations/20260731190000_add_pos_catalog_pilot_promotion_rpc.sql',
  ),
  'utf8',
)

const promotionProductColumns = Object.freeze([
  'id',
  'store_id',
  'upc',
  'item_name',
  'category',
  'brand',
  'cost_price',
  'selling_price',
  'department',
  'is_active',
  'updated_at',
])

test('clean migration replay defines every products column used by the promotion RPC', () => {
  const cleanProductsSchema = `${baseProductsMigration}\n${compatibilityMigration}`

  for (const column of promotionProductColumns) {
    assert.match(
      cleanProductsSchema,
      new RegExp(`\\b${column}\\b`, 'i'),
      `clean products schema must define ${column}`,
    )
  }

  for (const column of promotionProductColumns) {
    assert.match(
      promotionMigration,
      new RegExp(`\\b${column}\\b`, 'i'),
      `promotion RPC must reference ${column}`,
    )
  }

  assert.match(compatibilityMigration, /add column if not exists item_name text/i)
  assert.match(compatibilityMigration, /add column if not exists department text/i)
  assert.match(
    compatibilityMigration,
    /add column if not exists is_active boolean not null default true/i,
  )
  assert.match(
    compatibilityMigration,
    /add column if not exists updated_at timestamptz not null default now\(\)/i,
  )
  assert.match(compatibilityMigration, /set item_name = nullif\(btrim\(name\), ''\)/i)
  assert.doesNotMatch(compatibilityMigration, /drop table|drop column|delete from/i)
})
