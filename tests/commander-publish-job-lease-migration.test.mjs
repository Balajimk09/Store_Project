import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(new URL('../supabase/migrations/20260817023000_add_commander_publish_job_leases.sql', import.meta.url), 'utf8')

test('Commander publish leases expire stale jobs to terminal failed without automatic requeue', () => {
  assert.match(migration, /status\s*=\s*'failed'/)
  assert.match(migration, /'failure_code',\s*'job_expired'/)
  assert.match(migration, /status::text\s*=\s*'pending'[\s\S]*interval '60 minutes'/)
  assert.match(migration, /status::text in \('claimed', 'sending', 'verifying'\)[\s\S]*interval '30 minutes'/)
  assert.doesNotMatch(migration, /set[\s\S]{0,120}status\s*=\s*'pending'[\s\S]{0,120}claimed_by_connector_id\s*=\s*null/i)
})

test('owner cleanup is store-scoped and verifies ownership before delegating', () => {
  assert.match(migration, /create or replace function public\.expire_stale_commander_publish_jobs\(\s*p_store_id uuid/)
  assert.match(migration, /store\.id\s*=\s*p_store_id[\s\S]*store\.owner_id\s*=\s*auth\.uid\(\)/)
  assert.match(migration, /raise exception using errcode = '42501', message = 'store access denied'/)
  assert.match(migration, /grant execute on function public\.expire_stale_commander_publish_jobs\(uuid\)\s*to authenticated/)
})

test('connector cleanup derives the store from the active connector and is service-role only', () => {
  assert.match(migration, /create or replace function public\.expire_stale_commander_publish_jobs_for_connector/)
  assert.match(migration, /connector\.id\s*=\s*p_connector_id[\s\S]*connector\.status\s*=\s*'active'/)
  assert.match(migration, /revoke all on function public\.expire_stale_commander_publish_jobs_for_connector\(uuid\)\s*from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.expire_stale_commander_publish_jobs_for_connector\(uuid\)\s*to service_role/)
})

test('full-product request fields are immutable after insertion', () => {
  for (const column of [
    'expected_payment_product_code',
    'requested_payment_product_code',
    'expected_selling_unit',
    'requested_selling_unit',
    'expected_max_qty_per_trans',
    'requested_max_qty_per_trans',
    'expected_taxable_rebate',
    'requested_taxable_rebate',
    'expected_tax_rate_ids',
    'requested_tax_rate_ids',
    'expected_id_check_ids',
    'requested_id_check_ids',
  ]) {
    assert.match(migration, new RegExp(`new\\.${column} is distinct from old\\.${column}`))
  }
})

test('verification columns are writable only on verifying to completed and immutable after terminal state', () => {
  assert.match(migration, /and not \(old\.status = 'verifying' and new\.status = 'completed'\)/)
  for (const column of [
    'verification_payment_product_code',
    'verification_selling_unit',
    'verification_max_qty_per_trans',
    'verification_taxable_rebate',
    'verification_tax_rate_ids',
    'verification_id_check_ids',
  ]) {
    const occurrences = [...migration.matchAll(new RegExp(`new\\.${column} is distinct from old\\.${column}`, 'g'))]
    assert.ok(occurrences.length >= 2, `${column} should be guarded both generally and for terminal rows`)
  }
})

test('pending lease expiry is a narrowly allowed pre-claim failure code', () => {
  assert.match(migration, /old\.status = 'pending' and new\.status = 'failed'[\s\S]*'job_expired'/)
  assert.match(migration, /new\.claimed_by_connector_id is not null[\s\S]*new\.claimed_at is not null[\s\S]*new\.failed_at is null/)
})
