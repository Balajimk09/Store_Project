import { lstat, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import {
  readCommanderVpluProduct,
} from '../lib/commander/commander-vplu-read-client.mjs'
import {
  resolveCommanderTlsTrust,
} from '../lib/commander/session/commander-tls-trust.mjs'

const CONFIG_PATH = 'C:\\ProgramData\\StorePulse\\config.json'
const PROGRAM_DATA = 'C:\\ProgramData'
const MAX_STDIN_BYTES = 8192
const MAX_OUTPUT_BYTES = 4096
const IDENTITIES = new Map([
  ['00000000000017/000', Object.freeze({ upc: '00000000000017', modifier: '000' })],
  ['00000000000024/000', Object.freeze({ upc: '00000000000024', modifier: '000' })],
  ['00000000034524/000', Object.freeze({ upc: '00000000034524', modifier: '000' })],
  ['00999999999993/000', Object.freeze({ upc: '00999999999993', modifier: '000' })],
])

function safeResult(errorCode, product = null) {
  return { ok: errorCode === null, product, error_code: errorCode }
}

function fail(code) {
  const error = new Error(code)
  error.code = code
  throw error
}

export function validateChildInput(value) {
  if (
    !value
    || Array.isArray(value)
    || Object.keys(value).join('|') !== 'session_cookie'
    || typeof value.session_cookie !== 'string'
    || value.session_cookie.length < 1
    || value.session_cookie.length > 4096
    || /[\u0000-\u001f\u007f-\u009f&=]/u.test(value.session_cookie)
  ) fail('invalid_input')
  return value.session_cookie
}

export async function regularFile(file, filesystem = { lstat }) {
  try {
    const info = await filesystem.lstat(file)
    const isReparsePoint =
      typeof info.isReparsePoint === 'function'
      && info.isReparsePoint()
    return Boolean(
      info.isFile()
      && !info.isSymbolicLink()
      && !isReparsePoint,
    )
  } catch {
    return false
  }
}

async function loadConfig() {
  if (!(await regularFile(CONFIG_PATH))) fail('transport_failed')
  let config
  try {
    config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
  } catch {
    fail('transport_failed')
  }
  if (!config || Array.isArray(config) || typeof config.commander_ip !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(config.commander_ip)) fail('transport_failed')
  return config
}

export function sanitizeProduct(product, identity) {
  if (
    !product
    || product.upc !== identity.upc
    || product.modifier !== identity.modifier
    || typeof product.description !== 'string'
    || product.description.length < 1
    || product.description.length > 512
    || /[\u0000-\u001f\u007f-\u009f]/u.test(product.description)
    || typeof product.retail_price !== 'string'
    || !/^\d+\.\d{2}$/.test(product.retail_price)
    || typeof product.department_number !== 'string'
    || !/^\d{1,64}$/.test(product.department_number)
  ) fail('product_response_invalid')

  return Object.freeze({
    upc: product.upc,
    modifier: product.modifier,
    description: product.description.normalize('NFC'),
    price: product.retail_price,
    department: product.department_number.normalize('NFC'),
  })
}

export async function runFourProductReadChild(input, identityKey) {
  let cookie
  try {
    cookie = validateChildInput(input)
    const identity = IDENTITIES.get(identityKey)
    if (!identity) fail('invalid_input')
    const config = await loadConfig()
    const trust = await resolveCommanderTlsTrust({ config, programData: PROGRAM_DATA })
    const response = await readCommanderVpluProduct({
      origin: `https://${config.commander_ip}`,
      sessionCookie: cookie,
      trust,
      upc: identity.upc,
      modifier: identity.modifier,
      timeoutMs: 15_000,
    })
    if (response?.status !== 'success') fail('product_read_failed')
    return safeResult(null, sanitizeProduct(response.product, identity))
  } catch (error) {
    return safeResult(typeof error?.code === 'string' ? error.code : 'transport_failed')
  } finally {
    cookie = null
  }
}

async function readInput(stream = process.stdin) {
  const chunks = []
  let total = 0
  for await (const chunk of stream) {
    total += chunk.length
    if (total > MAX_STDIN_BYTES) fail('invalid_input')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch {
    fail('invalid_input')
  }
}

async function main() {
  const result = await runFourProductReadChild(await readInput(), process.argv[2])
  const output = JSON.stringify(result)
  process.stdout.write(Buffer.byteLength(output, 'utf8') <= MAX_OUTPUT_BYTES ? output : JSON.stringify(safeResult('output_too_large')))
  process.exitCode = result.ok === true ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(() => {
    process.stdout.write(JSON.stringify(safeResult('transport_failed')))
    process.exitCode = 1
  })
}
