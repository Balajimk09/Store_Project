import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const runnerPath = new URL(
  '../maintenance/run-commander-test-product-price-update.ps1',
  import.meta.url,
)
const childPath = new URL(
  '../research/commander-test-product-price-update-child.mjs',
  import.meta.url,
)

const runner = await readFile(runnerPath, 'utf8')
const child = await readFile(childPath, 'utf8')
const combined = `${runner}\n${child}`

const forbiddenAuthFiles = [
  'commander-auth-cookie-' + 'worker.ps1',
  'capture-commander-validate-' + 'structure.ps1',
  'commander-contained-credential-' + 'reader.ps1',
  'commander-smt-' + 'session.ps1',
  'commander-validate-contained-live-' + 'worker.ps1',
]

test('entry point is PowerShell-first and authentication remains in the primary process', () => {
  assert.match(runner, /^\[CmdletBinding\(\)\]/)
  assert.match(runner, /\$connection = \$null/)
  assert.match(runner, /\$cookie = \$null/)
  assert.match(runner, /New-StorePulseCommanderConnection/)
  assert.match(runner, /Get-StorePulseCommanderSessionCookie -Connection \$connection/)
  assert.doesNotMatch(child, /New-StorePulseCommanderConnection/)
  assert.doesNotMatch(child, /Get-StorePulseCommanderSessionCookie/)
})

test('the three installed service paths are fixed and exact', () => {
  for (const path of [
    'C:\\Program Files\\StorePulse\\Connector\\service\\storepulse-machine-config.ps1',
    'C:\\Program Files\\StorePulse\\Connector\\service\\storepulse-machine-secrets.ps1',
    'C:\\Program Files\\StorePulse\\Connector\\service\\storepulse-current-shift-worker.ps1',
  ]) assert.equal(runner.includes(path), true)

  assert.match(runner, /\. \$machineConfigModule/)
  assert.match(runner, /\. \$machineSecretsModule/)
  assert.match(runner, /\. \$currentShiftModule/)
})

test('cookie is the only stdin field passed to Node', () => {
  assert.match(runner, /\[ordered\]@\{ session_cookie = \$Cookie \}/)
  assert.match(child, /Object\.keys\(value\)\.join\('\|'\) !== 'session_cookie'/)
  assert.doesNotMatch(runner, /session_cookie\s*=.*RequestedPrice/)
  assert.doesNotMatch(runner, /session_cookie\s*=.*ExpectedCurrentPrice/)
  assert.doesNotMatch(child, /commander_username|commander_password/i)
})

test('only the controlled test product can be written', () => {
  assert.match(combined, /00999999999993/)
  assert.match(combined, /STOREPULSE TEST/)
  for (const prohibited of [
    '00000000000017',
    '00000000000024',
    '00000000034524',
  ]) assert.equal(combined.includes(prohibited), false)

  assert.match(child, /command_type: 'update_price'/)
  assert.match(child, /requested_changes: \{ retail_price: requestedPrice \}/)
  assert.doesNotMatch(child, /create_product|delete_product|deactivate_product|reactivate_product/)
})

test('explicit authorization and price preconditions occur before authentication', () => {
  const authorization = runner.indexOf("if ($WriteAuthorization -cne $requiredAuthorization)")
  const expectedValidation = runner.indexOf('Normalize-ControlledPrice -Value $ExpectedCurrentPrice')
  const connection = runner.indexOf('$connection = New-StorePulseCommanderConnection')
  assert.ok(authorization >= 0)
  assert.ok(expectedValidation > authorization)
  assert.ok(connection > expectedValidation)
  assert.match(runner, /STOREPULSE_TEST_PRICE_ONLY/)
  assert.match(runner, /requested_price_unchanged/)
})

test('workflow is exactly read, price-only write, mandatory readback with no retries', () => {
  const readCalls = [...child.matchAll(/await deps\.readProduct\(/g)]
  const writeCalls = [...child.matchAll(/await deps\.writeProduct\(/g)]
  assert.equal(readCalls.length, 2)
  assert.equal(writeCalls.length, 1)
  assert.ok(readCalls[0].index < writeCalls[0].index)
  assert.ok(writeCalls[0].index < readCalls[1].index)
  assert.doesNotMatch(child, /retry|setInterval|setTimeout/)
  assert.match(child, /state\.readbackAttempted = true/)
  assert.match(child, /state\.observedReadbackPrice === state\.requestedPrice/)
})

test('Node is transport-only and has no auth, shell, database, or non-HTTPS path', () => {
  assert.match(child, /readCommanderProduct/)
  assert.match(child, /sendSupportedProductWrite/)
  assert.match(child, /resolveCommanderTlsTrust/)
  assert.doesNotMatch(child, /node:child_process|\bexecFile?\s*\(|\bspawn\s*\(|['"](?:powershell|pwsh)(?:\.exe)?['"]/i)
  assert.doesNotMatch(child, /node:http['"]|fetch\(|WebSocket|net\.connect/i)
  assert.doesNotMatch(combined, /supabase|pos_publish_enabled/i)
})

test('forbidden authentication files are absent', () => {
  for (const forbidden of forbiddenAuthFiles) {
    assert.equal(combined.includes(forbidden), false)
  }
})

test('cleanup disposes COM and clears sensitive references on every exit path', () => {
  assert.match(runner, /finally \{/)
  assert.match(runner, /\$cookie = \$null/)
  assert.match(runner, /\$secrets = \$null/)
  assert.match(runner, /\$config = \$null/)
  assert.match(runner, /\$connection\.Dispose\(\)/)
  assert.match(runner, /FinalReleaseComObject\(\$connection\)/)
  assert.match(runner, /session_dispose_failed/)
  assert.match(runner, /exit \$\(if \(\$ok\) \{ 0 \} else \{ 1 \}\)/)
})

test('stdout contracts are sanitized and contain no cookie, secret, token, or raw XML field', () => {
  const resultBlock = child.slice(
    child.indexOf('function safeResult'),
    child.indexOf('export function validateChildInput'),
  )
  for (const prohibited of [
    'session_cookie',
    'cookie:',
    'secret',
    'token',
    'raw_xml',
    'request_xml',
    'response_xml',
    'certificate',
  ]) assert.equal(resultBlock.toLowerCase().includes(prohibited), false)

  assert.match(runner, /ConvertTo-Json -Compress/)
  assert.match(child, /JSON\.stringify\(result\)/)
})
