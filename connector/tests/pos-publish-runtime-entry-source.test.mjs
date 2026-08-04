import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const entryPath = new URL('../lib/pos-publish-runtime-entry.mjs', import.meta.url)

test('runtime child is HTTPS-only and accepts a session cookie without Commander authentication code', async () => {
  const source = await readFile(entryPath, 'utf8')
  assert.match(source, /'session_cookie'/)
  assert.match(source, /createControlledCommanderPriceAdapter/)
  assert.match(source, /resolveCommanderTlsTrust/)
  assert.match(source, /C:\\\\ProgramData\\\\StorePulse\\\\config\.json/)
  assert.match(source, /origin: `https:\/\/\$\{config\.commander_ip\}`/)
  assert.doesNotMatch(source, /New-StorePulseCommanderConnection|Get-StorePulseCommanderSessionCookie|child_process|spawn\(|exec\(|powershell/i)
  assert.doesNotMatch(source, /commander_username|commander_password/)
  assert.match(source, /input\.session_cookie = null/)
  assert.match(source, /input\.connector_token = null/)
})
