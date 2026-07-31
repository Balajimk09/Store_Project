import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMAND, PAGE2_XML, analyzePage2Probe } from '../research/commander-vplus-page2-probe-client.mjs'

const xml = body => Buffer.from(`<domain:PLUs xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01">${body}</domain:PLUs>`)
test('uses the sole fixed read-only page-two request', () => {
  assert.equal(COMMAND, 'vPLUs')
  assert.equal(PAGE2_XML, '<domain:PLUSelect xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><pageSize>100</pageSize><page>2</page></domain:PLUSelect>')
  assert.equal(PAGE2_XML.includes('query'), false)
  assert.equal(PAGE2_XML.includes('where'), false)
})
test('distinguishes records, zero records, and ambiguous representation without retaining values', () => {
  const records = analyzePage2Probe(xml('<PLU/><PLU/><page>2</page><ofPages>3</ofPages>'))
  assert.equal(records.safe_error_code, null);assert.equal(records.page_two_records_detected, true);assert.equal(records.plu_count_bucket, '1-10');assert.equal(records.raw_response_retained, false);assert.equal(records.product_values_retained, false)
  const empty = analyzePage2Probe(xml('<page>2</page><ofPages>2</ofPages>'))
  assert.equal(empty.safe_error_code, null);assert.equal(empty.page_two_records_detected, false);assert.equal(empty.plu_count_bucket, '0')
  const ambiguous = analyzePage2Probe(xml('<PLU/><page>2</page><page>3</page><ofPages>3</ofPages><ofPages>4</ofPages>'))
  assert.equal(ambiguous.safe_error_code, null);assert.equal(ambiguous.page_representation, 'ambiguous');assert.equal(ambiguous.of_pages_representation, 'ambiguous')
})
test('keeps malformed XML safe', () => assert.equal(analyzePage2Probe(Buffer.from('<domain:PLUs>')).safe_error_code, 'xml_invalid'))
