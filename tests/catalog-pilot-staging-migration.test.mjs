import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(testDirectory, '..')

const stagingMigration = readFileSync(
  resolve(
    repositoryRoot,
    'supabase/migrations/20260731021608_add_pos_catalog_pilot_staging.sql',
  ),
  'utf8',
)

const followUpMigration = readFileSync(
  resolve(
    repositoryRoot,
    'supabase/migrations/20260731032716_repair_pos_catalog_pilot_updated_at_trigger.sql',
  ),
  'utf8',
)

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length
}

test('catalog staging migration uses legacy updated_at triggers before the follow-up repair', () => {
  assert.match(
    stagingMigration,
    /execute function public\.set_updated_at\(\);/i,
  )

  assert.match(
    followUpMigration,
    /create or replace function public\.set_pos_catalog_updated_at\(\)/i,
  )

  assert.match(
    followUpMigration,
    /execute function public\.set_pos_catalog_updated_at\(\);/i,
  )
})

test('follow-up migration safely replaces only the three catalog pilot triggers', () => {
  assert.match(
    followUpMigration,
    /create or replace function public\.set_pos_catalog_updated_at\(\)/i,
  )
  assert.match(followUpMigration, /security invoker/i)
  assert.match(followUpMigration, /set search_path = ''/i)

  assert.equal(
    countMatches(
      followUpMigration,
      /drop trigger if exists (?:pos_catalog_sync_runs_set_updated_at|pos_catalog_sync_items_set_updated_at|product_source_identities_set_updated_at)/g,
    ),
    3,
  )

  assert.equal(
    countMatches(
      followUpMigration,
      /execute function public\.set_pos_catalog_updated_at\(\);/g,
    ),
    3,
  )

  assert.equal(
    /(?:insert|update|delete)\s+(?:into|from)?\s*public\.products/i.test(
      followUpMigration,
    ),
    false,
  )
})
