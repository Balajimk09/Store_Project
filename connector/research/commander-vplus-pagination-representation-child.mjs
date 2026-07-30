import { lstat, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { sendCommanderNaxml } from '../lib/commander/commander-naxml-client.mjs'
import { resolveCommanderTlsTrust } from '../lib/commander/session/commander-tls-trust.mjs'
import { PAGE1_XML, analyzePaginationRepresentation, serializeRepresentationResult } from './commander-vplus-pagination-representation-client.mjs'

const CONFIG_PATH = 'C:\\ProgramData\\StorePulse\\config.json'
const PROGRAM_DATA = 'C:\\ProgramData'
const MAX_STDIN_BYTES = 8192
const FIELDS = ['request_succeeded', 'bounded_response_received', 'utf8_valid', 'xml_parse_succeeded', 'response_root_valid', 'representation_analysis_completed', 'page_target_detected', 'of_pages_target_detected', 'page_representation', 'of_pages_representation', 'page_depth_bucket', 'of_pages_depth_bucket', 'page_candidate_count_bucket', 'of_pages_candidate_count_bucket', 'page_numeric_class', 'of_pages_numeric_class', 'page_conflicting_candidates', 'of_pages_conflicting_candidates', 'raw_response_retained', 'product_values_retained', 'safe_error_code']
const SAFE_ERRORS = new Set(['invalid_input', 'invalid_origin', 'ca_file_invalid', 'transport_failed', 'timeout', 'response_too_large', 'http_rejected', 'invalid_utf8', 'xml_invalid', 'xml_unsafe', 'structure_limit_exceeded', 'response_root_invalid', 'representation_analysis_failed', 'result_too_large', 'unexpected_failure'])
const HOST = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/

function result(code = null, state = {}) {
  return {
    request_succeeded: state.request_succeeded ?? false,
    bounded_response_received: state.bounded_response_received ?? false,
    utf8_valid: state.utf8_valid ?? false,
    xml_parse_succeeded: state.xml_parse_succeeded ?? false,
    response_root_valid: state.response_root_valid ?? false,
    representation_analysis_completed: state.representation_analysis_completed ?? false,
    page_target_detected: state.page_target_detected ?? false,
    of_pages_target_detected: state.of_pages_target_detected ?? false,
    page_representation: state.page_representation ?? 'structure_unavailable',
    of_pages_representation: state.of_pages_representation ?? 'structure_unavailable',
    page_depth_bucket: state.page_depth_bucket ?? 'unknown',
    of_pages_depth_bucket: state.of_pages_depth_bucket ?? 'unknown',
    page_candidate_count_bucket: state.page_candidate_count_bucket ?? 'unknown',
    of_pages_candidate_count_bucket: state.of_pages_candidate_count_bucket ?? 'unknown',
    page_numeric_class: state.page_numeric_class ?? 'unknown',
    of_pages_numeric_class: state.of_pages_numeric_class ?? 'unknown',
    page_conflicting_candidates: state.page_conflicting_candidates ?? false,
    of_pages_conflicting_candidates: state.of_pages_conflicting_candidates ?? false,
    raw_response_retained: false,
    product_values_retained: false,
    safe_error_code: SAFE_ERRORS.has(code) ? code : 'unexpected_failure',
  }
}

function fail(code) { const error = new Error(code); error.code = code; throw error }
function safe(code) { return SAFE_ERRORS.has(code) ? code : 'transport_failed' }

export function validateChildInput(value) {
  if (!value || Array.isArray(value) || Object.keys(value).join('|') !== 'session_cookie' || typeof value.session_cookie !== 'string') fail('invalid_input')
  const cookie = value.session_cookie
  if (cookie.length < 1 || cookie.length > 4096 || /[\u0000-\u001f\u007f-\u009f&=]/u.test(cookie)) fail('invalid_input')
  return cookie
}

async function ordinaryFile(filesystem, target) {
  try { const info = await filesystem.lstat(target); return Boolean(info?.isFile?.() && !info?.isSymbolicLink?.() && !info?.isReparsePoint?.()) } catch { return false }
}

export async function loadFixedCommanderConfig(filesystem = { lstat, readFile }) {
  if (!(await ordinaryFile(filesystem, CONFIG_PATH))) fail('transport_failed')
  let config
  try { config = JSON.parse((await filesystem.readFile(CONFIG_PATH, 'utf8')).toString()) } catch { fail('transport_failed') }
  if (!config || Array.isArray(config) || !HOST.test(config.commander_ip)) fail('transport_failed')
  return config
}

function normalize(error) {
  const code = error?.code || error?.message
  if (code === 'timeout') return 'timeout'
  if (code === 'response_too_large') return 'response_too_large'
  if (code === 'response_invalid') return 'invalid_utf8'
  if (code === 'request_invalid') return 'invalid_input'
  if (code === 'http_rejected') return 'http_rejected'
  return 'transport_failed'
}

export async function runPinnedRepresentation(input, dependencies = {}) {
  let cookie
  try { cookie = validateChildInput(input) } catch (error) { return result(safe(error.code)) }
  const filesystem = dependencies.filesystem ?? { lstat, readFile }
  const trustLoader = dependencies.trustLoader ?? resolveCommanderTlsTrust
  const sender = dependencies.sender ?? sendCommanderNaxml
  try {
    const config = await loadFixedCommanderConfig(filesystem)
    const trust = await trustLoader({ config, programData: PROGRAM_DATA, filesystem })
    const response = await sender({ origin: `https://${config.commander_ip}`, trust, timeoutMs: 15000, request: { command: 'vPLUs', sessionCookie: cookie, xml: PAGE1_XML } })
    if (!response || !Number.isInteger(response.status) || typeof response.body !== 'string') return result('transport_failed')
    if (response.status < 200 || response.status >= 300) return result('http_rejected')
    return analyzePaginationRepresentation(Buffer.from(response.body, 'utf8'))
  } catch (error) {
    return result(normalize(error))
  } finally { cookie = null }
}

export async function readBoundedInput(stream = process.stdin) {
  const chunks = []; let total = 0
  try {
    for await (const chunk of stream) { total += chunk.length; if (total > MAX_STDIN_BYTES) fail('invalid_input'); chunks.push(chunk) }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch (error) { fail(error?.code === 'invalid_input' ? 'invalid_input' : 'invalid_input') }
}

async function main() {
  let output
  try { output = await runPinnedRepresentation(await readBoundedInput()) } catch (error) { output = result(safe(error?.code)) }
  process.stdout.write(serializeRepresentationResult(output))
  process.exitCode = output.safe_error_code === null ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch(() => { process.stdout.write(serializeRepresentationResult(result('unexpected_failure'))); process.exitCode = 1 })
