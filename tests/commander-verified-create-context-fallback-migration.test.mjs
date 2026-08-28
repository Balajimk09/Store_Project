import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260828015311_add_verified_create_product_context_fallback.sql', import.meta.url),
  'utf8',
)

function functionSource(name) {
  const startNeedle = `create or replace function public.${name}`
  const start = migration.indexOf(startNeedle)
  const end = migration.indexOf('create or replace function public.', start + startNeedle.length)
  assert.notEqual(start, -1, startNeedle)
  return migration.slice(start, end === -1 ? undefined : end)
}

const effectiveState = functionSource('commander_effective_product_state')
const fullState = functionSource('commander_effective_full_product_state')

test('current catalog context remains authoritative when it is newer than a verified create fallback', () => {
  assert.match(effectiveState, /current_catalog_observation/)
  assert.match(effectiveState, /catalog\.observed_at >= verified_create\.completed_at/)
  assert.match(effectiveState, /then catalog\.source_description/)
  assert.match(effectiveState, /then catalog\.source_department_key/)
  assert.match(effectiveState, /then catalog\.source_price/)
  assert.match(fullState, /then catalog\.payment_product_code/)
  assert.match(fullState, /then catalog\.flag_ids/)
})

test('a completed verified create can provide effective base and full context before catalog observation', () => {
  assert.match(effectiveState, /latest_verified_create_product/)
  assert.match(effectiveState, /left join current_catalog_observation catalog on true/)
  assert.match(effectiveState, /or verified_create\.completed_at is not null/)
  assert.match(effectiveState, /else verified_create\.verification_description/)
  assert.match(effectiveState, /else verified_create\.verification_department/)
  assert.match(effectiveState, /else verified_create\.verification_price/)
  for (const field of [
    'payment_product_code',
    'selling_unit',
    'max_qty_per_trans',
    'taxable_rebate',
    'tax_rate_ids',
    'id_check_ids',
    'flag_ids',
  ]) {
    assert.match(fullState, new RegExp(`job\\.payload ->> '${field}'|job\\.payload -> '${field}'`))
  }
})

test('only a completed create with a valid payload and exact verification identity can become context', () => {
  for (const source of [effectiveState, fullState]) {
    assert.match(source, /job\.operation::text = 'create_product'/)
    assert.match(source, /job\.status::text = 'completed'/)
    assert.match(source, /job\.completed_at is not null/)
    assert.match(source, /public\.pos_publish_payload_is_valid\(/)
    assert.match(source, /verification_upc' = (?:identity_row|base)\.source_upc/)
    assert.match(source, /verification_modifier' = (?:identity_row|base)\.source_modifier/)
    assert.match(source, /job\.payload ->> 'upc' = job\.audit_metadata ->> 'verification_upc'/)
    assert.match(source, /job\.payload ->> 'modifier' = job\.audit_metadata ->> 'verification_modifier'/)
    assert.match(source, /verification_description' = job\.payload ->> 'description'/)
    assert.match(source, /verification_department' = job\.payload ->> 'department'/)
    assert.match(source, /verification_price'\)::numeric = job\.requested_price/)
    assert.match(source, /job\.payload ->> 'price'\)::numeric = \(job\.audit_metadata ->> 'verification_price'\)::numeric/)
  }
})

test('pending, failed, and cancelled create jobs have no fallback path', () => {
  for (const source of [effectiveState, fullState]) {
    assert.match(source, /job\.status::text = 'completed'/)
    assert.doesNotMatch(source, /job\.status::text in \('pending', 'claimed', 'sending', 'verifying', 'failed', 'cancelled'\)/)
  }
})

test('verified create fallback preserves exact leading-zero identity and validates returned fields', () => {
  assert.match(effectiveState, /source_upc ~ '\^\[0-9\]\{14\}\$'/)
  assert.match(effectiveState, /source_modifier ~ '\^\[0-9\]\{3\}\$'/)
  assert.match(effectiveState, /source_product_key = identity_row\.source_upc \|\| '\/' \|\| identity_row\.source_modifier/)
  assert.match(fullState, /from public\.commander_effective_product_state\(p_store_id, p_product_id\)/)
  assert.match(effectiveState, /char_length\(job\.audit_metadata ->> 'verification_description'\) between 1 and 512/)
  assert.match(effectiveState, /verification_department' ~ '\^\[0-9\]\{1,16\}\$'/)
  assert.match(fullState, /public\.pos_publish_payload_is_valid\(/)
  assert.match(fullState, /array\(select jsonb_array_elements_text\(job\.payload -> 'flag_ids'\)\) as flag_ids/)
})

test('newer verified update_product and update_price state still supersede older create or catalog values', () => {
  assert.match(effectiveState, /job\.operation::text = 'update_product'/)
  assert.match(effectiveState, /job\.operation::text in \('update_price', 'update_product'\)/)
  assert.match(effectiveState, /verified_product\.completed_at > coalesce\(catalog\.observed_at, verified_create\.completed_at\)/)
  assert.match(effectiveState, /verified_price\.completed_at > coalesce\(catalog\.observed_at, verified_create\.completed_at\)/)
  assert.match(fullState, /job\.operation::text = 'update_product'/)
  assert.match(fullState, /verified\.completed_at > coalesce\(catalog\.observed_at, verified_create\.completed_at\)/)
})

test('catalog flags supersede verified create flags only after the catalog is at least as new', () => {
  assert.match(fullState, /when catalog\.observed_at is not null[\s\S]*?catalog\.observed_at >= verified_create\.completed_at[\s\S]*?then catalog\.flag_ids/)
  assert.match(fullState, /else verified_create\.flag_ids/)
})

test('the fallback migration changes only read-model functions and introduces no mutation or publishing path', () => {
  assert.equal((migration.match(/create or replace function public\./g) ?? []).length, 2)
  assert.doesNotMatch(migration, /\b(?:insert into|update public|delete from)\b/i)
  assert.doesNotMatch(migration, /\brpc\s*\(/i)
  assert.doesNotMatch(migration, /request_commander_product|report_commander_product|claim_commander_product/i)
})
