import { lstat, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import {
  normalizeProductIdentity,
  readCommanderProduct,
  sendSupportedProductWrite,
} from '../lib/commander/commander-product-integration.mjs'
import {
  resolveCommanderTlsTrust,
} from '../lib/commander/session/commander-tls-trust.mjs'

const CONFIG_PATH = 'C:\\ProgramData\\StorePulse\\config.json'
const PROGRAM_DATA = 'C:\\ProgramData'
const MAX_STDIN_BYTES = 8192
const MAX_OUTPUT_BYTES = 8192

export const CONTROLLED_PRODUCT = Object.freeze({
  upc: '00999999999993',
  modifier: '000',
  description: 'STOREPULSE TEST',
})

const SAFE_ERROR_CODES = new Set([
  'invalid_input',
  'transport_failed',
  'product_not_found',
  'initial_read_failed',
  'controlled_identity_mismatch',
  'controlled_description_mismatch',
  'current_price_conflict',
  'requested_price_unchanged',
  'write_failed',
  'write_outcome_unknown',
  'readback_failed',
  'readback_mismatch',
  'commander_trust_not_configured',
  'commander_ca_missing',
  'commander_server_certificate_missing',
  'commander_certificate_invalid',
  'commander_ca_hash_mismatch',
  'commander_certificate_hash_mismatch',
  'commander_tls_hostname_invalid',
  'commander_tls_peer_mismatch',
  'output_too_large',
])

function fail(code) {
  const error = new Error(code)
  error.code = code
  throw error
}

function normalizePrice(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
    fail('invalid_input')
  }
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0 || amount > 999999.99) {
    fail('invalid_input')
  }
  return amount.toFixed(2)
}

function safeCode(error, fallback = 'transport_failed') {
  const code = typeof error?.code === 'string' ? error.code : fallback
  return SAFE_ERROR_CODES.has(code) ? code : fallback
}

function safeResult(errorCode, state = {}) {
  return Object.freeze({
    ok: errorCode === null,
    target_upc: CONTROLLED_PRODUCT.upc,
    target_modifier: CONTROLLED_PRODUCT.modifier,
    expected_current_price: state.expectedCurrentPrice ?? null,
    requested_price: state.requestedPrice ?? null,
    observed_current_price: state.observedCurrentPrice ?? null,
    write_attempted: state.writeAttempted === true,
    write_succeeded: state.writeSucceeded === true,
    readback_attempted: state.readbackAttempted === true,
    observed_readback_price: state.observedReadbackPrice ?? null,
    readback_matched: state.readbackMatched === true,
    error_code: errorCode,
  })
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
  if (
    !config
    || Array.isArray(config)
    || typeof config.commander_ip !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(config.commander_ip)
  ) fail('transport_failed')
  return config
}

function validateControlledProduct(product) {
  if (!product || product.upc !== CONTROLLED_PRODUCT.upc || product.modifier !== CONTROLLED_PRODUCT.modifier) {
    fail('controlled_identity_mismatch')
  }
  if (product.description !== CONTROLLED_PRODUCT.description) {
    fail('controlled_description_mismatch')
  }
  return normalizePrice(product.retail_price)
}

function mapReadFailure(status, initial) {
  if (status === 'product_not_found') return 'product_not_found'
  if (status === 'commander_tls_hostname_invalid') return status
  if (status === 'commander_tls_peer_mismatch') return status
  return initial ? 'initial_read_failed' : 'readback_failed'
}

function buildCommand(expectedCurrentPrice, requestedPrice, now) {
  const identity = normalizeProductIdentity({
    upc: CONTROLLED_PRODUCT.upc,
    modifier: CONTROLLED_PRODUCT.modifier,
  })
  const stamp = now().toISOString()
  const token = `${expectedCurrentPrice}-${requestedPrice}`.replace('.', '_')
  return Object.freeze({
    command_id: `controlled-test-price-${token}`,
    command_type: 'update_price',
    source_product_key: identity.source_product_key,
    identity: {
      upc: CONTROLLED_PRODUCT.upc,
      modifier: CONTROLLED_PRODUCT.modifier,
    },
    expected_current: { retail_price: expectedCurrentPrice },
    requested_changes: { retail_price: requestedPrice },
    approval: {
      approval_id: 'controlled-test-product-price-only',
      approved_at: stamp,
    },
    created_at: stamp,
    idempotency_key: `controlled-test-price-${token}`,
  })
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  loadConfig,
  resolveTrust: resolveCommanderTlsTrust,
  readProduct: readCommanderProduct,
  writeProduct: sendSupportedProductWrite,
  now: () => new Date(),
})

/**
 * Performs exactly one bounded controlled workflow: vPLUs, uPLUs, vPLUs.
 * Authentication remains in the parent PowerShell process; this child receives
 * only the session cookie via stdin and performs pinned HTTPS requests.
 */
export async function runTestProductPriceUpdateChild(
  input,
  expectedPriceArg,
  requestedPriceArg,
  dependencies = {},
) {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies }
  let cookie = null
  const state = {
    expectedCurrentPrice: null,
    requestedPrice: null,
    observedCurrentPrice: null,
    writeAttempted: false,
    writeSucceeded: false,
    readbackAttempted: false,
    observedReadbackPrice: null,
    readbackMatched: false,
  }

  try {
    cookie = validateChildInput(input)
    state.expectedCurrentPrice = normalizePrice(expectedPriceArg)
    state.requestedPrice = normalizePrice(requestedPriceArg)
    if (state.expectedCurrentPrice === state.requestedPrice) {
      fail('requested_price_unchanged')
    }

    const config = await deps.loadConfig()
    const trust = await deps.resolveTrust({
      config,
      programData: PROGRAM_DATA,
    })
    const origin = `https://${config.commander_ip}`

    const initial = await deps.readProduct({
      origin,
      sessionCookie: cookie,
      trust,
      upc: CONTROLLED_PRODUCT.upc,
      modifier: CONTROLLED_PRODUCT.modifier,
      timeoutMs: 15_000,
    })
    if (initial?.status !== 'success') {
      fail(mapReadFailure(initial?.status, true))
    }

    state.observedCurrentPrice = validateControlledProduct(initial.product)
    if (state.observedCurrentPrice !== state.expectedCurrentPrice) {
      fail('current_price_conflict')
    }

    state.writeAttempted = true
    let writeStatus = 'write_failed'
    try {
      const write = await deps.writeProduct({
        origin,
        sessionCookie: cookie,
        trust,
        command: buildCommand(
          state.expectedCurrentPrice,
          state.requestedPrice,
          deps.now,
        ),
        product: initial.product,
        timeoutMs: 15_000,
      })
      writeStatus = write?.status === 'success' ? 'success' : 'write_failed'
      state.writeSucceeded = writeStatus === 'success'
    } catch {
      writeStatus = 'write_outcome_unknown'
      state.writeSucceeded = false
    }

    state.readbackAttempted = true
    let readback
    try {
      readback = await deps.readProduct({
        origin,
        sessionCookie: cookie,
        trust,
        upc: CONTROLLED_PRODUCT.upc,
        modifier: CONTROLLED_PRODUCT.modifier,
        timeoutMs: 15_000,
      })
    } catch {
      readback = null
    }

    if (readback?.status !== 'success') {
      return safeResult(
        writeStatus === 'write_failed' ? 'write_failed' : 'write_outcome_unknown',
        state,
      )
    }

    state.observedReadbackPrice = validateControlledProduct(readback.product)
    state.readbackMatched = state.observedReadbackPrice === state.requestedPrice

    if (!state.readbackMatched) {
      return safeResult(
        state.writeSucceeded ? 'readback_mismatch' : 'write_failed',
        state,
      )
    }

    if (!state.writeSucceeded) {
      return safeResult('write_outcome_unknown', state)
    }

    return safeResult(null, state)
  } catch (error) {
    return safeResult(safeCode(error), state)
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
    chunks.push(Buffer.from(chunk))
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true })
        .decode(Buffer.concat(chunks)),
    )
  } catch {
    fail('invalid_input')
  }
}

async function main() {
  const result = await runTestProductPriceUpdateChild(
    await readInput(),
    process.argv[2],
    process.argv[3],
  )
  const output = JSON.stringify(result)
  process.stdout.write(
    Buffer.byteLength(output, 'utf8') <= MAX_OUTPUT_BYTES
      ? output
      : JSON.stringify(safeResult('output_too_large')),
  )
  process.exitCode = result.ok === true ? 0 : 1
}

if (
  process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch(() => {
    process.stdout.write(JSON.stringify(safeResult('transport_failed')))
    process.exitCode = 1
  })
}
