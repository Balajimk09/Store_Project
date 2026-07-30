import assert from 'node:assert/strict'
import test from 'node:test'
import { PAGE1_XML, analyzeStructure, buildPage1Body } from '../research/commander-vplus-page1-structure-client.mjs'

const root = body => `<domain:PLUs xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01">${body}</domain:PLUs>`
const record = '<domain:PLU><fakeField>fake</fakeField></domain:PLU>'
test('page-one request bytes and framing are fixed and unfiltered', () => {
  assert.equal(PAGE1_XML, '<domain:PLUSelect xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><pageSize>100</pageSize><page>1</page></domain:PLUSelect>')
  const body = buildPage1Body('fake cookie')
  assert.equal(body, `cmd=vPLUs&cookie=fake%20cookie\r\n\r\n${PAGE1_XML}`)
  for (const forbidden of ['query','where','upc','Modifier','uPLUs','<page>2</page>']) assert.equal(PAGE1_XML.includes(forbidden), false)
})
test('structural analysis returns only bounded metadata', () => {
  const value = analyzeStructure(Buffer.from(root(`<meta/><nextPage token="fake"/>${record}${record}`)))
  assert.equal(Object.keys(value).length, 18); assert.equal(value.root_local_name, 'PLUs'); assert.equal(value.record_element_candidate, 'PLU'); assert.equal(value.record_count_bucket, '2-10'); assert.deepEqual(value.pagination_candidate_names, ['nextPage']); assert.equal(JSON.stringify(value).includes('>fake<'), false); assert.equal(value.raw_response_retained, false); assert.equal(value.product_values_retained, false)
})
test('synthetic malformed, unsafe, and bounded structures fail closed', () => {
  for (const xml of ['<x>', '<!DOCTYPE x><x/>', '<!ENTITY x "y"><x/>', root('<x>'.repeat(9) + '</x>'.repeat(9)), Buffer.alloc(1048577)]) assert.throws(() => analyzeStructure(xml))
  const huge = root(Array.from({length:5001},(_,i)=>`<x${i}/>`).join('')); assert.throws(() => analyzeStructure(huge))
  assert.throws(() => analyzeStructure(Buffer.from([0xff])))
})
