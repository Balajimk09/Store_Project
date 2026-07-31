import { analyzePaginationRepresentation, LIMITS } from './commander-vplus-pagination-representation-client.mjs'

export const COMMAND = 'vPLUs'
export const PAGE2_XML = '<domain:PLUSelect xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><pageSize>100</pageSize><page>2</page></domain:PLUSelect>'
export const FIELDS = ['request_succeeded','bounded_response_received','utf8_valid','xml_parse_succeeded','response_root_valid','representation_analysis_completed','page_two_records_detected','plu_count_bucket','page_target_detected','of_pages_target_detected','page_representation','of_pages_representation','raw_response_retained','product_values_retained','safe_error_code']
const errors = new Set(['invalid_input','invalid_origin','ca_file_invalid','transport_failed','timeout','response_too_large','http_rejected','invalid_utf8','xml_invalid','xml_unsafe','structure_limit_exceeded','response_root_invalid','representation_analysis_failed','result_too_large','unexpected_failure'])

const bucket = count => count === 0 ? '0' : count <= 10 ? '1-10' : count <= 25 ? '11-25' : count <= 50 ? '26-50' : count <= 100 ? '51-100' : 'over_limit'
const fail = (code, state = {}) => ({
  request_succeeded: state.request_succeeded ?? false,
  bounded_response_received: state.bounded_response_received ?? false,
  utf8_valid: state.utf8_valid ?? false,
  xml_parse_succeeded: state.xml_parse_succeeded ?? false,
  response_root_valid: state.response_root_valid ?? false,
  representation_analysis_completed: state.representation_analysis_completed ?? false,
  page_two_records_detected: false,
  plu_count_bucket: 'over_limit',
  page_target_detected: false,
  of_pages_target_detected: false,
  page_representation: 'structure_unavailable',
  of_pages_representation: 'structure_unavailable',
  raw_response_retained: false,
  product_values_retained: false,
  safe_error_code: errors.has(code) ? code : 'unexpected_failure'
})

export function analyzePage2Probe(bytes) {
  const representation = analyzePaginationRepresentation(bytes)
  if (representation.safe_error_code !== null) return fail(representation.safe_error_code, representation)
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return fail('invalid_utf8') }
  const matches = text.match(/<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?PLU(?=\s|\/?>)/g) ?? []
  const count = Math.min(matches.length, 101)
  return {
    request_succeeded: true,
    bounded_response_received: true,
    utf8_valid: true,
    xml_parse_succeeded: true,
    response_root_valid: true,
    representation_analysis_completed: true,
    page_two_records_detected: count > 0,
    plu_count_bucket: bucket(count),
    page_target_detected: representation.page_target_detected,
    of_pages_target_detected: representation.of_pages_target_detected,
    page_representation: representation.page_representation,
    of_pages_representation: representation.of_pages_representation,
    raw_response_retained: false,
    product_values_retained: false,
    safe_error_code: null
  }
}

export function serializePage2ProbeResult(result) {
  if (Object.keys(result).join('|') !== FIELDS.join('|') || result.raw_response_retained !== false || result.product_values_retained !== false || (result.safe_error_code !== null && !errors.has(result.safe_error_code))) return JSON.stringify(fail('unexpected_failure'))
  const json = JSON.stringify(result)
  return Buffer.byteLength(json, 'utf8') <= LIMITS.outputBytes ? json : JSON.stringify(fail('result_too_large'))
}
