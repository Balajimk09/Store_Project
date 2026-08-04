import assert from 'node:assert/strict'
import test from 'node:test'

import {
  catalogPilotLocalImportFixedPaths,
  parseCatalogPilotLocalImportCli,
  parseFixedLocalEnvironment,
  runCatalogPilotLocalImportCli,
} from '../scripts/import-commander-selected-product-snapshot.mjs'
import {
  createCatalogPilotSnapshot,
  serializeCatalogPilotSnapshot,
} from '../lib/pos/catalog-pilot-snapshot.mjs'

const args = [
  '--operation',
  'import_selected_products_snapshot',
  '--approve',
  'import_selected_products_snapshot',
  '--supervised',
  '--apply-products',
  '--selected-products-reviewed',
]

function info(size) {
  return {
    size,
    isFile: () => true,
    isSymbolicLink: () => false,
    isReparsePoint: () => false,
  }
}

function snapshotText() {
  return serializeCatalogPilotSnapshot(
    createCatalogPilotSnapshot({
      storeId: 'ec192877-0156-42ab-8fbf-31105f3e2ea3',
      ownerId: 'c702332a-9299-4b1a-9583-a01302bd7b4a',
      sourceStoreNumber: 'AB123',
      capturedAt: '2026-07-31T19:00:00.000Z',
      selectedProducts: [{
        upc: '00999999999993',
        modifier: '000',
      }],
      products: [{
        sourceSystem: 'verifone_commander',
        sourceStoreNumber: 'AB123',
        sourceProductKey: 'upc:00999999999993|modifier:000',
        upc: '00999999999993',
        modifier: '000',
        description: 'Dynamic',
        retailPrice: 1,
        cost: null,
        departmentNumber: null,
        departmentName: null,
        categoryNumber: null,
        categoryName: null,
        taxNumber: null,
        taxName: null,
        ageRestriction: null,
        active: null,
        payloadHash: 'a'.repeat(64),
      }],
    }),
  )
}

test('local importer CLI is exact and requires apply-products', () => {
  assert.equal(parseCatalogPilotLocalImportCli(args).cliInvalid, false)
  assert.equal(
    parseCatalogPilotLocalImportCli(
      args.filter((value) => value !== '--apply-products'),
    ).cliInvalid,
    true,
  )
})

test('local environment parser accepts only the expected project', () => {
  const key = 's'.repeat(64)
  const value = parseFixedLocalEnvironment(
    `NEXT_PUBLIC_SUPABASE_URL=https://kurnxpzcgcvsjmxsqjok.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=${key}\n`,
  )
  assert.equal(value.serviceRoleKey, key)
  assert.throws(
    () => parseFixedLocalEnvironment(
      `NEXT_PUBLIC_SUPABASE_URL=https://wrong.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=${key}\n`,
    ),
    /local_environment_invalid/,
  )
})

test('fixed importer paths accept no caller path', () => {
  const fixed = catalogPilotLocalImportFixedPaths(
    'file:///C:/Repo/scripts/import-commander-selected-product-snapshot.mjs',
    'win32',
  )
  assert.equal(fixed.environmentPath, 'C:\\Repo\\.env.local')
  assert.equal(
    fixed.snapshotPath,
    'C:\\Repo\\connector\\research\\pilot\\input\\commander-selected-products-snapshot.json',
  )
})

test('runtime reads fixed files, resolves identity, and imports once', async () => {
  const environment =
    'NEXT_PUBLIC_SUPABASE_URL=https://kurnxpzcgcvsjmxsqjok.supabase.co\n'
    + `SUPABASE_SERVICE_ROLE_KEY=${'s'.repeat(64)}\n`
  const snapshot = snapshotText()
  let clientFactoryArgs
  let resolverCalls = 0
  let importerCalls = 0
  let output = ''

  const filesystem = {
    async lstat(target) {
      return info(Buffer.byteLength(
        target.endsWith('.env.local') ? environment : snapshot,
      ))
    },
    async readFile(target) {
      return Buffer.from(
        target.endsWith('.env.local') ? environment : snapshot,
      )
    },
  }

  const result = await runCatalogPilotLocalImportCli({
    args,
    moduleUrl:
      'file:///C:/Repo/scripts/import-commander-selected-product-snapshot.mjs',
    platform: 'win32',
    filesystem,
    clientFactory(url, key) {
      clientFactoryArgs = { url, key }
      return { rpc() {} }
    },
    async identityResolver({ snapshot: parsed }) {
      resolverCalls += 1
      return {
        ownerId: parsed.ownerId,
        connector: {
          id: 'c91205c3-9c88-4f5c-942a-58ae49800cd2',
          storeId: parsed.storeId,
          sourceSystem: parsed.sourceSystem,
          sourceStoreNumber: parsed.sourceStoreNumber,
        },
      }
    },
    async importer(value) {
      importerCalls += 1
      assert.equal(value.snapshotText, snapshot)
      return {
        ok: true,
        selected_products_only: true,
        preview_created: true,
        promotion_completed: true,
        sync_run_id: '11111111-1111-4111-8111-111111111111',
        snapshot_hash: 'a'.repeat(64),
        selection_count: 1,
        promoted_count: 1,
        created_count: 1,
        updated_count: 0,
        unchanged_count: 0,
        safe_error_code: null,
      }
    },
    stdout: { write(value) { output += value } },
  })

  assert.equal(result.ok, true)
  assert.equal(resolverCalls, 1)
  assert.equal(importerCalls, 1)
  assert.equal(
    clientFactoryArgs.url,
    'https://kurnxpzcgcvsjmxsqjok.supabase.co',
  )
  assert.equal(clientFactoryArgs.key, 's'.repeat(64))
  assert.doesNotMatch(output, /ssssssss|Dynamic/)
})

test('invalid CLI reads no files and creates no client', async () => {
  let work = 0
  const result = await runCatalogPilotLocalImportCli({
    args: ['--operation', 'import_selected_products_snapshot'],
    filesystem: {
      async lstat() { work += 1 },
      async readFile() { work += 1 },
    },
    clientFactory() {
      work += 1
      return {}
    },
    stdout: { write() {} },
  })
  assert.equal(result.safe_error_code, 'invalid_input')
  assert.equal(work, 0)
})
