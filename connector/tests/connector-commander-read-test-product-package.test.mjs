import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const connectorRoot = path.resolve('connector')
const staging = path.join(connectorRoot, 'build', 'connector-commander-read-test-product-4951ceac')
const manifestPath = path.join(staging, 'manifest.json')

test('read-test-product bundle is an exact read-only closure with matching source and manifest hashes', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.package_purpose, 'connector_integrated_read_test_product')
  assert.equal(manifest.allowed_operation, 'read_test_product')
  assert.equal(manifest.runtime_file_count, 2)
  assert.equal(manifest.package_file_count, 4)
  const paths = manifest.runtime_files.map(entry => entry.path)
  assert.equal(paths.some(entry => entry.startsWith('service/')), false)
  assert.equal(paths.some(entry => /run-connector-commander-read-test-product\.mjs|commander-auth-cookie-worker|commander-cookie-auth-provider|commander-session-manager|capture-commander-validate/.test(entry)), false)
  for (const entry of manifest.runtime_files) {
    const [source, packaged] = await Promise.all([readFile(path.join(connectorRoot, entry.path)), readFile(path.join(staging, entry.path))])
    assert.deepEqual(packaged, source)
    assert.equal(packaged.length, entry.size_bytes)
    assert.equal(createHash('sha256').update(packaged).digest('hex'), entry.sha256)
  }
  const runner = await readFile(path.join(staging, 'maintenance', 'run-connector-commander-read-test-product.ps1'), 'utf8')
  assert.match(runner, /read_test_product/)
  assert.match(runner, /\$installedConnector = 'C:\\Program Files\\StorePulse\\Connector'/)
  assert.match(runner, /storepulse-current-shift-worker\.ps1/)
  assert.match(runner, /Invoke-DirectVpluRawChild/)
  assert.match(runner, /Elapsed\.TotalSeconds -ge 30/)
  assert.match(runner, /\$currentStage = 'runner_initialization'/)
  assert.match(runner, /\$currentStage = 'product_payload_build'/)
  assert.match(runner, /\$productRequestAttempted = \$true/)
  assert.match(runner, /StreamWriter\(\$process\.StandardInput\.BaseStream, \$utf8, 1024, \$true\)/)
  assert.match(runner, /\$writer\.Dispose\(\); \$writer = \$null; \$process\.StandardInput\.Close\(\)/)
  assert.match(runner, /ObjectDisposedException/)
  assert.match(runner, /MethodInvocationException/)
  assert.match(runner, /\$connectionCreated = \$true/)
  assert.match(runner, /UnexpectedException/)
  assert.match(runner, /exception_type/)
  assert.doesNotMatch(runner, /commander-cookie-auth-provider|commander-session-manager|commander-auth-cookie-worker|storepulse-commander-runtime/i)
  assert.deepEqual(paths.sort(), ['maintenance/run-connector-commander-read-test-product.ps1', 'research/commander-vplus-raw-client.mjs'])
  assert.equal(manifest.safety_assertions.proven_raw_vplu_client_sha256, 'd7b856ff63f1f9ae2b7292c9fa28c98e745d0cd2ecbda0aab005dec45eb3cd49')
  assert.equal((await stat(path.join(connectorRoot, 'build', 'StorePulse-Connector-Commander-Read-Test-Product-4951ceac.zip'))).size > 0, true)
})
