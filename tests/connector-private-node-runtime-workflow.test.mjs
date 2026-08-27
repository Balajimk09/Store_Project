import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const workflowUrl = new URL('../.github/workflows/connector-heartbeat-verification.yml', import.meta.url)
const manifestUrl = new URL('../connector/service/node-runtime-manifest.json', import.meta.url)
const winswManifestUrl = new URL('../connector/service/winsw-manifest.json', import.meta.url)

test('Windows connector CI materializes and verifies the pinned private Node runtime', async () => {
  const [workflow, manifestText] = await Promise.all([
    readFile(workflowUrl, 'utf8'),
    readFile(manifestUrl, 'utf8'),
  ])
  const manifest = JSON.parse(manifestText)

  assert.equal(manifest.version, '20.20.2')
  assert.equal(manifest.architecture, 'x64')
  assert.equal(manifest.sha256, '56C1520EE33B801E8BDB92FB321CF2E98529735B6D12BD4A2A6DEC0AC0BAB937')
  assert.match(workflow, /name: Provision pinned private Node runtime for connector tests/u)
  assert.match(workflow, /Get-Command node\.exe -CommandType Application/u)
  assert.match(workflow, /connector\\runtime\\node/u)
  assert.ok(workflow.includes("$manifest.expected_relative_path -ne 'runtime\\node'"))
  assert.match(workflow, /Copy-Item -LiteralPath \$setupNodePath -Destination \$runtimePath/u)
  assert.match(workflow, /Get-FileHash -LiteralPath \$runtimePath -Algorithm SHA256/u)
  assert.match(workflow, /throw "runtime_validation_failed:/u)
  assert.match(workflow, /name: Provision declared connector Node dependencies for connector tests/u)
  assert.match(workflow, /npm ci/u)
  assert.match(workflow, /Copy-StorePulseRuntimeNodeDependencies -Manifest \$manifest -SourceRoot \$env:GITHUB_WORKSPACE -InstallRoot \$connectorRoot/u)
  assert.match(workflow, /Test-StorePulseRuntimeNodeDependencies -Manifest \$manifest -Root \$connectorRoot/u)
})

test('Windows connector CI provisions the package-builder WinSW wrapper contract', async () => {
  const [workflow, winswManifestText] = await Promise.all([
    readFile(workflowUrl, 'utf8'),
    readFile(winswManifestUrl, 'utf8'),
  ])
  const manifest = JSON.parse(winswManifestText)

  assert.equal(manifest.name, 'WinSW')
  assert.equal(manifest.version, '2.12.0')
  assert.equal(manifest.architecture, 'x64')
  assert.equal(manifest.installed_relative_path, 'service\\host\\StorePulseConnector.exe')
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/i)
  assert.match(workflow, /name: Provision pinned WinSW wrapper for connector tests/u)
  assert.match(workflow, /service\\winsw-manifest\.json/u)
  assert.match(workflow, /service\\host\\StorePulseConnector\.exe/u)
  assert.match(workflow, /expectedHosts -notcontains \$uri\.Host/u)
  assert.match(workflow, /winsw_manifest_path_invalid/u)
  assert.match(workflow, /Invoke-WebRequest -Uri \$uri\.AbsoluteUri -OutFile \$downloadPath/u)
  assert.match(workflow, /Get-FileHash -LiteralPath \$downloadPath -Algorithm SHA256/u)
  assert.match(workflow, /Get-FileHash -LiteralPath \$wrapperPath -Algorithm SHA256/u)
  assert.match(workflow, /Test-StorePulseWinSWBinary -InstallRoot \$connectorRoot -ManifestPath \$manifestPath/u)
})
