import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SELECTED_PRODUCT_SNAPSHOT_FIXED_PATHS,
  selectedProductSnapshotPackageContextFromModuleUrl,
  validateSelectedProductSnapshotMachineConfig,
  selectedProductSnapshotPackagePaths,
  writeFixedSelectedProductSnapshot,
} from '../lib/commander/maintenance/create-selected-product-snapshot-export-dependencies.mjs'
import {
  parseSelectedProductSnapshotExportCli,
  runSelectedProductSnapshotExportCli,
  selectedProductSnapshotExportExitCode,
} from '../maintenance/run-selected-product-snapshot-export.mjs'

function fileInfo(size = 10) {
  return {
    size,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    isReparsePoint: () => false,
  }
}

function directoryInfo() {
  return {
    size: 0,
    isFile: () => false,
    isDirectory: () => true,
    isSymbolicLink: () => false,
    isReparsePoint: () => false,
  }
}

test('runtime paths are fixed and package-owned', () => {
  const context = selectedProductSnapshotPackageContextFromModuleUrl(
    'file:///C:/StorePulsePackage/Connector/maintenance/run-selected-product-snapshot-export.mjs',
    'win32',
  )
  assert.deepEqual(context, {
    packageRoot: 'C:\\StorePulsePackage',
    connectorDirectory: 'Connector',
  })
  assert.deepEqual(selectedProductSnapshotPackagePaths(context), {
    cookieWorkerPath:
      'C:\\StorePulsePackage\\CommanderDiagnostics\\commander-auth-cookie-worker.ps1',
    selectionArtifactPath:
      'C:\\StorePulsePackage\\Connector\\research\\pilot\\commander-pilot-selected-products.json',
  })
  assert.equal(
    SELECTED_PRODUCT_SNAPSHOT_FIXED_PATHS.outboxPath,
    'C:\\ProgramData\\StorePulse\\catalog-pilot\\outbox',
  )
})

test('fixed writer creates hash-named snapshot and accepts identical retry', async () => {
  const hash = 'a'.repeat(64)
  const contents = '{"ok":true}\n'
  const writes = []
  const renames = []
  let finalExists = false

  const filesystem = {
    async mkdir() {},
    async lstat(target) {
      if (target.endsWith('.tmp')) {
        return fileInfo(Buffer.byteLength(contents))
      }
      if (target.endsWith(`${hash}.json`)) {
        if (!finalExists) {
          const error = new Error('missing')
          error.code = 'ENOENT'
          throw error
        }
        return fileInfo(Buffer.byteLength(contents))
      }
      return directoryInfo()
    },
    async readFile() {
      return Buffer.from(contents)
    },
    async writeFile(target, value, options) {
      writes.push({ target, value: value.toString('utf8'), options })
    },
    async rename(from, to) {
      renames.push({ from, to })
      finalExists = true
    },
    async unlink() {},
  }

  const first = await writeFixedSelectedProductSnapshot({
    contents,
    snapshotHash: hash,
    filesystem,
    randomId: () => '11111111-1111-4111-8111-111111111111',
  })
  const second = await writeFixedSelectedProductSnapshot({
    contents,
    snapshotHash: hash,
    filesystem,
    randomId: () => '22222222-2222-4222-8222-222222222222',
  })

  assert.equal(first.written, true)
  assert.deepEqual(second, first)
  assert.equal(writes.length, 1)
  assert.equal(renames.length, 1)
  assert.match(first.location, new RegExp(`${hash}\\.json$`))
})

test('CLI accepts only the exact supervised read-only approval', async () => {
  const args = [
    '--operation',
    'export_selected_products_snapshot',
    '--approve',
    'export_selected_products_snapshot',
    '--supervised',
    '--read-only',
    '--selected-products-reviewed',
  ]
  assert.equal(parseSelectedProductSnapshotExportCli(args).cli_invalid, false)
  assert.equal(
    parseSelectedProductSnapshotExportCli([...args, '--path']).cli_invalid,
    true,
  )

  let input
  let output = ''
  const result = await runSelectedProductSnapshotExportCli({
    args,
    dependencyFactory: () => ({
      async executeSelectedProductSnapshotExport(value) {
        input = value
        return {
          ok: true,
          read_only: true,
          snapshot_written: true,
          selection_count: 4,
          received_product_count: 4,
          snapshot_hash: 'a'.repeat(64),
          safe_error_code: null,
        }
      },
    }),
    stdout: { write(value) { output += value } },
  })

  assert.equal(result.ok, true)
  assert.equal(input.approval.read_only, true)
  assert.doesNotMatch(
    output,
    /password|cookie|description|retail_price|source_values/i,
  )
})

test('invalid CLI performs no dependency work', async () => {
  let calls = 0
  const result = await runSelectedProductSnapshotExportCli({
    args: ['--operation', 'export_selected_products_snapshot'],
    dependencyFactory: () => {
      calls += 1
      return {}
    },
    stdout: { write() {} },
  })
  assert.equal(result.safe_error_code, 'invalid_input')
  assert.equal(calls, 0)
})
test('missing publishing flag is normalized to disabled', () => {
  const config = validateSelectedProductSnapshotMachineConfig(
    JSON.stringify({
      commander_ip: '192.168.31.11',
      source_store_number: 'AB123',
    }),
  )

  assert.equal(config.pos_publish_enabled, false)
})

test('explicit false publishing flag remains accepted', () => {
  const config = validateSelectedProductSnapshotMachineConfig(
    JSON.stringify({
      commander_ip: '192.168.31.11',
      source_store_number: 'AB123',
      pos_publish_enabled: false,
    }),
  )

  assert.equal(config.pos_publish_enabled, false)
})

test('enabled or non-boolean publishing flags fail closed', () => {
  for (const value of [true, 'false', 0, null]) {
    assert.throws(
      () => validateSelectedProductSnapshotMachineConfig(
        JSON.stringify({
          commander_ip: '192.168.31.11',
          source_store_number: 'AB123',
          pos_publish_enabled: value,
        }),
      ),
      /machine_config_invalid/,
    )
  }
})

test('safe exporter failures produce a nonzero process exit code', () => {
  assert.equal(selectedProductSnapshotExportExitCode({ ok: true }), 0)
  assert.equal(selectedProductSnapshotExportExitCode({ ok: false }), 1)
  assert.equal(selectedProductSnapshotExportExitCode(undefined), 1)
})

test('authentication failure remains secret-free and unsuccessful', async () => {
  let output = ''
  const result = await runSelectedProductSnapshotExportCli({
    args: [
      '--operation',
      'export_selected_products_snapshot',
      '--approve',
      'export_selected_products_snapshot',
      '--supervised',
      '--read-only',
      '--selected-products-reviewed',
    ],
    dependencyFactory: () => ({
      executeSelectedProductSnapshotExport: async () => ({
        ok: false,
        read_only: true,
        snapshot_written: false,
        selection_count: 4,
        received_product_count: 0,
        safe_error_code: 'commander_authentication_failed',
      }),
    }),
    stdout: {
      write(value) {
        output += value
      },
    },
  })

  assert.equal(result.ok, false)
  assert.equal(selectedProductSnapshotExportExitCode(result), 1)
  assert.doesNotMatch(
    output,
    /password|cookie|commander_username|commander_password|connector_token/i,
  )
})