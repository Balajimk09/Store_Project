import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import test from 'node:test'

const runnerPath = new URL('../maintenance/run-commander-four-product-read.ps1', import.meta.url)
const childPath = new URL('../research/commander-four-product-read-child.mjs', import.meta.url)
const vpluClientPath = new URL('../lib/commander/commander-vplu-read-client.mjs', import.meta.url)
const trustPath = new URL('../lib/commander/session/commander-tls-trust.mjs', import.meta.url)
const execFileAsync = promisify(execFile)

// These names are intentional test inputs, not runtime dependencies.
const forbidden = [
  'commander-auth-cookie-worker.ps1',
  'capture-commander-validate-structure.ps1',
  'commander-contained-credential-reader.ps1',
  'commander-smt-session.ps1',
  'commander-validate-contained-live-worker.ps1',
]

const identities = [
  '00000000000017/000',
  '00000000000024/000',
  '00000000034524/000',
  '00999999999993/000',
]

async function readRuntimeSources() {
  const [runner, child, vpluClient, trust] = await Promise.all([
    readFile(runnerPath, 'utf8'),
    readFile(childPath, 'utf8'),
    readFile(vpluClientPath, 'utf8'),
    readFile(trustPath, 'utf8'),
  ])
  return { runner, child, vpluClient, trust }
}

async function validateNormalizedFourProductSet(products) {
  const runnerPathBase64 = Buffer.from(runnerPath.pathname.replace(/^\//, '').replaceAll('/', '\\'), 'utf8').toString('base64')
  const productsBase64 = Buffer.from(JSON.stringify(products), 'utf8').toString('base64')
  const script = `
$ProgressPreference = 'SilentlyContinue'
$runnerPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${runnerPathBase64}'))
$productsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${productsBase64}'))
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($runnerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw 'runner_parse_failed' }
$functionAst = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-NormalizedFourProductSet' }, $true))
if ($functionAst.Count -ne 1) { throw 'validator_not_found' }
. ([ScriptBlock]::Create($functionAst[0].Extent.Text))
try {
    Assert-NormalizedFourProductSet -Products @((ConvertFrom-Json -InputObject $productsJson -ErrorAction Stop))
    [Console]::Out.Write('{"valid":true}')
} catch {
    [Console]::Out.Write('{"valid":false}')
}
`
  const { stdout, stderr } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true })
  assert.equal(stderr, '')
  return JSON.parse(stdout)
}

test('four-product runner is PowerShell-first and keeps authentication in its primary process', async () => {
  const { runner, child, vpluClient, trust } = await readRuntimeSources()

  assert.match(runner, /^\[CmdletBinding\(\)\]/)
  const serviceModules = [
    'C:\\Program Files\\StorePulse\\Connector\\service\\storepulse-machine-config.ps1',
    'C:\\Program Files\\StorePulse\\Connector\\service\\storepulse-machine-secrets.ps1',
    'C:\\Program Files\\StorePulse\\Connector\\service\\storepulse-current-shift-worker.ps1',
  ]
  for (const module of serviceModules) assert.ok(runner.includes(module))
  assert.equal((runner.match(/C:\\Program Files\\StorePulse\\Connector\\service\\[^']+\.ps1/g) ?? []).length, 3)
  assert.match(runner, /\. \$machineConfigModule/)
  assert.match(runner, /\. \$machineSecretsModule/)
  assert.match(runner, /\. \$currentShiftModule/)
  assert.match(runner, /\$connection = New-StorePulseCommanderConnection -CommanderInstallPath/)
  assert.match(runner, /\$cookie = Get-StorePulseCommanderSessionCookie -Connection \$connection/)
  assert.match(runner, /\$connection = \$null[\s\S]*?\$cookie = \$null/)
  assert.match(runner, /finally \{[\s\S]*?\$connection\.Dispose\(\)[\s\S]*?FinalReleaseComObject[\s\S]*?\$connection = \$null/)
  assert.match(runner, /\$cookie = \$null[\s\S]*?\$secrets = \$null[\s\S]*?\$config = \$null/)

  for (const name of forbidden) {
    assert.equal([runner, child, vpluClient, trust].some((source) => source.includes(name)), false)
  }
  for (const unsafeNodePattern of [
    'powershell',
    'pwsh',
    'New-StorePulseCommanderConnection',
    'Get-StorePulseCommanderSessionCookie',
    'commander_username',
    'commander_password',
    'secrets.json',
    'node:child_process',
    'child_process',
    'spawn(',
    'exec(',
    'uPLUs',
    'Supabase',
  ]) assert.equal([child, vpluClient].some((source) => source.includes(unsafeNodePattern)), false, unsafeNodePattern)

  const resultBlock = runner.match(/function New-FourProductReadResult \{[\s\S]*?\n\}/)?.[0] ?? ''
  const expectedResultKeys = ['ok', 'read_only', 'selection_count', 'received_product_count', 'snapshot_written', 'error_code', 'failure_stage']
  assert.deepEqual(
    [...resultBlock.matchAll(/^\s{8}([a-z_]+) =/gm)].map((match) => match[1]),
    expectedResultKeys,
  )
})

test('child stdin is BOM-free cookie-only JSON and every selected read is a one-request vPLUs HTTPS call', async () => {
  const { runner, child, vpluClient } = await readRuntimeSources()

  for (const identity of identities) {
    const [upc, modifier] = identity.split('/')
    assert.ok(runner.includes(`upc = '${upc}'; modifier = '${modifier}'`))
    assert.ok(child.includes(`'${identity}'`))
  }
  assert.equal((runner.match(/upc = '/g) ?? []).length, 4)
  assert.match(runner, /foreach \(\$identity in \$selectedProducts\)/)
  assert.equal((runner.match(/\$process\.Start\(\)/g) ?? []).length, 1)
  assert.equal((runner.match(/Invoke-FourProductReadChild -NodePath/g) ?? []).length, 1)
  assert.match(runner, /\[System\.Text\.UTF8Encoding\]::new\(\$false\)/)
  assert.match(runner, /\[System\.IO\.StreamWriter\]::new\([\s\S]*?\$process\.StandardInput\.BaseStream[\s\S]*?\$utf8/)
  assert.match(runner, /session_cookie = \$Cookie/)
  assert.match(runner, /\$writer\.Write\(\$payload\)[\s\S]*?\$writer\.Flush\(\)[\s\S]*?\$writer\.Dispose\(\)[\s\S]*?\$process\.StandardInput\.Close\(\)/)
  assert.doesNotMatch(runner, /\$process\.StandardInput\.Write\(/)
  assert.doesNotMatch(runner, /Arguments[\s\S]{0,160}\$Cookie/)
  assert.doesNotMatch(runner, /EnvironmentVariables[\s\S]{0,160}\$Cookie/)

  assert.match(child, /Object\.keys\(value\)\.join\('\|'\) !== 'session_cookie'/)
  assert.equal((child.match(/readCommanderVpluProduct\(/g) ?? []).length, 1)
  assert.match(child, /origin: `https:\/\/\$\{config\.commander_ip\}`/)
  assert.match(child, /resolveCommanderTlsTrust/)
  assert.match(vpluClient, /from 'node:https'/)
  assert.match(vpluClient, /method: 'POST'/)
  assert.match(vpluClient, /cmd=vPLUs/)
  assert.match(vpluClient, /rejectUnauthorized: true/)
  assert.match(vpluClient, /checkServerIdentity/)
  assert.match(vpluClient, /COMMANDER_VPLU_TIMEOUT_MS/)
  assert.match(vpluClient, /COMMANDER_VPLU_MAX_RESPONSE_BYTES/)
  assert.equal((vpluClient.match(/method: 'POST'/g) ?? []).length, 1)
  for (const source of [runner, child, vpluClient]) {
    assert.equal(source.includes('uPLUs'), false)
  assert.equal(source.includes('retry'), false)
  }
})

test('parent parses the bounded child result before exit interpretation and permits only source-evidenced safe failures', async () => {
  const runner = await readFile(runnerPath, 'utf8')
  const contractBlock = runner.match(/function ConvertFrom-FourProductReadChildResult \{[\s\S]*?\n\}/)?.[0] ?? ''
  const expectedSafeErrors = [
    'invalid_input',
    'transport_failed',
    'product_response_invalid',
    'product_read_failed',
    'output_too_large',
    'commander_trust_not_configured',
    'commander_certificate_invalid',
    'commander_ca_hash_mismatch',
    'commander_certificate_hash_mismatch',
  ]

  for (const code of expectedSafeErrors) assert.ok(contractBlock.includes(`'${code}'`), code)
  assert.match(runner, /\[Text\.Encoding\]::UTF8\.GetByteCount\(\$stdout\) -gt 8192/)
  assert.match(runner, /\[Text\.Encoding\]::UTF8\.GetByteCount\(\$stderr\) -gt 4096/)
  assert.match(runner, /-not \[string\]::IsNullOrEmpty\(\$stderr\)\) \{ throw 'child_transport_failed' \}/)
  assert.match(runner, /ConvertFrom-FourProductReadChildResult -Stdout \$stdout -ExitCode \$process\.ExitCode/)
  assert.match(runner, /try \{\s*if \(-not \$process\.Start\(\)\) \{ throw 'child_transport_failed' \}\s*\} catch \{\s*throw 'child_transport_failed'/)
  assert.doesNotMatch(runner, /if \(\$process\.ExitCode -ne 0\) \{ throw 'child_transport_failed' \}/)
  assert.match(runner, /if \(-not \$childResult\.success\) \{ throw \('child_safe_failure:\{0\}' -f \$childResult\.error_code\) \}/)
  assert.match(runner, /\$failureStage = 'child_safe_failure'/)
  assert.match(runner, /if \(-not \$process\.WaitForExit\(30000\)\) \{ throw 'child_timeout' \}/)
  assert.match(runner, /if \(\$null -eq \$errorCode -and \$sessionDisposed -and \$receivedProductCount -eq 4\)/)
  assert.match(runner, /catch \{[\s\S]*?\$errorCode = [\s\S]*?\} finally \{[\s\S]*?\}\s*\n\s*if \(\$null -eq \$errorCode -and \$sessionDisposed -and \$receivedProductCount -eq 4\)/)

  const resultBlock = runner.match(/function New-FourProductReadResult \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.doesNotMatch(resultBlock, /^\s{8}product\s*=/m)
  assert.doesNotMatch(resultBlock, /^\s{8}(cookie|password|secret|token|xml|certificate)\s*=/mi)
  assert.match(runner, /\[Console\]::Out\.Write\(\(\$result \| ConvertTo-Json -Compress\)\)/)
})

test('only the exact normalized identity set can reach the single atomic sanitized snapshot', async () => {
  const { runner, child } = await readRuntimeSources()
  const normalizedKeys = ['upc', 'modifier', 'description', 'price', 'department']

  assert.match(child, /return Object\.freeze\(\{[\s\S]*?upc: product\.upc,[\s\S]*?modifier: product\.modifier,[\s\S]*?description: product\.description\.normalize\('NFC'\),[\s\S]*?price: product\.retail_price,[\s\S]*?department: product\.department_number\.normalize\('NFC'\)/)
  assert.match(child, /typeof product\.department_number !== 'string'/)
  assert.match(child, /!\/\^\\d\{1,64\}\$\//)
  assert.match(runner, /\$productFields = @\('upc', 'modifier', 'description', 'price', 'department'\)/)
  assert.match(runner, /function Assert-NormalizedFourProductSet/)
  assert.match(runner, /\$expectedKeys = @\(/)
  assert.match(runner, /'\{0\}\/\{1\}' -f \(\[string\]\$_\.upc\), \(\[string\]\$_\.modifier\)/)
  assert.match(runner, /\$uniqueActual = @\(\$actualKeys \| Sort-Object -Unique\)/)
  assert.match(runner, /\$actualKeys -notcontains \$key/)
  assert.match(runner, /\$expectedKeys -notcontains \$key/)
  assert.match(runner, /Assert-NormalizedFourProductSet -Products \$products/)
  assert.match(runner, /\$receivedProductCount = @\(\$products \| ForEach-Object[\s\S]*?Sort-Object -Unique\)\.Count/)

  const snapshotBlock = runner.match(/function Write-SanitizedFourProductSnapshot \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(snapshotBlock, /if \(Test-Path -LiteralPath \$snapshotPath\) \{ throw 'snapshot_precondition_failed' \}/)
  assert.match(snapshotBlock, /Assert-NormalizedFourProductSet -Products \$Products/)
  assert.match(snapshotBlock, /\$snapshot = \[ordered\]@\{\s*products = @\(\$Products\)\s*\}/)
  assert.doesNotMatch(snapshotBlock, /operation|selection_count|cookie|secret|token|xml|certificate/i)
  assert.match(snapshotBlock, /\[IO\.File\]::WriteAllText\(\$tempPath/)
  assert.match(snapshotBlock, /Get-Content -LiteralPath \$tempPath -Raw \| ConvertFrom-Json -ErrorAction Stop/)
  assert.match(snapshotBlock, /\$validated\.PSObject\.Properties\.Name\)\.Count -ne 1/)
  assert.match(snapshotBlock, /Assert-NormalizedFourProductSet -Products @\(\$validated\.products\)/)
  assert.equal((snapshotBlock.match(/\[IO\.File\]::Move\(\$tempPath, \$snapshotPath\)/g) ?? []).length, 1)
  assert.match(snapshotBlock, /Remove-Item -LiteralPath \$tempPath -Force/)
  assert.match(runner, /if \(\$null -eq \$errorCode -and \$sessionDisposed -and \$receivedProductCount -eq 4\)/)
  assert.match(runner, /\$ok = \$null -eq \$errorCode -and \$failureStage -eq \$null -and \$sessionDisposed -and \$receivedProductCount -eq 4 -and \$snapshotWritten/)
  assert.match(runner, /exit \$\(if \(\$ok\) \{ 0 \} else \{ 1 \}\)/)
  assert.match(runner, /function Invoke-FourProductReadChild \{[\s\S]*?try \{[\s\S]*?finally \{[\s\S]*?\$process\.Dispose\(\)/)
  assert.match(runner, /try \{[\s\S]*?Read-StorePulseMachineConfig[\s\S]*?Get-StorePulseCommanderSessionCookie[\s\S]*?\} catch \{[\s\S]*?\} finally \{[\s\S]*?\$connection\.Dispose\(\)/)
  for (const failure of [
    'machine_config_load',
    'child_transport_failed',
    'child_timeout',
    'child_response_invalid',
    'product_identity_set_invalid',
    'snapshot_write_failed',
  ]) assert.ok(runner.includes(failure), failure)
  assert.equal(normalizedKeys.join('|'), 'upc|modifier|description|price|department')
})

test('the normalized identity validator accepts the four selected products in any order', async () => {
  const result = await validateNormalizedFourProductSet([
    { upc: '00999999999993', modifier: '000' },
    { upc: '00000000034524', modifier: '000' },
    { upc: '00000000000017', modifier: '000' },
    { upc: '00000000000024', modifier: '000' },
  ])
  assert.deepEqual(result, { valid: true })
})

test('the normalized identity validator rejects a wrong UPC', async () => {
  const result = await validateNormalizedFourProductSet([
    { upc: '00000000000017', modifier: '000' },
    { upc: '00000000000024', modifier: '000' },
    { upc: '00000000034524', modifier: '000' },
    { upc: '00999999999994', modifier: '000' },
  ])
  assert.deepEqual(result, { valid: false })
})

test('publishing is absent while the existing machine-config normalization keeps a missing flag disabled', async () => {
  const { runner, child, vpluClient } = await readRuntimeSources()

  for (const source of [runner, child, vpluClient]) {
    assert.doesNotMatch(source, /supabase/i)
  }
  assert.doesNotMatch(runner, /function\s+.*publish/i)
  assert.doesNotMatch(runner, /Invoke-WebRequest|Invoke-RestMethod|HttpClient|WebClient/i)
  assert.match(runner, /\$snapshotPath = Join-Path \$snapshotDirectory 'commander-four-product-read-snapshot\.json'/)
  assert.match(runner, /\[IO\.File\]::WriteAllText\(\$tempPath/)
  assert.match(runner, /\[IO\.File\]::Move\(\$tempPath, \$snapshotPath\)/)
  assert.match(vpluClient, /method: 'POST'/)
  assert.match(vpluClient, /cmd=vPLUs/)
})
