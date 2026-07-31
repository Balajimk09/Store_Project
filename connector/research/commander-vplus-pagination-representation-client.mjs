export const COMMAND = 'vPLUs'
export const PAGE1_XML = '<domain:PLUSelect xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><pageSize>100</pageSize><page>1</page></domain:PLUSelect>'

export const LIMITS = Object.freeze({ responseBytes: 1048576, depth: 8, elements: 5000, attributes: 5000, uniqueNames: 128, outputBytes: 8192 })
const EXPECTED_NAMESPACE = 'urn:vfi-sapphire:np.domain.2001-07-01'
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/
const TARGETS = ['page', 'ofPages']
const REPRESENTATIONS = new Set(['none', 'root_attribute', 'descendant_attribute', 'direct_text_element', 'empty_element', 'self_closing_element', 'element_with_attributes', 'element_with_children', 'element_with_attributes_and_children', 'mixed_locations', 'ambiguous', 'structure_unavailable'])
const DEPTH_BUCKETS = new Set(['root', 'depth_1', 'depth_2_to_3', 'depth_4_to_6', 'over_6', 'none', 'unknown'])
const COUNT_BUCKETS = new Set(['none', 'one', 'two', 'three_to_five', 'over_five', 'unknown'])
const NUMERIC_CLASSES = new Set(['no_candidate', 'empty', 'whitespace_only', 'unsigned_decimal', 'zero', 'negative_or_signed', 'non_numeric', 'overflow', 'conflicting', 'unknown'])
const SAFE_ERRORS = new Set(['invalid_input', 'invalid_origin', 'ca_file_invalid', 'transport_failed', 'timeout', 'response_too_large', 'http_rejected', 'invalid_utf8', 'xml_invalid', 'xml_unsafe', 'structure_limit_exceeded', 'response_root_invalid', 'representation_analysis_failed', 'result_too_large', 'unexpected_failure'])
const FIELDS = ['request_succeeded', 'bounded_response_received', 'utf8_valid', 'xml_parse_succeeded', 'response_root_valid', 'representation_analysis_completed', 'page_target_detected', 'of_pages_target_detected', 'page_representation', 'of_pages_representation', 'page_depth_bucket', 'of_pages_depth_bucket', 'page_candidate_count_bucket', 'of_pages_candidate_count_bucket', 'page_numeric_class', 'of_pages_numeric_class', 'page_conflicting_candidates', 'of_pages_conflicting_candidates', 'raw_response_retained', 'product_values_retained', 'safe_error_code']

const local = name => name.split(':').at(-1)
const failure = code => { throw new Error(code) }
const safe = code => SAFE_ERRORS.has(code) ? code : 'unexpected_failure'
const depthBucket = depth => depth === 0 ? 'root' : depth === 1 ? 'depth_1' : depth <= 3 ? 'depth_2_to_3' : depth <= 6 ? 'depth_4_to_6' : 'over_6'
const countBucket = count => count === 0 ? 'none' : count === 1 ? 'one' : count === 2 ? 'two' : count <= 5 ? 'three_to_five' : 'over_five'

function empty(code = null, state = {}) {
  return {
    request_succeeded: state.request_succeeded ?? true,
    bounded_response_received: state.bounded_response_received ?? true,
    utf8_valid: state.utf8_valid ?? false,
    xml_parse_succeeded: state.xml_parse_succeeded ?? false,
    response_root_valid: false,
    representation_analysis_completed: false,
    page_target_detected: false,
    of_pages_target_detected: false,
    page_representation: 'structure_unavailable',
    of_pages_representation: 'structure_unavailable',
    page_depth_bucket: 'unknown',
    of_pages_depth_bucket: 'unknown',
    page_candidate_count_bucket: 'unknown',
    of_pages_candidate_count_bucket: 'unknown',
    page_numeric_class: 'unknown',
    of_pages_numeric_class: 'unknown',
    page_conflicting_candidates: false,
    of_pages_conflicting_candidates: false,
    raw_response_retained: false,
    product_values_retained: false,
    safe_error_code: code
  }
}

export function buildPage1Body(cookie) {
  if (typeof cookie !== 'string' || !cookie || /[\r\n]/.test(cookie)) failure('invalid_input')
  return `cmd=${COMMAND}&cookie=${encodeURIComponent(cookie)}\r\n\r\n${PAGE1_XML}`
}

function parseAttributes(text, names) {
  const attributes = []
  const expression = /([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(["'])(.*?)\2/g
  let match
  while ((match = expression.exec(text))) {
    const name = local(match[1])
    if (!NAME.test(name)) failure('xml_unsafe')
    names.add(name)
    attributes.push({ raw: match[1], name, value: match[3] })
  }
  if (text.replace(expression, '').replace(/\s+/g, '') !== '') failure('xml_invalid')
  return attributes
}

function numericClass(values) {
  if (!values.length) return { kind: 'empty', conflicting: false }
  const classifications = []
  const valid = new Set()
  for (const value of values) {
    if (value === '') { classifications.push('empty'); continue }
    if (value.trim() === '') { classifications.push('whitespace_only'); continue }
    if (!/^[0-9]+$/.test(value)) { classifications.push(/^[+-]/.test(value) ? 'negative_or_signed' : 'non_numeric'); continue }
    const normalized = value.replace(/^0+(?=\d)/, '')
    const number = BigInt(normalized)
    if (number === 0n) { classifications.push('zero'); continue }
    if (number > 1000000n) { classifications.push('overflow'); continue }
    classifications.push('unsigned_decimal')
    valid.add(normalized)
  }
  if (valid.size > 1) return { kind: 'conflicting', conflicting: true }
  if (classifications.includes('overflow')) return { kind: 'overflow', conflicting: false }
  if (classifications.includes('negative_or_signed')) return { kind: 'negative_or_signed', conflicting: false }
  if (classifications.includes('non_numeric')) return { kind: 'non_numeric', conflicting: false }
  if (classifications.includes('zero')) return { kind: 'zero', conflicting: false }
  if (classifications.includes('unsigned_decimal')) return { kind: 'unsigned_decimal', conflicting: false }
  if (classifications.includes('whitespace_only')) return { kind: 'whitespace_only', conflicting: false }
  return { kind: 'empty', conflicting: false }
}

function targetSummary(candidates) {
  if (!candidates.length) return { detected: false, representation: 'none', depth: 'none', count: 'none', numeric: 'no_candidate', conflicting: false }
  const numeric = numericClass(candidates.flatMap(candidate => candidate.values))
  const kinds = new Set(candidates.map(candidate => candidate.kind))
  const depths = new Set(candidates.map(candidate => depthBucket(candidate.depth)))
  const representation = numeric.conflicting ? 'ambiguous' : kinds.size === 1 ? [...kinds][0] : 'mixed_locations'
  return { detected: true, representation, depth: depths.size === 1 ? [...depths][0] : 'unknown', count: countBucket(candidates.length), numeric: numeric.kind, conflicting: numeric.conflicting }
}

function parse(xml) {
  if (/<!DOCTYPE|<!ENTITY|<\?[^x]/i.test(xml)) failure('xml_unsafe')
  const tags = [...xml.matchAll(/<!--[\s\S]*?-->|<[^>]*>/g)]
  if (!tags.length) failure('xml_invalid')
  const stack = []
  const candidates = { page: [], ofPages: [] }
  const names = new Set()
  let elements = 0
  let attributes = 0
  let root = null
  let cursor = 0
  for (const token of tags) {
    const text = xml.slice(cursor, token.index)
    cursor = token.index + token[0].length
    if (text) {
      if (!stack.length && text.trim()) failure('xml_invalid')
      for (const node of stack) if (node.target) node.descendantText.push(text)
      if (stack.length) stack.at(-1).directText.push(text)
    }
    const tag = token[0]
    if (/^<!--/.test(tag)) continue
    if (/^<\?xml\s/i.test(tag)) continue
    if (/^<\//.test(tag)) {
      const raw = tag.slice(2, -1).trim()
      if (!stack.length || stack.at(-1).raw !== raw) failure('xml_invalid')
      const node = stack.pop()
      if (node.target) candidates[node.target].push(node.toCandidate())
      continue
    }
    if (/^<!/.test(tag)) failure('xml_unsafe')
    const match = /^<([A-Za-z_][A-Za-z0-9_.:-]*)([\s\S]*?)(\/?)>$/.exec(tag)
    if (!match) failure('xml_invalid')
    const raw = match[1]
    const name = local(raw)
    if (!NAME.test(name)) failure('xml_unsafe')
    names.add(name)
    if (++elements > LIMITS.elements || names.size > LIMITS.uniqueNames || stack.length >= LIMITS.depth) failure('structure_limit_exceeded')
    const attrs = parseAttributes(match[2], names)
    attributes += attrs.length
    if (attributes > LIMITS.attributes) failure('structure_limit_exceeded')
    const depth = stack.length
    if (!root) root = { raw, name, attrs }
    else if (!stack.length) failure('xml_invalid')
    if (depth === 0) for (const attribute of attrs) if (TARGETS.includes(attribute.name)) candidates[attribute.name].push({ kind: 'root_attribute', depth, values: [attribute.value] })
    if (depth > 0) for (const attribute of attrs) if (TARGETS.includes(attribute.name)) candidates[attribute.name].push({ kind: 'descendant_attribute', depth, values: [attribute.value] })
    const target = TARGETS.includes(name) ? name : null
    const node = {
      raw,
      target,
      depth,
      attrs,
      selfClosing: match[3] === '/',
      hasChildren: false,
      directText: [],
      descendantText: [],
      toCandidate() {
        const direct = this.directText.join('')
        const kind = this.attrs.length && this.hasChildren ? 'element_with_attributes_and_children' : this.attrs.length ? 'element_with_attributes' : this.selfClosing ? 'self_closing_element' : this.hasChildren ? 'element_with_children' : direct !== '' ? 'direct_text_element' : 'empty_element'
        return { kind, depth: this.depth, values: [...this.attrs.map(attribute => attribute.value), direct, ...this.descendantText] }
      }
    }
    if (stack.length) stack.at(-1).hasChildren = true
    if (node.selfClosing) { if (target) candidates[target].push(node.toCandidate()) } else stack.push(node)
  }
  if (xml.slice(cursor).trim() || stack.length || !root) failure('xml_invalid')
  const prefix = root.raw.includes(':') ? root.raw.split(':')[0] : null
  const namespace = prefix ? root.attrs.find(attribute => attribute.raw === `xmlns:${prefix}`)?.value : null
  return { rootValid: root.name === 'PLUs' && namespace === EXPECTED_NAMESPACE, candidates }
}

function enforceContract(result) {
  if (JSON.stringify(result).length > LIMITS.outputBytes) return empty('result_too_large')
  if (Object.keys(result).join('|') !== FIELDS.join('|')) return empty('unexpected_failure')
  if (!REPRESENTATIONS.has(result.page_representation) || !REPRESENTATIONS.has(result.of_pages_representation) || !DEPTH_BUCKETS.has(result.page_depth_bucket) || !DEPTH_BUCKETS.has(result.of_pages_depth_bucket) || !COUNT_BUCKETS.has(result.page_candidate_count_bucket) || !COUNT_BUCKETS.has(result.of_pages_candidate_count_bucket) || !NUMERIC_CLASSES.has(result.page_numeric_class) || !NUMERIC_CLASSES.has(result.of_pages_numeric_class) || (result.safe_error_code !== null && !SAFE_ERRORS.has(result.safe_error_code))) return empty('unexpected_failure')
  return result
}

export function analyzePaginationRepresentation(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes)
  if (bytes.length > LIMITS.responseBytes) return empty('response_too_large', { bounded_response_received: false })
  let xml
  try { xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return empty('invalid_utf8', { utf8_valid: false }) }
  let parsed
  try { parsed = parse(xml) } catch (error) {
    const code = safe(error.message)
    return empty(code, { utf8_valid: true, xml_parse_succeeded: code === 'structure_limit_exceeded' })
  }
  if (!parsed.rootValid) return empty('response_root_invalid', { utf8_valid: true, xml_parse_succeeded: true })
  const page = targetSummary(parsed.candidates.page)
  const ofPages = targetSummary(parsed.candidates.ofPages)
  return enforceContract({
    request_succeeded: true,
    bounded_response_received: true,
    utf8_valid: true,
    xml_parse_succeeded: true,
    response_root_valid: true,
    representation_analysis_completed: true,
    page_target_detected: page.detected,
    of_pages_target_detected: ofPages.detected,
    page_representation: page.representation,
    of_pages_representation: ofPages.representation,
    page_depth_bucket: page.depth,
    of_pages_depth_bucket: ofPages.depth,
    page_candidate_count_bucket: page.count,
    of_pages_candidate_count_bucket: ofPages.count,
    page_numeric_class: page.numeric,
    of_pages_numeric_class: ofPages.numeric,
    page_conflicting_candidates: page.conflicting,
    of_pages_conflicting_candidates: ofPages.conflicting,
    raw_response_retained: false,
    product_values_retained: false,
    safe_error_code: null
  })
}

export function serializeRepresentationResult(result) {
  const checked = enforceContract(result)
  return JSON.stringify(checked)
}
