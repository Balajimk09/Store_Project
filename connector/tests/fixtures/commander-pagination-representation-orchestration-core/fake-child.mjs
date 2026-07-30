import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url))
const eventsPath = path.join(fixtureDirectory, 'events.log')
const modePath = path.join(fixtureDirectory, 'mode.txt')
const record = value => appendFileSync(eventsPath, `${value}\n`, 'utf8')
const fields = [
  'request_succeeded','bounded_response_received','utf8_valid','xml_parse_succeeded',
  'response_root_valid','representation_analysis_completed','page_target_detected',
  'of_pages_target_detected','page_representation','of_pages_representation',
  'page_depth_bucket','of_pages_depth_bucket','page_candidate_count_bucket',
  'of_pages_candidate_count_bucket','page_numeric_class','of_pages_numeric_class',
  'page_conflicting_candidates','of_pages_conflicting_candidates','raw_response_retained',
  'product_values_retained','safe_error_code',
]

const resultFor = mode => {
  const ambiguous = mode === 'valid-ambiguous'
  return {
    request_succeeded: true,
    bounded_response_received: true,
    utf8_valid: true,
    xml_parse_succeeded: true,
    response_root_valid: true,
    representation_analysis_completed: true,
    page_target_detected: true,
    of_pages_target_detected: true,
    page_representation: ambiguous ? 'ambiguous' : 'root_attribute',
    of_pages_representation: ambiguous ? 'ambiguous' : 'direct_text_element',
    page_depth_bucket: ambiguous ? 'unknown' : 'root',
    of_pages_depth_bucket: ambiguous ? 'unknown' : 'depth_1',
    page_candidate_count_bucket: ambiguous ? 'unknown' : 'one',
    of_pages_candidate_count_bucket: ambiguous ? 'unknown' : 'one',
    page_numeric_class: ambiguous ? 'unknown' : 'unsigned_decimal',
    of_pages_numeric_class: ambiguous ? 'unknown' : 'unsigned_decimal',
    page_conflicting_candidates: ambiguous,
    of_pages_conflicting_candidates: ambiguous,
    raw_response_retained: false,
    product_values_retained: false,
    safe_error_code: null,
  }
}

record(`child_pid=${process.pid}`)
record('child_start')
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  record('stdin_closed')
  let payload
  try {
    payload = JSON.parse(input)
  } catch {
    process.exitCode = 2
    return
  }
  if (!payload || Array.isArray(payload) || Object.keys(payload).length !== 1 || Object.keys(payload)[0] !== 'session_cookie' || typeof payload.session_cookie !== 'string') {
    process.exitCode = 2
    return
  }
  if (process.argv.includes(payload.session_cookie)) record('unsafe_child_argument')
  if (Object.values(process.env).includes(payload.session_cookie)) record('unsafe_child_environment')
  const mode = readFileSync(modePath, 'utf8').trim()
  if (mode === 'invalid-json') {
    process.stdout.write('{invalid json')
    return
  }
  if (!['valid-success', 'valid-ambiguous'].includes(mode)) {
    process.exitCode = 2
    return
  }
  const result = resultFor(mode)
  if (!fields.every((field, index) => Object.keys(result)[index] === field)) {
    process.exitCode = 2
    return
  }
  process.stdout.write(JSON.stringify(result))
})
