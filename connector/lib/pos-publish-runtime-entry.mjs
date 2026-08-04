import { lstat, readFile } from 'node:fs/promises'

import { createControlledCommanderPriceAdapter } from './commander-price-adapter.mjs'
import { createPosPublishRuntime, toSafePosPublishChildResult } from './pos-publish-runtime.mjs'
import { resolveCommanderTlsTrust } from './commander/session/commander-tls-trust.mjs'

const CONFIG_PATH = 'C:\\ProgramData\\StorePulse\\config.json'
const PROGRAM_DATA = 'C:\\ProgramData'
const MAX_INPUT_BYTES = 8 * 1024
const INPUT_KEYS = new Set([
  'connector_token',
  'trusted_source_endpoint_url',
  'poll_seconds',
  'worker_version',
  'session_cookie',
])

async function readBoundedInput() {
  const chunks = []
  let total = 0
  for await (const chunk of process.stdin) {
    total += chunk.length
    if (total > MAX_INPUT_BYTES) throw new Error('invalid_input')
    chunks.push(chunk)
  }
  if (total === 0) throw new Error('invalid_input')
  let value
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { throw new Error('invalid_input') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('invalid_input')
  const keys = Object.keys(value)
  if (keys.length !== INPUT_KEYS.size || keys.some((key) => !INPUT_KEYS.has(key))) throw new Error('invalid_input')
  return value
}

async function loadFixedCommanderConfig(filesystem = { lstat, readFile }) {
  let info
  try { info = await filesystem.lstat(CONFIG_PATH) } catch { throw new Error('commander_adapter_unavailable') }
  const isReparsePoint = typeof info.isReparsePoint === 'function' && info.isReparsePoint()
  if (!info.isFile() || info.isSymbolicLink() || isReparsePoint || !Number.isInteger(info.size) || info.size < 2 || info.size > 128 * 1024) {
    throw new Error('commander_adapter_unavailable')
  }
  let config
  try { config = JSON.parse(await filesystem.readFile(CONFIG_PATH, 'utf8')) } catch { throw new Error('commander_adapter_unavailable') }
  if (!config || Array.isArray(config) || typeof config.commander_ip !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(config.commander_ip)) {
    throw new Error('commander_adapter_unavailable')
  }
  return config
}

let input = null
let sessionCookie = null
try {
  input = await readBoundedInput()
  sessionCookie = input.session_cookie
  const config = await loadFixedCommanderConfig()
  const trust = await resolveCommanderTlsTrust({ config, programData: PROGRAM_DATA })
  const commanderAdapter = createControlledCommanderPriceAdapter({
    origin: `https://${config.commander_ip}`,
    sessionCookie,
    trust,
  })
  const runtime = createPosPublishRuntime({
    enabled: true,
    pollSeconds: input.poll_seconds,
    trustedSourceEndpointUrl: input.trusted_source_endpoint_url,
    connectorToken: input.connector_token,
    workerVersion: input.worker_version,
    commanderAdapter,
  })
  process.stdout.write(JSON.stringify(toSafePosPublishChildResult(await runtime.processOne())))
} catch (error) {
  const errorCode = error?.message === 'commander_adapter_unavailable'
    ? 'commander_adapter_unavailable'
    : 'pos_publish_configuration_invalid'
  process.stdout.write(JSON.stringify(toSafePosPublishChildResult({
    outcome: 'configuration_error',
    state: 'configuration_error',
    last_error_code: errorCode,
  })))
} finally {
  sessionCookie = null
  if (input && typeof input === 'object') {
    input.session_cookie = null
    input.connector_token = null
  }
  input = null
}
