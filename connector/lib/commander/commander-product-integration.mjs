import { createHash } from 'node:crypto'
import { COMMANDER_NAXML_COMMANDS, CommanderNaxmlError, sendCommanderNaxml } from './commander-naxml-client.mjs'

export const COMMANDER_PRODUCT_NAMESPACE = 'urn:vfi-sapphire:np.domain.2001-07-01'
export const PRODUCT_COMMAND_TYPES = Object.freeze(['update_price', 'create_product', 'update_product', 'deactivate_product', 'reactivate_product', 'delete_product'])
const SUPPORTED_PRODUCT_COMMANDS = new Set(['update_price'])
const REQUIRED_WRITE_FIELDS = new Set(['upc', 'upcModifier', 'description', 'department', 'pcode', 'price', 'SellUnit', 'maxQtyPerTrans', 'taxableRebate', 'flags', 'taxRates', 'idChecks'])

export class CommanderProductError extends Error {
  constructor(code) { super(code); this.name = 'CommanderProductError'; this.code = code }
}
function fail(code) { throw new CommanderProductError(code) }
function text(value, max, code = 'validation_failed', allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.length === 0) || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail(code)
  return value.normalize('NFC')
}
function localName(name) { return name.split(':').at(-1) }
function esc(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;') }
function decode(value) {
  if (/&(?!#(?:x[0-9a-fA-F]+|\d+);|(?:amp|lt|gt|quot|apos);)/.test(value)) fail('vplu_response_invalid')
  return value.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (_, e) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (named[e]) return named[e]
    const n = e.startsWith('#x') ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)
    if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) fail('vplu_response_invalid')
    return String.fromCodePoint(n)
  })
}

// Minimal strict parser for the historical POC schema. It does not resolve DTDs/entities.
function parseXml(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > 1024 * 1024 || /<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)) fail('vplu_response_invalid')
  const stack = []; let root = null; let cursor = 0
  while (cursor < xml.length) {
    if (xml.startsWith('<?xml', cursor)) { const e = xml.indexOf('?>', cursor); if (e < 0) fail('vplu_response_invalid'); cursor = e + 2; continue }
    if (/^\s+/.test(xml.slice(cursor))) { cursor += /^\s+/.exec(xml.slice(cursor))[0].length; continue }
    if (xml.startsWith('</', cursor)) {
      const match = /^<\/([A-Za-z_][\w.:-]*)\s*>/.exec(xml.slice(cursor)); if (!match || stack.length === 0 || stack.at(-1).name !== match[1]) fail('vplu_response_invalid')
      stack.pop(); cursor += match[0].length; continue
    }
    if (xml[cursor] !== '<' || xml.startsWith('<!--', cursor)) fail('vplu_response_invalid')
    const end = xml.indexOf('>', cursor + 1); if (end < 0) fail('vplu_response_invalid')
    const raw = xml.slice(cursor + 1, end); const selfClosing = /\/\s*$/.test(raw)
    const m = /^\s*([A-Za-z_][\w.:-]*)([\s\S]*?)\/?\s*$/.exec(raw); if (!m) fail('vplu_response_invalid')
    const attrs = []; const input = m[2].replace(/\/\s*$/, ''); let ai = 0
    while (ai < input.length) {
      const ws = /^\s+/.exec(input.slice(ai)); if (ws) { ai += ws[0].length; continue }
      const a = /^([A-Za-z_][\w.:-]*)\s*=\s*(["'])([\s\S]*?)\2/.exec(input.slice(ai)); if (!a) fail('vplu_response_invalid')
      if (attrs.some(x => x.name === a[1])) fail('vplu_response_invalid')
      attrs.push({ name: a[1], value: decode(a[3]) }); ai += a[0].length
    }
    const node = { name: m[1], attrs, children: [], text: '' }
    if (stack.length) stack.at(-1).children.push(node); else if (root) fail('vplu_response_invalid'); else root = node
    if (!selfClosing) stack.push(node)
    cursor = end + 1
    const next = xml.indexOf('<', cursor)
    if (!selfClosing && next > cursor) { node.text += decode(xml.slice(cursor, next)); cursor = next }
  }
  if (!root || stack.length) fail('vplu_response_invalid')
  return root
}
function child(node, name, required = false) { const matches = node.children.filter(x => localName(x.name) === name); if (matches.length > 1 || (required && matches.length !== 1)) fail('vplu_response_invalid'); return matches[0] || null }
function value(node) { if (!node || node.children.length) return null; const result = node.text.trim(); return result.length ? result : null }
function serialize(node) { return `<${node.name}${node.attrs.map(a => ` ${a.name}="${esc(a.value)}"`).join('')}>${node.children.map(serialize).join('')}${esc(node.text)}</${node.name}>` }

export function normalizePlu(value) { return text(value, 64) }
export function normalizeModifier(value) { return text(value ?? '', 32, 'validation_failed', true) }
export function normalizeUpc(value) {
  const result = text(value, 32)
  if (!/^\d+$/.test(result)) fail('validation_failed')
  return result
}
export function buildSourceProductKey({ plu, modifier = '' }) { return `plu:${normalizePlu(plu)}|modifier:${normalizeModifier(modifier)}` }
export function normalizeProductIdentity({ plu = null, modifier = '', upc = null }) {
  const normalModifier = normalizeModifier(modifier)
  const normalPlu = plu === null || plu === undefined ? null : normalizePlu(plu)
  const normalUpc = upc === null || upc === undefined ? null : normalizeUpc(upc)
  if (!normalPlu && !normalUpc) fail('validation_failed')
  // The historical POC proves UPC plus modifier selection, but not UPC uniqueness.
  // It is a deterministic workflow key only until a Commander PLU field is captured.
  const sourceProductKey = normalPlu
    ? buildSourceProductKey({ plu: normalPlu, modifier: normalModifier })
    : `upc:${normalUpc}|modifier:${normalModifier}`
  return Object.freeze({ plu: normalPlu, modifier: normalModifier, upc: normalUpc, source_product_key: sourceProductKey, identity_provisional: normalPlu === null })
}
export function sameProductIdentity(a, b) { return a && b && a.source_product_key !== null && a.source_product_key === b.source_product_key }
export function normalizeMoney(value) {
  const input = typeof value === 'number' ? value.toFixed(2) : value
  if (typeof input !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(input)) fail('validation_failed')
  const amount = Number(input); if (!Number.isFinite(amount) || amount < 0 || amount > 999999.99) fail('validation_failed')
  return amount.toFixed(2)
}

export function buildVpluReadXml({ upc, modifier = '000' }) {
  return `<domain:PLUSelect xmlns:domain="${COMMANDER_PRODUCT_NAMESPACE}"><query><where><upc source="keyboard">${esc(normalizeUpc(upc))}</upc><upcModifier>${esc(normalizeModifier(modifier))}</upcModifier></where></query><pageSize>100</pageSize><page>1</page></domain:PLUSelect>`
}
export function parseVpluResponse(xml) {
  const root = parseXml(xml)
  if (root.name !== 'domain:PLUs' || root.attrs.find(a => a.name === 'xmlns:domain')?.value !== COMMANDER_PRODUCT_NAMESPACE) fail('vplu_response_invalid')
  const nodes = root.children.filter(n => n.name === 'domain:PLU')
  if (!nodes.length) return []
  const products = nodes.map(node => {
    for (const required of REQUIRED_WRITE_FIELDS) child(node, required, true)
    const upc = value(child(node, 'upc', true)); const modifier = value(child(node, 'upcModifier', true)); const description = value(child(node, 'description', true)); const price = value(child(node, 'price', true))
    if (!upc || !modifier || !description || !price) fail('vplu_response_invalid')
    const parsed = {
      ...normalizeProductIdentity({ plu: value(child(node, 'plu', false)), modifier, upc }),
      description: text(description, 512, 'vplu_response_invalid'), retail_price: normalizeMoney(price), cost: null,
      department_number: value(child(node, 'department', true)), department_name: null, category_number: null, category_name: null,
      tax_number: null, tax_name: null, age_restriction: null, active: null,
      raw_payload_hash: createHash('sha256').update(serialize(node), 'utf8').digest('hex'),
      // Internal structured template lets the proven update-price envelope preserve returned fields without exposing raw XML.
      _write_template: node,
    }
    return parsed
  })
  const seen = new Set(); for (const product of products) {
    const responseKey = product.source_product_key
    if (seen.has(responseKey)) fail('duplicate_product_identity')
    seen.add(responseKey)
  }
  return products
}
export function readCatalogPage() { return { status: 'unsupported_operation', error_code: 'pagination_schema_unverified' } }
export function findProductByIdentity(products, identity) { return products.find(product => sameProductIdentity(product, identity)) || null }

/** Reads one UPC/modifier selection through the injected-or-pinned NAXML transport. */
export async function readCommanderProduct({ origin, sessionCookie, certificatePath, trust, upc, modifier = '000', transport }) {
  try {
    const response = await sendCommanderNaxml({
      origin,
      certificatePath, trust,
      transport,
      request: { command: 'vPLUs', sessionCookie, xml: buildVpluReadXml({ upc, modifier }) },
    })
    if (response.status === 401 || response.status === 403) return { status: 'session_failed' }
    if (response.status < 200 || response.status >= 300) return { status: 'readback_failed' }
    const products = parseVpluResponse(response.body)
    const selected = products.filter(product => product.upc === normalizeUpc(upc) && product.modifier === normalizeModifier(modifier))
    return selected.length === 1 ? { status: 'success', product: selected[0] } : { status: 'product_not_found' }
  } catch (error) {
    if (error?.code === 'commander_tls_hostname_invalid' || error?.code === 'commander_tls_peer_mismatch') return { status: error.code }
    return { status: error?.code === 'response_invalid' || error?.code === 'response_too_large' ? 'readback_failed' : 'session_failed' }
  }
}

// Full-catalog page/continuation semantics are not represented in repository evidence.
export async function readCommanderCatalog() { return { status: 'unsupported_operation', error_code: 'pagination_schema_unverified' } }

export function validateProductCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) fail('validation_failed')
  const allowed = new Set(['command_id', 'command_type', 'source_product_key', 'identity', 'expected_current', 'requested_changes', 'approval', 'created_at', 'idempotency_key'])
  if (Object.keys(command).some(key => !allowed.has(key))) fail('validation_failed')
  if (!PRODUCT_COMMAND_TYPES.includes(command.command_type) || !/^[A-Za-z0-9._:-]{1,128}$/.test(command.command_id || '') || !/^[A-Za-z0-9._:-]{1,128}$/.test(command.idempotency_key || '') || !command.identity || !command.requested_changes || !/^\d{4}-\d{2}-\d{2}T/.test(command.created_at || '')) fail('validation_failed')
  const identity = normalizeProductIdentity(command.identity)
  if (command.source_product_key !== identity.source_product_key) fail('validation_failed')
  if (command.expected_current !== undefined && command.expected_current !== null) {
    if (typeof command.expected_current !== 'object' || Array.isArray(command.expected_current) || Object.keys(command.expected_current).some(key => key !== 'retail_price')) fail('validation_failed')
    if (Object.hasOwn(command.expected_current, 'retail_price')) normalizeMoney(command.expected_current.retail_price)
  }
  if (command.approval !== undefined && command.approval !== null) {
    if (typeof command.approval !== 'object' || Array.isArray(command.approval) || Object.keys(command.approval).some(key => key !== 'approval_id' && key !== 'approved_at') || !/^[A-Za-z0-9._:-]{1,128}$/.test(command.approval.approval_id || '') || !/^\d{4}-\d{2}-\d{2}T/.test(command.approval.approved_at || '')) fail('validation_failed')
  }
  if (command.command_type === 'update_price') {
    if (Object.keys(command.requested_changes).length !== 1 || !Object.hasOwn(command.requested_changes, 'retail_price')) fail('validation_failed')
    return Object.freeze({ ...command, identity, requested_changes: { retail_price: normalizeMoney(command.requested_changes.retail_price) } })
  }
  if (typeof command.requested_changes !== 'object' || Array.isArray(command.requested_changes) || Object.keys(command.requested_changes).some(key => !['description', 'retail_price', 'cost', 'active'].includes(key))) fail('validation_failed')
  if (Object.hasOwn(command.requested_changes, 'description')) text(command.requested_changes.description, 512)
  if (Object.hasOwn(command.requested_changes, 'retail_price')) normalizeMoney(command.requested_changes.retail_price)
  if (Object.hasOwn(command.requested_changes, 'cost')) normalizeMoney(command.requested_changes.cost)
  if (Object.hasOwn(command.requested_changes, 'active') && typeof command.requested_changes.active !== 'boolean') fail('validation_failed')
  return Object.freeze({ ...command, identity })
}
export function buildUpdatePriceXml(product, requestedPrice) {
  if (!product?._write_template || product._write_template.name !== 'domain:PLU') fail('product_field_not_supported')
  const template = product._write_template
  if (template.children.some(field => !REQUIRED_WRITE_FIELDS.has(localName(field.name)) && localName(field.name) !== 'fees')) fail('product_field_not_supported')
  const fields = template.children.map(field => localName(field.name) === 'price' ? `<${field.name}${field.attrs.map(a => ` ${a.name}="${esc(a.value)}"`).join('')}>${normalizeMoney(requestedPrice)}</${field.name}>` : serialize(field)).join('')
  return `<domain:PLUs xmlns:domain="${COMMANDER_PRODUCT_NAMESPACE}" xmlns:vs="urn:vfi-sapphire:vs.2001-10-01" page="1" ofPages="1"><domain:PLU>${fields}</domain:PLU></domain:PLUs>`
}
export function buildProductWriteXml(command, product) {
  const validated = validateProductCommand(command)
  if (validated.command_type === 'update_price') return { supported: true, command: 'uPLUs', xml: buildUpdatePriceXml(product, validated.requested_changes.retail_price) }
  if (validated.command_type === 'create_product') return { supported: false, error_code: 'create_product_schema_unverified' }
  if (validated.command_type === 'deactivate_product' || validated.command_type === 'reactivate_product') return { supported: false, error_code: 'product_status_schema_unverified' }
  if (validated.command_type === 'delete_product') return { supported: false, error_code: 'permanent_delete_not_supported' }
  return { supported: false, error_code: 'product_field_not_supported' }
}
export async function sendSupportedProductWrite({ origin, sessionCookie, certificatePath, trust, command, product, transport }) {
  const write = buildProductWriteXml(command, product)
  if (!write.supported) return { status: 'unsupported_operation', error_code: write.error_code }
  try {
    const response = await sendCommanderNaxml({ origin, certificatePath, trust, transport, request: { command: write.command, sessionCookie, xml: write.xml } })
    return response.status >= 200 && response.status < 300 && isKnownEmptyVfiSuccess(response.body) ? { status: 'success' } : { status: 'write_failed' }
  } catch { return { status: 'write_failed' } }
}
export function isKnownEmptyVfiSuccess(xml) {
  try { const root = parseXml(xml); return localName(root.name) === 'Response' && root.attrs.length === 1 && root.attrs[0].value === COMMANDER_PRODUCT_NAMESPACE && root.children.length === 0 && root.text.trim() === '' } catch { return false }
}

function equivalentCurrent(expected, current) { return !expected || Object.entries(expected).every(([key, value]) => current[key] === value) }
function finalMatches(command, product) { return command.command_type === 'update_price' && product.retail_price === command.requested_changes.retail_price }
export function createIdempotencyStore() {
  const entries = new Map()
  return {
    get(command) { const entry = entries.get(command.idempotency_key); if (!entry) return null; return entry.fingerprint === JSON.stringify(command) ? entry.result : 'idempotency_key_conflict' },
    put(command, result) { entries.set(command.idempotency_key, { fingerprint: JSON.stringify(command), result }); },
  }
}
/** Offline-injectable workflow. It never creates a session or network transport itself. */
export async function executeProductCommand({ command, sessionProvider, readProduct, writeProduct, idempotencyStore = createIdempotencyStore() }) {
  let validated
  try { validated = validateProductCommand(command) } catch { return { status: 'validation_failed' } }
  const prior = idempotencyStore.get(validated); if (prior) return prior === 'idempotency_key_conflict' ? { status: 'validation_failed', error_code: prior } : prior
  if (!SUPPORTED_PRODUCT_COMMANDS.has(validated.command_type)) return { status: 'unsupported_operation', error_code: buildProductWriteXml(validated, null).error_code }
  let session = null
  try {
    session = await sessionProvider()
    if (!session) return { status: 'session_failed' }
    const current = await readProduct({ identity: validated.identity, session })
    if (!current) return { status: 'product_not_found' }
    if (!equivalentCurrent(validated.expected_current, current)) return { status: 'product_conflict' }
    if (finalMatches(validated, current)) { const result = { status: 'success', idempotent: true }; idempotencyStore.put(validated, result); return result }
    const write = buildProductWriteXml(validated, current)
    try {
      const outcome = await writeProduct({ session, command: write.command, xml: write.xml })
      if (!outcome || outcome.ok !== true) return { status: 'write_failed' }
    } catch { return { status: 'write_outcome_unknown' } }
    const readback = await readProduct({ identity: validated.identity, session })
    if (!readback) return { status: 'readback_failed' }
    if (!finalMatches(validated, readback)) return { status: 'readback_mismatch' }
    const result = { status: 'success', idempotent: false }; idempotencyStore.put(validated, result); return result
  } catch { return { status: 'internal_failure' } } finally { session = null }
}

export function reconcileCommanderCatalog({ commanderProducts, storePulseProducts, completeCatalog }) {
  const result = { inserts: [], commander_updates: [], unchanged: [], storepulse_only: [], commander_only: [], conflicts: [], missing_from_commander: [], proposed_deactivations: [], manual_review: [] }
  const stores = new Map(storePulseProducts.map(p => [p.source_product_key, p]))
  const seen = new Set()
  for (const commander of commanderProducts) {
    if (!commander.source_product_key) { result.manual_review.push(commander); continue }
    if (seen.has(commander.source_product_key)) { result.conflicts.push(commander); continue }; seen.add(commander.source_product_key)
    const existing = stores.get(commander.source_product_key)
    if (!existing) { result.inserts.push(commander); result.commander_only.push(commander); continue }
    if (existing.pos_payload_hash === commander.raw_payload_hash) result.unchanged.push(commander)
    else if (existing.local_changed && existing.commander_changed) result.conflicts.push({ commander, storepulse: existing })
    else result.commander_updates.push({ commander, storepulse: existing })
  }
  for (const existing of storePulseProducts) if (!seen.has(existing.source_product_key)) {
    result.storepulse_only.push(existing)
    if (completeCatalog) { result.missing_from_commander.push(existing); result.proposed_deactivations.push(existing) }
  }
  return result
}

export function validateFutureProductQueueCommand(command) {
  return command && ['create_product', 'update_product', 'deactivate_product', 'reactivate_product'].includes(command.command_type) ? { valid: true, executable: false, error_code: 'product_queue_execution_disabled' } : { valid: false, executable: false, error_code: 'validation_failed' }
}

export { COMMANDER_NAXML_COMMANDS, CommanderNaxmlError, sendCommanderNaxml }
