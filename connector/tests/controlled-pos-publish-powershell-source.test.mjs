import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const runtimePath = new URL('../service/storepulse-service-runtime.ps1', import.meta.url)
const configPath = new URL('../service/storepulse-machine-config.ps1', import.meta.url)

const forbidden = [
  'commander-auth-cookie-worker.ps1',
  'capture-commander-validate-structure.ps1',
  'commander-contained-credential-reader.ps1',
  'commander-smt-session.ps1',
  'commander-validate-contained-live-worker.ps1',
]

test('service publishing authentication is PowerShell-first and fixed to the three installed service files', async () => {
  const runtime = await readFile(runtimePath, 'utf8')
  assert.match(runtime, /C:\\Program Files\\StorePulse\\Connector\\service/)
  assert.match(runtime, /storepulse-machine-config\.ps1/)
  assert.match(runtime, /storepulse-machine-secrets\.ps1/)
  assert.match(runtime, /storepulse-current-shift-worker\.ps1/)
  assert.equal((runtime.match(/New-StorePulseCommanderConnection/g) || []).length >= 2, true)
  assert.equal((runtime.match(/Get-StorePulseCommanderSessionCookie/g) || []).length >= 2, true)
  assert.match(runtime, /\$connection\s*=\s*New-StorePulseCommanderConnection/)
  assert.match(runtime, /\$cookie\s*=\s*Get-StorePulseCommanderSessionCookie/)
  assert.match(runtime, /session_cookie\s*=\s*\[string\]\$cookie/)
  assert.match(runtime, /RedirectStandardInput\s*=\s*\$true/)
  assert.match(runtime, /if \(\$connection\.PSObject\.Methods\['Dispose'\]\) \{ \$connection\.Dispose\(\) \}/)
  assert.match(runtime, /FinalReleaseComObject\(\$connection\)/)
  assert.match(runtime, /\$input\s*=\s*\$null[\s\S]*?\$cookie\s*=\s*\$null[\s\S]*?\$connection\s*=\s*\$null/)
  assert.match(runtime, /\$workerVersion\s*=\s*\[string\]\$script:StorePulseRuntimeVersion/)
  assert.match(runtime, /worker_version\s*=\s*\$workerVersion/)
  for (const name of forbidden) assert.doesNotMatch(runtime, new RegExp(name.replaceAll('.', '\\.')))
})

test('publishing remains disabled unless both the boolean and manual price mode are explicitly configured', async () => {
  const [runtime, config] = await Promise.all([readFile(runtimePath, 'utf8'), readFile(configPath, 'utf8')])
  assert.match(config, /NotePropertyName "pos_publish_enabled" -NotePropertyValue \$false/)
  assert.match(config, /NotePropertyName "pos_publish_mode" -NotePropertyValue "disabled"/)
  assert.match(config, /\$posPublishMode -notin @\("disabled", "manual_price_publish"\)/)
  assert.match(config, /\$posPublishEnabled -and \$posPublishMode -ne "manual_price_publish"/)
  assert.match(runtime, /\$posPublishEnabled = \$posPublishRequested -and \$posPublishMode -eq "manual_price_publish"/)
  assert.doesNotMatch(config, /pos_publish_enabled"\]\s*=\s*\$true/)
})

test('Node child receives bounded HTTPS inputs but does not own Commander credentials', async () => {
  const runtime = await readFile(runtimePath, 'utf8')
  assert.match(runtime, /connector_token = \[string\]\$Secrets\.connector_token/)
  assert.match(runtime, /trusted_source_endpoint_url = \[string\]\$Config\.live_endpoint_url/)
  assert.match(runtime, /session_cookie = \[string\]\$cookie/)
  assert.doesNotMatch(runtime, /commander_username\s*=|commander_password\s*=/)
  assert.match(runtime, /Invoke-StorePulsePosPublishChild[\s\S]*?-Input \$input/)
})
