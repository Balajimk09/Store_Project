import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  COMMAND,
  LIMITS,
  PAGE1_XML,
  analyzePaginationRepresentation,
  buildPage1Body,
  serializeRepresentationResult
} from '../research/commander-vplus-pagination-representation-client.mjs'
import { document, nested, records } from './fixtures/commander-pagination-representation/synthetic-representations.mjs'

const clientPath = new URL('../research/commander-vplus-pagination-representation-client.mjs', import.meta.url)
const fields = [
  'request_succeeded', 'bounded_response_received', 'utf8_valid', 'xml_parse_succeeded', 'response_root_valid', 'representation_analysis_completed', 'page_target_detected', 'of_pages_target_detected', 'page_representation', 'of_pages_representation', 'page_depth_bucket', 'of_pages_depth_bucket', 'page_candidate_count_bucket', 'of_pages_candidate_count_bucket', 'page_numeric_class', 'of_pages_numeric_class', 'page_conflicting_candidates', 'of_pages_conflicting_candidates', 'raw_response_retained', 'product_values_retained', 'safe_error_code'
]
const representations = new Set(['none', 'root_attribute', 'descendant_attribute', 'direct_text_element', 'empty_element', 'self_closing_element', 'element_with_attributes', 'element_with_children', 'element_with_attributes_and_children', 'mixed_locations', 'ambiguous', 'structure_unavailable'])
const depths = new Set(['root', 'depth_1', 'depth_2_to_3', 'depth_4_to_6', 'over_6', 'none', 'unknown'])
const counts = new Set(['none', 'one', 'two', 'three_to_five', 'over_five', 'unknown'])
const numeric = new Set(['no_candidate', 'empty', 'whitespace_only', 'unsigned_decimal', 'zero', 'negative_or_signed', 'non_numeric', 'overflow', 'conflicting', 'unknown'])
const safeErrors = new Set(['invalid_input', 'invalid_origin', 'ca_file_invalid', 'transport_failed', 'timeout', 'response_too_large', 'http_rejected', 'invalid_utf8', 'xml_invalid', 'xml_unsafe', 'structure_limit_exceeded', 'response_root_invalid', 'representation_analysis_failed', 'result_too_large', 'unexpected_failure'])

function analyze(xml) {
  return analyzePaginationRepresentation(Buffer.from(xml, 'utf8'))
}

function contract(result) {
  assert.deepEqual(Object.keys(result), fields)
  assert.equal(result.raw_response_retained, false)
  assert.equal(result.product_values_retained, false)
  assert.ok(representations.has(result.page_representation))
  assert.ok(representations.has(result.of_pages_representation))
  assert.ok(depths.has(result.page_depth_bucket))
  assert.ok(depths.has(result.of_pages_depth_bucket))
  assert.ok(counts.has(result.page_candidate_count_bucket))
  assert.ok(counts.has(result.of_pages_candidate_count_bucket))
  assert.ok(numeric.has(result.page_numeric_class))
  assert.ok(numeric.has(result.of_pages_numeric_class))
  assert.ok(result.safe_error_code === null || safeErrors.has(result.safe_error_code))
  assert.ok(Buffer.byteLength(serializeRepresentationResult(result)) <= LIMITS.outputBytes)
}

function pair(result, expected) {
  contract(result)
  for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value, key)
}

test('uses the exact fixed page-one request boundary without a transport path', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.equal(COMMAND, 'vPLUs')
  assert.equal(PAGE1_XML, '<domain:PLUSelect xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><pageSize>100</pageSize><page>1</page></domain:PLUSelect>')
  assert.equal(buildPage1Body('fixture-cookie'), `cmd=vPLUs&cookie=fixture-cookie\r\n\r\n${PAGE1_XML}`)
  assert.ok(!PAGE1_XML.includes('query'))
  assert.ok(!PAGE1_XML.includes('where'))
  assert.ok(!source.includes('page>2<'))
  assert.ok(!source.includes('uPLUs'))
  assert.ok(!source.includes('supabase'))
  assert.ok(!source.includes('rejectUnauthorized: false'))
  assert.ok(!source.includes("from 'node:https'"))
})

test('classifies root and descendant target attributes', () => {
  pair(analyze(document('', ' page="0001" ofPages="0002"')), {
    page_representation: 'root_attribute', of_pages_representation: 'root_attribute', page_depth_bucket: 'root', of_pages_depth_bucket: 'root', page_candidate_count_bucket: 'one', of_pages_candidate_count_bucket: 'one', page_numeric_class: 'unsigned_decimal', of_pages_numeric_class: 'unsigned_decimal'
  })
  pair(analyze(document('<meta page="1" ofPages="2"/>')), {
    page_representation: 'descendant_attribute', of_pages_representation: 'descendant_attribute', page_depth_bucket: 'depth_1', of_pages_depth_bucket: 'depth_1'
  })
})

test('classifies direct text, empty, and self-closing target elements', () => {
  pair(analyze(document('<page>1</page><ofPages>2</ofPages>')), { page_representation: 'direct_text_element', of_pages_representation: 'direct_text_element', page_numeric_class: 'unsigned_decimal', of_pages_numeric_class: 'unsigned_decimal' })
  pair(analyze(document('<page></page><ofPages></ofPages>')), { page_representation: 'empty_element', of_pages_representation: 'empty_element', page_numeric_class: 'empty', of_pages_numeric_class: 'empty' })
  pair(analyze(document('<page/><ofPages/>')), { page_representation: 'self_closing_element', of_pages_representation: 'self_closing_element', page_numeric_class: 'empty', of_pages_numeric_class: 'empty' })
})

test('classifies the three synthetic historical differential shapes', () => {
  pair(analyze(document('<page/><ofPages/>')), { page_representation: 'self_closing_element', of_pages_representation: 'self_closing_element', page_target_detected: true, of_pages_target_detected: true })
  pair(analyze(document('<page payload="1"/><ofPages payload="2"/>')), { page_representation: 'element_with_attributes', of_pages_representation: 'element_with_attributes', page_numeric_class: 'unsigned_decimal', of_pages_numeric_class: 'unsigned_decimal' })
  pair(analyze(document('<page><payload>1</payload></page><ofPages><payload>2</payload></ofPages>')), { page_representation: 'element_with_children', of_pages_representation: 'element_with_children', page_numeric_class: 'unsigned_decimal', of_pages_numeric_class: 'unsigned_decimal' })
})

test('classifies attribute-and-child containers and mixed locations without paths', () => {
  pair(analyze(document('<page payload="1"><payload>1</payload></page><ofPages payload="2"><payload>2</payload></ofPages>')), { page_representation: 'element_with_attributes_and_children', of_pages_representation: 'element_with_attributes_and_children' })
  pair(analyze(document('<page>1</page>', ' page="1" ofPages="2"')), { page_representation: 'mixed_locations', page_depth_bucket: 'unknown', page_candidate_count_bucket: 'two', of_pages_representation: 'root_attribute' })
})

test('classifies duplicate-equal and conflicting candidates safely', () => {
  pair(analyze(document('<page>001</page><page>1</page><ofPages>0002</ofPages><ofPages>2</ofPages>')), { page_representation: 'direct_text_element', of_pages_representation: 'direct_text_element', page_candidate_count_bucket: 'two', of_pages_candidate_count_bucket: 'two', page_conflicting_candidates: false, of_pages_conflicting_candidates: false })
  pair(analyze(document('<page>1</page><page>2</page><ofPages>2</ofPages>')), { page_representation: 'ambiguous', page_conflicting_candidates: true, page_numeric_class: 'conflicting' })
  pair(analyze(document('<page>1</page><ofPages>2</ofPages><ofPages>3</ofPages>')), { of_pages_representation: 'ambiguous', of_pages_conflicting_candidates: true, of_pages_numeric_class: 'conflicting' })
})

test('handles absent, exact-name, prefix, placement, and record-order cases', () => {
  pair(analyze(document('<page>1</page>')), { page_target_detected: true, of_pages_target_detected: false, of_pages_representation: 'none', of_pages_numeric_class: 'no_candidate' })
  pair(analyze(document('<ofPages>2</ofPages>')), { page_target_detected: false, page_representation: 'none', of_pages_target_detected: true })
  pair(analyze(document('<Page>1</Page><OfPages>2</OfPages><currentPage>3</currentPage>')), { page_target_detected: false, of_pages_target_detected: false })
  pair(analyze(document('<x:page>1</x:page><x:ofPages>2</x:ofPages>')), { page_representation: 'direct_text_element', of_pages_representation: 'direct_text_element' })
  pair(analyze(document(`<page>1</page><ofPages>2</ofPages>${records(100)}`)), { page_representation: 'direct_text_element', of_pages_representation: 'direct_text_element' })
  pair(analyze(document(`${records(100)}<page>1</page><ofPages>2</ofPages>`)), { page_representation: 'direct_text_element', of_pages_representation: 'direct_text_element' })
})

test('uses bounded depth and candidate-count buckets', () => {
  pair(analyze(document('<page>1</page><ofPages>2</ofPages>')), { page_depth_bucket: 'depth_1', of_pages_depth_bucket: 'depth_1' })
  pair(analyze(document(nested(1, '<page>1</page><ofPages>2</ofPages>'))), { page_depth_bucket: 'depth_2_to_3', of_pages_depth_bucket: 'depth_2_to_3' })
  pair(analyze(document(nested(3, '<page>1</page><ofPages>2</ofPages>'))), { page_depth_bucket: 'depth_4_to_6', of_pages_depth_bucket: 'depth_4_to_6' })
  pair(analyze(document(nested(6, '<page>1</page><ofPages>2</ofPages>'))), { page_depth_bucket: 'over_6', of_pages_depth_bucket: 'over_6' })
  pair(analyze(document('<page>1</page><page>1</page><page>1</page><ofPages>2</ofPages><ofPages>2</ofPages><ofPages>2</ofPages>')), { page_candidate_count_bucket: 'three_to_five', of_pages_candidate_count_bucket: 'three_to_five' })
})

test('classifies strict numeric forms without disclosing values', () => {
  const cases = [
    [' 1', 'non_numeric'], ['1 ', 'non_numeric'], ['0', 'zero'], ['0000', 'zero'], ['-1', 'negative_or_signed'], ['+1', 'negative_or_signed'], ['1.0', 'non_numeric'], ['1e2', 'non_numeric'], ['abc', 'non_numeric'], ['1000001', 'overflow']
  ]
  for (const [value, expected] of cases) {
    const result = analyze(document(`<page>${value}</page><ofPages>2</ofPages>`))
    pair(result, { page_numeric_class: expected })
    if (value.trim().length > 1) assert.ok(!serializeRepresentationResult(result).includes(value.trim()))
  }
})

test('rejects malformed, unsafe, invalid UTF-8, and bounded-overflow responses', () => {
  for (const [bytes, code] of [
    [Buffer.from('<domain:PLUs>'), 'xml_invalid'],
    [Buffer.from('<!DOCTYPE x><domain:PLUs/>'), 'xml_unsafe'],
    [Buffer.from('<!ENTITY x "y"><domain:PLUs/>'), 'xml_unsafe'],
    [Buffer.from([0xc3, 0x28]), 'invalid_utf8'],
    [Buffer.from(document(nested(8, '<page>1</page>'))), 'structure_limit_exceeded'],
    [Buffer.from(document('<x/>'.repeat(LIMITS.elements + 1))), 'structure_limit_exceeded'],
    [Buffer.from(document(`<x ${Array.from({ length: LIMITS.attributes + 1 }, (_, index) => `a${index}="1"`).join(' ')}/>`)), 'structure_limit_exceeded'],
    [Buffer.alloc(LIMITS.responseBytes + 1), 'response_too_large']
  ]) {
    const result = analyzePaginationRepresentation(bytes)
    contract(result)
    assert.equal(result.safe_error_code, code)
    assert.equal(result.representation_analysis_completed, false)
  }
  const unique = Array.from({ length: LIMITS.uniqueNames }, (_, index) => `<x${index}/>`).join('')
  assert.equal(analyze(document(unique)).safe_error_code, 'structure_limit_exceeded')
})

test('retains no synthetic values, names, paths, or secret-like sentinels', () => {
  const sentinels = ['fake_cookie_X9', 'fake_user_X9', 'fake_password_X9', 'fake_upc_X9', 'fake_description_X9', 'fake_price_X9', '999983', '913', 'arbitraryElementX9', 'arbitraryAttributeX9', 'childNameX9', '/synthetic/path/X9', 'fake_exception_X9']
  const result = analyze(document(`<page arbitraryAttributeX9="999983"><childNameX9>fake_cookie_X9 fake_user_X9 fake_password_X9 fake_upc_X9 fake_description_X9 fake_price_X9 1</childNameX9></page><ofPages><arbitraryElementX9>913 /synthetic/path/X9 fake_exception_X9</arbitraryElementX9></ofPages>`))
  contract(result)
  const output = serializeRepresentationResult(result)
  for (const sentinel of sentinels) assert.ok(!output.includes(sentinel), sentinel)
  assert.equal(result.page_representation, 'element_with_attributes_and_children')
  assert.equal(result.of_pages_representation, 'element_with_children')
})

test('keeps JSON output bounded and structurally complete for successful analysis', () => {
  const result = analyze(document('<page>1</page><ofPages>2</ofPages>'))
  contract(result)
  assert.equal(result.safe_error_code, null)
  assert.equal(result.representation_analysis_completed, true)
  assert.equal(serializeRepresentationResult(result), JSON.stringify(result))
})
