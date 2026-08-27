import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const entryPath = new URL('../lib/pos-publish-runtime-entry.mjs', import.meta.url)
const CONFIG_PATH = 'C:\\ProgramData\\StorePulse\\config.json'

function loadFixedCommanderConfigFromSource(source, configText, detail = {}) {
  const start = source.indexOf('async function loadFixedCommanderConfig(')
  const match = source.slice(start).match(/^(async function loadFixedCommanderConfig[\s\S]*?\r?\n})\r?\n\r?\nlet input = null/)
  assert.ok(start >= 0 && match, 'loadFixedCommanderConfig source must be present')
  const implementation = source
    .slice(start, start + match[1].length)
    .replace('async function loadFixedCommanderConfig', 'async function loadFixedCommanderConfigForTest')
  const loader = new Function('CONFIG_PATH', `${implementation}\nreturn loadFixedCommanderConfigForTest`)(CONFIG_PATH)
  return loader({
    lstat: async (path) => {
      assert.equal(path, CONFIG_PATH)
      return {
        isFile: () => true,
        isSymbolicLink: () => false,
        size: Buffer.byteLength(configText),
        ...detail,
      }
    },
    readFile: async (path, encoding) => {
      assert.equal(path, CONFIG_PATH)
      assert.equal(encoding, 'utf8')
      return configText
    },
  })
}


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
test('fixed config reader strips exactly one leading BOM without weakening validation', async () => {
  const source = await readFile(entryPath, 'utf8')
  const validConfig = '{"commander_ip":"commander.example"}'

  assert.match(source, /const raw = await filesystem\.readFile\(CONFIG_PATH, 'utf8'\)/)
  assert.match(source, /const text = raw\.charCodeAt\(0\) === 0xFEFF \? raw\.slice\(1\) : raw/)
  assert.match(source, /config = JSON\.parse\(text\)/)
  assert.doesNotMatch(source, /loadFixedCommanderConfig[\s\S]*?\.trim(?:Start)?\(/)

  assert.deepEqual(await loadFixedCommanderConfigFromSource(source, validConfig), { commander_ip: 'commander.example' })
  assert.deepEqual(await loadFixedCommanderConfigFromSource(source, `\uFEFF${validConfig}`), { commander_ip: 'commander.example' })
  await assert.rejects(() => loadFixedCommanderConfigFromSource(source, `\uFEFF\uFEFF${validConfig}`), /commander_adapter_unavailable/)
  await assert.rejects(() => loadFixedCommanderConfigFromSource(source, '\uFEFF{'), /commander_adapter_unavailable/)
  await assert.rejects(() => loadFixedCommanderConfigFromSource(source, '{}'), /commander_adapter_unavailable/)
  await assert.rejects(() => loadFixedCommanderConfigFromSource(source, '{"commander_ip":"bad host"}'), /commander_adapter_unavailable/)

  for (const detail of [
    { isFile: () => false },
    { isSymbolicLink: () => true },
    { isReparsePoint: () => true },
    { size: 128 * 1024 + 1 },
  ]) {
    await assert.rejects(() => loadFixedCommanderConfigFromSource(source, validConfig, detail), /commander_adapter_unavailable/)
  }

  assert.match(source, /const CONFIG_PATH = 'C:\\\\ProgramData\\\\StorePulse\\\\config\.json'/)
  const inputKeys = source.slice(source.indexOf('const INPUT_KEYS'), source.indexOf('\n])', source.indexOf('const INPUT_KEYS')))
  assert.doesNotMatch(inputKeys, /config(?:_|-)?path/i)
  assert.ok(source.indexOf('const config = await loadFixedCommanderConfig()') < source.indexOf('const runtime = createPosPublishRuntime({'))
})
