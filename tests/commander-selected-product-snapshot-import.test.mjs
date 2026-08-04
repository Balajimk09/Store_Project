import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  normalizeCommanderSnapshotRows,
  parseCommanderSnapshotImportCli,
  runCommanderSnapshotImportCli,
  validateCommanderSnapshot,
} from '../scripts/import-commander-selected-product-snapshot.mjs'

const STORE_ID = 'ec192877-0156-42ab-8fbf-31105f3e2ea3'

function product(upc, modifier = '000') {
  return {
    upc,
    modifier,
    description: 'Token certificate words are ordinary description text',
    price: '2.50',
    department: '10',
  }
}

function snapshot(products = [
  product('00000000000017'),
  product('00000000000024'),
  product('00000000034524'),
  product('00999999999993'),
]) {
  return JSON.stringify({ products })
}

function filesystem(text) {
  return {
    async lstat() {
      return {
        size: Buffer.byteLength(text),
        isFile: () => true,
        isSymbolicLink: () => false,
      }
    },
    async readFile() { return Buffer.from(text) },
  }
}

function args(...extra) {
  return ['--store-id', STORE_ID, ...extra]
}

test('Commander snapshot validation preserves ordered identities independent of product order', () => {
  const products = validateCommanderSnapshot(snapshot([
    product('00999999999993'),
    product('00000000034524'),
    product('00000000000017'),
    product('00000000000024'),
  ]), 4)
  assert.deepEqual(products.map((value) => value.sourceProductKey), [
    '00999999999993/000',
    '00000000034524/000',
    '00000000000017/000',
    '00000000000024/000',
  ])
  assert.equal(products[2].upc, '00000000000017')
  assert.equal(products[2].modifier, '000')

  const rows = normalizeCommanderSnapshotRows({
    storeId: STORE_ID,
    products,
    snapshotText: snapshot(products),
    now: new Date('2026-08-02T00:00:00.000Z'),
  })
  assert.equal(rows.length, 4)
  assert.ok(rows.every((row) => row.store_id === STORE_ID))
  assert.ok(rows.every((row) => row.source_system === 'commander'))
  assert.equal(rows[2].source_product_key, '00000000000017/000')
  assert.equal(rows[2].source_upc, '00000000000017')
  assert.equal(rows[2].source_modifier, '000')
})

test('Commander snapshot validator rejects malformed, secret-shaped, and duplicate source data', () => {
  const invalid = [
    [JSON.stringify({ products: [product('00000000000017')] }), 4],
    [snapshot([product('00000000000017'), product('00000000000017'), product('00000000034524'), product('00999999999993')]), 4],
    [snapshot([{ ...product('00000000000017'), upc: 17 }, product('00000000000024'), product('00000000034524'), product('00999999999993')]), 4],
    [snapshot([{ ...product('00000000000017'), modifier: 0 }, product('00000000000024'), product('00000000034524'), product('00999999999993')]), 4],
    [snapshot([{ ...product('00000000000017'), upc: '' }, product('00000000000024'), product('00000000034524'), product('00999999999993')]), 4],
    [snapshot([{ upc: '00000000000017', modifier: '000', description: 'missing price', department: '10' }, product('00000000000024'), product('00000000034524'), product('00999999999993')]), 4],
    [snapshot([{ ...product('00000000000017'), extra: 'ordinary extra field' }, product('00000000000024'), product('00000000034524'), product('00999999999993')]), 4],
    [snapshot([{ ...product('00000000000017'), price: '-1.00' }, product('00000000000024'), product('00000000034524'), product('00999999999993')]), 4],
    [snapshot([{ ...product('00000000000017'), cookie: 'secret' }, product('00000000000024'), product('00000000034524'), product('00999999999993')]), 4],
    [snapshot([{ ...product('00000000000017'), description: '<PLU>bad</PLU>' }, product('00000000000024'), product('00000000034524'), product('00999999999993')]), 4],
    [JSON.stringify({ products: [product('00000000000017'), product('00000000000024'), product('00000000034524'), product('00999999999993')], token: 'secret' }), 4],
  ]
  for (const [text, expectedCount] of invalid) {
    assert.throws(() => validateCommanderSnapshot(text, expectedCount), /snapshot_(invalid|count_invalid|identity_invalid)/)
  }
  assert.equal(validateCommanderSnapshot(snapshot([product('1'), product('2'), product('3')]), 3).length, 3)
})

test('dry run validates without Supabase credentials, a client, or network work', async () => {
  let output = ''
  const result = await runCommanderSnapshotImportCli({
    args: args('--dry-run'),
    filesystem: filesystem(snapshot()),
    environment: {},
    clientFactory() { throw new Error('client_must_not_initialize') },
    stdout: { write(value) { output += value } },
  })
  assert.deepEqual(result, {
    ok: true,
    dry_run: true,
    expected_count: 4,
    validated_count: 4,
    upserted_count: 0,
    store_id: STORE_ID,
    source_system: 'commander',
    error_code: null,
  })
  assert.doesNotMatch(output, /Token certificate|2\.50|00000000000017|secret/i)
})

test('apply performs one bounded source-scoped staging upsert and validates its returned count', async () => {
  const calls = []
  const client = {
    from(table) {
      calls.push(['from', table])
      return {
        upsert(rows, options) {
          calls.push(['upsert', rows, options])
          return { select() { return Promise.resolve({ data: rows.map((_, index) => ({ id: String(index) })), error: null }) } }
        },
      }
    },
  }
  const result = await runCommanderSnapshotImportCli({
    args: args('--apply'),
    filesystem: filesystem(snapshot()),
    environment: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(64),
    },
    clientFactory() { return client },
    stdout: { write() {} },
  })
  assert.equal(result.ok, true)
  assert.equal(result.upserted_count, 4)
  assert.deepEqual(calls.map(([kind]) => kind), ['from', 'upsert'])
  assert.equal(calls[0][1], 'pos_catalog_source_observations')
  assert.equal(calls[1][2].onConflict, 'store_id,source_system,source_product_key')
  assert.equal(calls[1][1].length, 4)
  assert.equal(calls.some((call) => /products|product_source_identities|delete|rpc/i.test(String(call[1]))), false)

  const partialClient = {
    from() { return { upsert() { return { select() { return Promise.resolve({ data: [{ id: '1' }], error: null }) } } } } },
  }
  const partial = await runCommanderSnapshotImportCli({
    args: args('--apply'),
    filesystem: filesystem(snapshot()),
    environment: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(64) },
    clientFactory() { return partialClient },
    stdout: { write() {} },
  })
  assert.equal(partial.error_code, 'staging_response_invalid')

  const failed = await runCommanderSnapshotImportCli({
    args: args('--apply'),
    filesystem: filesystem(snapshot()),
    environment: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(64) },
    clientFactory() {
      return {
        from() {
          return {
            upsert() {
              return {
                select() {
                  return Promise.resolve({
                    data: null,
                    error: { message: 'must not escape' },
                  })
                },
              }
            },
          }
        },
      }
    },
    stdout: { write() {} },
  })
  assert.equal(failed.error_code, 'staging_write_failed')
})

test('CLI requires a store UUID and source staging migration is isolated from product promotion tables', async () => {
  assert.equal(parseCommanderSnapshotImportCli([]).invalid, true)
  assert.equal(parseCommanderSnapshotImportCli(args('--expected-count', '3')).expectedCount, 3)
  assert.equal(parseCommanderSnapshotImportCli(args('--snapshot', 'relative.json')).invalid, true)
  assert.equal(parseCommanderSnapshotImportCli(args('--dry-run', '--apply')).invalid, true)

  const migration = await readFile(
    new URL('../supabase/migrations/20260802000000_create_pos_catalog_source_observations.sql', import.meta.url),
    'utf8',
  )
  assert.match(migration, /create table public\.pos_catalog_source_observations/i)
  assert.match(migration, /unique \(store_id, source_system, source_product_key\)/i)
  assert.match(migration, /source_upc text not null/i)
  assert.match(migration, /source_modifier text not null/i)
  assert.match(migration, /source_price numeric\(12,2\) not null/i)
  assert.match(migration, /check \(source_price >= 0/i)
  assert.doesNotMatch(migration, /alter table public\.(products|product_source_identities)/i)
  assert.doesNotMatch(migration, /drop table|delete from|truncate/i)

  const importer = await readFile(
    new URL('../scripts/import-commander-selected-product-snapshot.mjs', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(importer, /from\('products'\)|from\('product_source_identities'\)|\.rpc\(|\.delete\(/)
  assert.doesNotMatch(importer, /from ['"]\.\.\/connector|commander-vplu|four-product-read-child/)
})
