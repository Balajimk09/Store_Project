import { createHash } from 'node:crypto'
import { COMMANDER_NAXML_COMMANDS, CommanderNaxmlError, sendCommanderNaxml } from './commander-naxml-client.mjs'
import {
  buildCommanderVpluSelectXml,
  sendCommanderVpluReadRequest,
} from './commander-vplu-read-client.mjs'

export const COMMANDER_PRODUCT_NAMESPACE = 'urn:vfi-sapphire:np.domain.2001-07-01'
export const PRODUCT_COMMAND_TYPES = Object.freeze(['update_price', 'create_product', 'update_product', 'deactivate_product', 'reactivate_product', 'delete_product'])
const SUPPORTED_PRODUCT_COMMANDS = new Set(['update_price', 'create_product', 'update_product'])
const REQUIRED_WRITE_FIELDS = new Set(['upc', 'upcModifier', 'description', 'department', 'pcode', 'price', 'SellUnit', 'maxQtyPerTrans', 'taxableRebate'])
const OPTIONAL_REFERENCE_FIELDS = new Set(['flags', 'taxRates', 'idChecks'])
const MUTABLE_WRITE_FIELDS = new Set(['description', 'department', 'pcode', 'price', 'SellUnit', 'maxQtyPerTrans', 'taxableRebate', 'taxRates', 'idChecks'])

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
export function normalizeDepartmentNumber(value) {
  const result = text(value, 16)
  if (!/^\d{1,16}$/.test(result)) fail('validation_failed')
  return result
}

function normalizeCommanderSysid(value, code = 'validation_failed') {
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value)) fail(code)
  return value
}

function normalizeFixedDecimal(
  value,
  fractionDigits,
  maxWholeDigits = 6,
  code = 'validation_failed',
) {
  const input = typeof value === 'number' ? String(value) : value
  if (typeof input !== 'string') fail(code)

  const pattern = new RegExp(
    `^(?:0|[1-9]\\d{0,${maxWholeDigits - 1}})(?:\\.\\d{1,${fractionDigits}})?$`,
  )

  if (!pattern.test(input)) fail(code)

  const amount = Number(input)

  if (!Number.isFinite(amount) || amount < 0) fail(code)

  return amount.toFixed(fractionDigits)
}

function normalizeCommanderSysidList(value, code = 'validation_failed') {
  if (!Array.isArray(value) || value.length > 16) fail(code)

  const result = value.map(item => normalizeCommanderSysid(item, code))

  if (new Set(result).size !== result.length) fail(code)

  return Object.freeze(result)
}

function normalizeCreateUpc(value) {
  if (typeof value !== 'string' || !/^\d{14}$/.test(value)) {
    fail('validation_failed')
  }

  return value
}

function normalizeCreateModifier(value) {
  if (typeof value !== 'string' || !/^\d{3}$/.test(value)) {
    fail('validation_failed')
  }

  return value
}

function normalizeExactCreateDecimal(value, fractionDigits) {
  if (typeof value !== 'string') {
    fail('validation_failed')
  }

  const pattern = new RegExp(
    `^(?:0|[1-9]\\d{0,5})\\.\\d{${fractionDigits}}$`,
  )

  if (!pattern.test(value) || !Number.isFinite(Number(value))) {
    fail('validation_failed')
  }

  return value
}

function normalizeRequiredCreateSysidList(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    fail('validation_failed')
  }

  const normalized = []

  for (const item of value) {
    const sysid = normalizeCommanderSysid(item)

    if (!normalized.includes(sysid)) {
      normalized.push(sysid)
    }
  }

  if (normalized.length === 0) {
    fail('validation_failed')
  }

  return Object.freeze(normalized)
}

function normalizeCreateProductInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('validation_failed')
  }

  const requiredKeys = [
    'upc',
    'modifier',
    'description',
    'price',
    'sellUnit',
    'departmentSysId',
    'maxQtyPerTrans',
    'pcode',
    'idCheckSysIds',
    'taxRateSysIds',
    'flagSysIds',
    'taxableRebateAmount',
  ]

  const keys = Object.keys(input)

  if (
    keys.length !== requiredKeys.length
    || keys.some(key => !requiredKeys.includes(key))
    || requiredKeys.some(key => !Object.hasOwn(input, key))
  ) {
    fail('validation_failed')
  }

  return Object.freeze({
    upc: normalizeCreateUpc(input.upc),
    modifier: normalizeCreateModifier(input.modifier),
    description: text(input.description, 512),
    price: normalizeExactCreateDecimal(input.price, 2),
    sellUnit: normalizeExactCreateDecimal(input.sellUnit, 3),
    departmentSysId: normalizeCommanderSysid(input.departmentSysId),
    maxQtyPerTrans: normalizeExactCreateDecimal(input.maxQtyPerTrans, 2),
    pcode: normalizeCommanderSysid(input.pcode),
    idCheckSysIds: normalizeRequiredCreateSysidList(input.idCheckSysIds),
    taxRateSysIds: normalizeRequiredCreateSysidList(input.taxRateSysIds),
    flagSysIds: normalizeRequiredCreateSysidList(input.flagSysIds),
    taxableRebateAmount: normalizeExactCreateDecimal(
      input.taxableRebateAmount,
      2,
    ),
  })
}

function createProductInputFromCommand(command, identity) {
  const requiredRequestedKeys = [
    'description',
    'retail_price',
    'department_number',
    'payment_product_code',
    'selling_unit',
    'maximum_quantity_per_transaction',
    'taxable_rebate',
    'tax_rate_ids',
    'id_check_ids',
    'flag_ids',
  ]

  if (
    identity.plu !== null
    || identity.upc === null
    || (
      command.expected_current !== undefined
      && command.expected_current !== null
    )
    || typeof command.requested_changes !== 'object'
    || Array.isArray(command.requested_changes)
    || Object.keys(command.requested_changes).length
      !== requiredRequestedKeys.length
    || Object.keys(command.requested_changes).some(
      key => !requiredRequestedKeys.includes(key),
    )
    || requiredRequestedKeys.some(
      key => !Object.hasOwn(command.requested_changes, key),
    )
  ) {
    fail('validation_failed')
  }

  return normalizeCreateProductInput({
    upc: identity.upc,
    modifier: identity.modifier,
    description: command.requested_changes.description,
    price: command.requested_changes.retail_price,
    sellUnit: command.requested_changes.selling_unit,
    departmentSysId: command.requested_changes.department_number,
    maxQtyPerTrans:
      command.requested_changes.maximum_quantity_per_transaction,
    pcode: command.requested_changes.payment_product_code,
    idCheckSysIds: command.requested_changes.id_check_ids,
    taxRateSysIds: command.requested_changes.tax_rate_ids,
    flagSysIds: command.requested_changes.flag_ids,
    taxableRebateAmount: command.requested_changes.taxable_rebate,
  })
}

function readCommanderReferenceIds(container, childName) {
  if (
    !container
    || container.attrs.length !== 0
    || container.text.trim() !== ''
    || container.children.length > 16
  ) {
    fail('vplu_response_invalid')
  }

  const ids = container.children.map(item => {
    if (
      localName(item.name) !== childName
      || item.children.length !== 0
      || item.text.trim() !== ''
      || item.attrs.length !== 1
      || localName(item.attrs[0].name) !== 'sysid'
    ) {
      fail('vplu_response_invalid')
    }

    return normalizeCommanderSysid(
      item.attrs[0].value,
      'vplu_response_invalid',
    )
  })

  if (new Set(ids).size !== ids.length) {
    fail('vplu_response_invalid')
  }

  return Object.freeze(ids)
}

function validateCommanderTaxableRebateTaxRate(
  node,
  failureCode = 'vplu_response_invalid',
) {
  if (
    !node
    || localName(node.name) !== 'taxRate'
    || node.children.length !== 0
    || node.text.trim() !== ''
    || node.attrs.length > 1
  ) {
    fail(failureCode)
  }

  if (node.attrs.length === 1) {
    const attribute = node.attrs[0]

    if (localName(attribute.name) !== 'sysid') {
      fail(failureCode)
    }

    try {
      normalizeCommanderSysid(attribute.value)
    } catch {
      fail(failureCode)
    }
  }
}

function readCommanderTaxableRebate(container) {
  if (
    !container
    || container.attrs.length !== 0
    || container.text.trim() !== ''
    || container.children.length < 1
    || container.children.length > 2
  ) {
    fail('vplu_response_invalid')
  }

  const amountNodes = container.children.filter(
    item => localName(item.name) === 'amount',
  )

  const taxRateNodes = container.children.filter(
    item => localName(item.name) === 'taxRate',
  )

  if (
    amountNodes.length !== 1
    || taxRateNodes.length > 1
    || amountNodes.length + taxRateNodes.length
      !== container.children.length
  ) {
    fail('vplu_response_invalid')
  }

  const amount = amountNodes[0]

  if (
    amount.attrs.length !== 0
    || amount.children.length !== 0
  ) {
    fail('vplu_response_invalid')
  }

  if (taxRateNodes.length === 1) {
    validateCommanderTaxableRebateTaxRate(
      taxRateNodes[0],
    )
  }

  const value =
    amount.text.trim()

  if (value.length === 0) {
    fail('vplu_response_invalid')
  }

  try {
    return normalizeMoney(value)
  } catch {
    fail('vplu_response_invalid')
  }
}

function sameProductStateValue(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => item === right[index])
    )
  }

  return left === right
}

function normalizeExtendedProductState(
  input,
  code = 'validation_failed',
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail(code)
  }

  const requiredKeys = [
    'description',
    'department_number',
    'retail_price',
  ]

  const optionalKeys = [
    'payment_product_code',
    'selling_unit',
    'maximum_quantity_per_transaction',
    'taxable_rebate',
    'tax_rate_ids',
    'id_check_ids',
  ]

  const allowed = new Set([
    ...requiredKeys,
    ...optionalKeys,
  ])

  const keys = Object.keys(input)

  if (
    keys.some(key => !allowed.has(key))
    || requiredKeys.some(key => !Object.hasOwn(input, key))
  ) {
    fail(code)
  }

  const result = {
    description: text(input.description, 512, code),
    department_number: normalizeDepartmentNumber(
      input.department_number,
    ),
    retail_price: normalizeMoney(input.retail_price),
  }

  if (Object.hasOwn(input, 'payment_product_code')) {
    result.payment_product_code = normalizeCommanderSysid(
      input.payment_product_code,
      code,
    )
  }

  if (Object.hasOwn(input, 'selling_unit')) {
    result.selling_unit = normalizeFixedDecimal(
      input.selling_unit,
      3,
      6,
      code,
    )
  }

  if (Object.hasOwn(input, 'maximum_quantity_per_transaction')) {
    result.maximum_quantity_per_transaction =
      normalizeFixedDecimal(
        input.maximum_quantity_per_transaction,
        2,
        6,
        code,
      )
  }

  if (Object.hasOwn(input, 'taxable_rebate')) {
    result.taxable_rebate = normalizeMoney(
      input.taxable_rebate,
    )
  }

  if (Object.hasOwn(input, 'tax_rate_ids')) {
    result.tax_rate_ids = normalizeCommanderSysidList(
      input.tax_rate_ids,
      code,
    )
  }

  if (Object.hasOwn(input, 'id_check_ids')) {
    result.id_check_ids = normalizeCommanderSysidList(
      input.id_check_ids,
      code,
    )
  }

  return Object.freeze(result)
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
    for (const optional of OPTIONAL_REFERENCE_FIELDS) child(node, optional, false)
    const upc = value(child(node, 'upc', true))
    const modifier = value(child(node, 'upcModifier', true))
    const description = value(child(node, 'description', true))
    const price = value(child(node, 'price', true))
    const department = value(child(node, 'department', true))
    const paymentProductCode = value(child(node, 'pcode', true))
    const sellingUnit = value(child(node, 'SellUnit', true))
    const maximumQuantity = value(
      child(node, 'maxQtyPerTrans', true),
    )

    if (
      !upc
      || !modifier
      || !description
      || !price
      || !department
      || paymentProductCode === null
      || sellingUnit === null
      || maximumQuantity === null
    ) {
      fail('vplu_response_invalid')
    }

    let retailPrice
    let normalizedSellingUnit
    let normalizedMaximumQuantity

    try {
      retailPrice = normalizeMoney(price)

      normalizedSellingUnit = normalizeFixedDecimal(
        sellingUnit,
        3,
        6,
        'vplu_response_invalid',
      )

      normalizedMaximumQuantity = normalizeFixedDecimal(
        maximumQuantity,
        2,
        6,
        'vplu_response_invalid',
      )
    } catch {
      fail('vplu_response_invalid')
    }

    const parsed = {
      ...normalizeProductIdentity({
        plu: value(child(node, 'plu', false)),
        modifier,
        upc,
      }),

      description: text(
        description,
        512,
        'vplu_response_invalid',
      ),

      retail_price: retailPrice,
      cost: null,

      department_number: normalizeCommanderSysid(
        department,
        'vplu_response_invalid',
      ),

      department_name: null,
      category_number: null,
      category_name: null,

      payment_product_code: normalizeCommanderSysid(
        paymentProductCode,
        'vplu_response_invalid',
      ),

      selling_unit: normalizedSellingUnit,

      maximum_quantity_per_transaction:
        normalizedMaximumQuantity,

      taxable_rebate: readCommanderTaxableRebate(
        child(node, 'taxableRebate', true),
      ),

      flag_ids: child(node, 'flags', false) === null
        ? Object.freeze([])
        : readCommanderReferenceIds(
            child(node, 'flags', false),
            'flag',
          ),

      tax_rate_ids: child(node, 'taxRates', false) === null
        ? Object.freeze([])
        : readCommanderReferenceIds(
            child(node, 'taxRates', false),
            'taxRate',
          ),

      id_check_ids: child(node, 'idChecks', false) === null
        ? Object.freeze([])
        : readCommanderReferenceIds(
            child(node, 'idChecks', false),
            'idCheck',
          ),

      tax_number: null,
      tax_name: null,
      age_restriction: null,
      active: null,

      raw_payload_hash: createHash('sha256')
        .update(serialize(node), 'utf8')
        .digest('hex'),

      // Internal only. Never exposed as raw Commander XML.
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

/** Reads one UPC/modifier selection through the proven fixed vPLUs transport. */
export async function readCommanderProduct({ origin, sessionCookie, certificatePath, trust, upc, modifier = '000', transport }) {
  try {
    const response = await sendCommanderVpluReadRequest({
      origin,
      trust,
      transport,
      sessionCookie,
      xml: buildCommanderVpluSelectXml({ upc, modifier }),
    })
    if (response.status === 401 || response.status === 403) return { status: 'session_failed' }
    if (response.status < 200 || response.status >= 300) return { status: 'commander_http_status_failed' }
    let products
    try {
      products = parseVpluResponse(response.body)
    } catch {
      return { status: 'commander_response_invalid' }
    }
    const selected = products.filter(product => product.upc === normalizeUpc(upc) && product.modifier === normalizeModifier(modifier))
    return selected.length === 1 ? { status: 'success', product: selected[0] } : { status: 'product_not_found' }
  } catch (error) {
    if (error?.code === 'commander_tls_hostname_invalid' || error?.code === 'commander_tls_peer_mismatch') return { status: error.code }
    if (error?.code === 'commander_connect_failed' || error?.code === 'commander_connection_reset') return { status: error.code }
    if (error?.code === 'timeout') return { status: 'commander_request_timeout' }
    if (error?.code === 'response_too_large' || error?.code === 'response_invalid' || error?.code === 'vplu_response_invalid' || error?.code === 'duplicate_product_identity') return { status: 'commander_response_invalid' }
    return { status: 'readback_failed' }
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

  if (command.approval !== undefined && command.approval !== null) {
    if (typeof command.approval !== 'object' || Array.isArray(command.approval) || Object.keys(command.approval).some(key => key !== 'approval_id' && key !== 'approved_at') || !/^[A-Za-z0-9._:-]{1,128}$/.test(command.approval.approval_id || '') || !/^\d{4}-\d{2}-\d{2}T/.test(command.approval.approved_at || '')) fail('validation_failed')
  }

  if (command.command_type === 'update_price') {
    if (!command.expected_current || typeof command.expected_current !== 'object' || Array.isArray(command.expected_current) || Object.keys(command.expected_current).length !== 1 || !Object.hasOwn(command.expected_current, 'retail_price')) fail('validation_failed')
    if (typeof command.requested_changes !== 'object' || Array.isArray(command.requested_changes) || Object.keys(command.requested_changes).length !== 1 || !Object.hasOwn(command.requested_changes, 'retail_price')) fail('validation_failed')
    return Object.freeze({
      ...command,
      identity,
      expected_current: { retail_price: normalizeMoney(command.expected_current.retail_price) },
      requested_changes: { retail_price: normalizeMoney(command.requested_changes.retail_price) },
    })
  }

  if (command.command_type === 'create_product') {
    const createInput = createProductInputFromCommand(
      command,
      identity,
    )

    return Object.freeze({
      ...command,
      identity,
      expected_current: null,
      requested_changes: Object.freeze({
        description: createInput.description,
        retail_price: createInput.price,
        department_number: createInput.departmentSysId,
        payment_product_code: createInput.pcode,
        selling_unit: createInput.sellUnit,
        maximum_quantity_per_transaction: createInput.maxQtyPerTrans,
        taxable_rebate: createInput.taxableRebateAmount,
        tax_rate_ids: createInput.taxRateSysIds,
        id_check_ids: createInput.idCheckSysIds,
        flag_ids: createInput.flagSysIds,
      }),
    })
  }

  if (command.command_type === 'update_product') {
    if (
      !command.expected_current
      || typeof command.expected_current !== 'object'
      || Array.isArray(command.expected_current)
      || typeof command.requested_changes !== 'object'
      || Array.isArray(command.requested_changes)
    ) {
      fail('validation_failed')
    }

    const expectedKeys =
      Object.keys(command.expected_current).sort()

    const requestedKeys =
      Object.keys(command.requested_changes).sort()

    if (
      expectedKeys.length !== requestedKeys.length
      || expectedKeys.some(
        (key, index) => key !== requestedKeys[index],
      )
    ) {
      fail('validation_failed')
    }

    const expectedCurrent =
      normalizeExtendedProductState(
        command.expected_current,
      )

    const requestedChanges =
      normalizeExtendedProductState(
        command.requested_changes,
      )

    if (
      Object.keys(expectedCurrent).length
        !== expectedKeys.length
      || Object.keys(requestedChanges).length
        !== requestedKeys.length
    ) {
      fail('validation_failed')
    }

    if (
      expectedKeys.every(
        key => sameProductStateValue(
          expectedCurrent[key],
          requestedChanges[key],
        ),
      )
    ) {
      fail('validation_failed')
    }

    return Object.freeze({
      ...command,
      identity,
      expected_current: expectedCurrent,
      requested_changes: requestedChanges,
    })
  }

  if (typeof command.requested_changes !== 'object' || Array.isArray(command.requested_changes) || Object.keys(command.requested_changes).some(key => !['description', 'retail_price', 'cost', 'active'].includes(key))) fail('validation_failed')
  if (command.expected_current !== undefined && command.expected_current !== null) {
    if (typeof command.expected_current !== 'object' || Array.isArray(command.expected_current) || Object.keys(command.expected_current).some(key => key !== 'retail_price')) fail('validation_failed')
    if (Object.hasOwn(command.expected_current, 'retail_price')) normalizeMoney(command.expected_current.retail_price)
  }
  if (Object.hasOwn(command.requested_changes, 'description')) text(command.requested_changes.description, 512)
  if (Object.hasOwn(command.requested_changes, 'retail_price')) normalizeMoney(command.requested_changes.retail_price)
  if (Object.hasOwn(command.requested_changes, 'cost')) normalizeMoney(command.requested_changes.cost)
  if (Object.hasOwn(command.requested_changes, 'active') && typeof command.requested_changes.active !== 'boolean') fail('validation_failed')
  return Object.freeze({ ...command, identity })
}

function renderCommanderScalar(field, value) {
  if (field.children.length !== 0) {
    fail('product_field_not_supported')
  }

  const attrs = field.attrs
    .map(a => ` ${a.name}="${esc(a.value)}"`)
    .join('')

  return `<${field.name}${attrs}>${esc(value)}</${field.name}>`
}

function renderCommanderSysidList(
  field,
  itemName,
  ids,
) {
  if (
    field.attrs.length !== 0
    || field.text.trim() !== ''
  ) {
    fail('product_field_not_supported')
  }

  for (const item of field.children) {
    if (
      localName(item.name) !== itemName
      || item.children.length !== 0
      || item.text.trim() !== ''
      || item.attrs.length !== 1
      || localName(item.attrs[0].name) !== 'sysid'
    ) {
      fail('product_field_not_supported')
    }
  }

  const normalized = normalizeCommanderSysidList(ids)

  const qualifiedItemName =
    field.children[0]?.name ?? `domain:${itemName}`

  const children = normalized
    .map(
      id =>
        `<${qualifiedItemName} sysid="${esc(id)}"></${qualifiedItemName}>`,
    )
    .join('')

  return `<${field.name}>${children}</${field.name}>`
}

function renderCommanderTaxableRebate(
  field,
  amount,
) {
  if (
    field.attrs.length !== 0
    || field.text.trim() !== ''
    || field.children.length < 1
    || field.children.length > 2
  ) {
    fail('product_field_not_supported')
  }

  const amountNodes = field.children.filter(
    item => localName(item.name) === 'amount',
  )

  const taxRateNodes = field.children.filter(
    item => localName(item.name) === 'taxRate',
  )

  if (
    amountNodes.length !== 1
    || taxRateNodes.length > 1
    || amountNodes.length + taxRateNodes.length
      !== field.children.length
  ) {
    fail('product_field_not_supported')
  }

  const amountNode = amountNodes[0]

  if (
    amountNode.attrs.length !== 0
    || amountNode.children.length !== 0
  ) {
    fail('product_field_not_supported')
  }

  if (taxRateNodes.length === 1) {
    validateCommanderTaxableRebateTaxRate(
      taxRateNodes[0],
      'product_field_not_supported',
    )
  }

  const normalizedAmount =
    normalizeMoney(amount)

  const children = field.children
    .map(item => (
      localName(item.name) === 'amount'
        ? `<${item.name}>${esc(normalizedAmount)}</${item.name}>`
        : serialize(item)
    ))
    .join('')

  return `<${field.name}>${children}</${field.name}>`
}

function buildTemplatePreservingProductXml(
  product,
  replacements,
) {
  if (
    !product?._write_template
    || product._write_template.name !== 'domain:PLU'
  ) {
    fail('product_field_not_supported')
  }

  const template = product._write_template

  for (const required of REQUIRED_WRITE_FIELDS) {
    if (
      template.children.filter(
        field => localName(field.name) === required,
      ).length !== 1
    ) {
      fail('product_field_not_supported')
    }
  }

  for (const optional of OPTIONAL_REFERENCE_FIELDS) {
    if (
      template.children.filter(
        field => localName(field.name) === optional,
      ).length > 1
    ) {
      fail('product_field_not_supported')
    }
  }

  const replaceNames = new Set(Object.keys(replacements))
  if ([...replaceNames].some(name => !MUTABLE_WRITE_FIELDS.has(name))) {
    fail('product_field_not_supported')
  }

  for (const name of replaceNames) {
    const count = template.children.filter(
      field => localName(field.name) === name,
    ).length
    const canCreate = name === 'taxRates' || name === 'idChecks'
    if ((canCreate && count > 1) || (!canCreate && count !== 1)) {
      fail('product_field_not_supported')
    }
  }

  const missingReferenceFields = []
  for (const name of ['taxRates', 'idChecks']) {
    if (
      replaceNames.has(name)
      && !template.children.some(field => localName(field.name) === name)
    ) {
      const synthetic = {
        name,
        attrs: [],
        text: '',
        children: [],
      }
      missingReferenceFields.push(
        renderCommanderSysidList(
          synthetic,
          name === 'taxRates' ? 'taxRate' : 'idCheck',
          replacements[name],
        ),
      )
    }
  }

  let insertedMissingReferences = false
  const fields = template.children
    .map(field => {
      const name = localName(field.name)
      let prefix = ''
      if (
        !insertedMissingReferences
        && missingReferenceFields.length > 0
        && name === 'SellUnit'
      ) {
        prefix = missingReferenceFields.join('')
        insertedMissingReferences = true
      }

      if (!replaceNames.has(name)) {
        return prefix + serialize(field)
      }

      const replacement = replacements[name]

      if (name === 'taxRates') {
        return prefix + renderCommanderSysidList(
          field,
          'taxRate',
          replacement,
        )
      }

      if (name === 'idChecks') {
        return prefix + renderCommanderSysidList(
          field,
          'idCheck',
          replacement,
        )
      }

      if (name === 'taxableRebate') {
        return prefix + renderCommanderTaxableRebate(
          field,
          replacement,
        )
      }

      return prefix + renderCommanderScalar(
        field,
        replacement,
      )
    })
    .join('')

  if (missingReferenceFields.length > 0 && !insertedMissingReferences) {
    fail('product_field_not_supported')
  }

  return (
    `<domain:PLUs `
    + `xmlns:domain="${COMMANDER_PRODUCT_NAMESPACE}" `
    + `xmlns:vs="urn:vfi-sapphire:vs.2001-10-01" `
    + `page="1" ofPages="1">`
    + `<domain:PLU>${fields}</domain:PLU>`
    + `</domain:PLUs>`
  )
}

export function buildUpdatePriceXml(
  product,
  requestedPrice,
) {
  return buildTemplatePreservingProductXml(
    product,
    {
      price: normalizeMoney(requestedPrice),
    },
  )
}

export function buildUpdateProductXml(
  product,
  requestedChanges,
) {
  const replacements = {
    description: text(
      requestedChanges.description,
      512,
    ),

    department: normalizeDepartmentNumber(
      requestedChanges.department_number,
    ),

    price: normalizeMoney(
      requestedChanges.retail_price,
    ),
  }

  if (
    Object.hasOwn(
      requestedChanges,
      'payment_product_code',
    )
  ) {
    replacements.pcode = normalizeCommanderSysid(
      requestedChanges.payment_product_code,
    )
  }

  if (
    Object.hasOwn(
      requestedChanges,
      'selling_unit',
    )
  ) {
    replacements.SellUnit = normalizeFixedDecimal(
      requestedChanges.selling_unit,
      3,
    )
  }

  if (
    Object.hasOwn(
      requestedChanges,
      'maximum_quantity_per_transaction',
    )
  ) {
    replacements.maxQtyPerTrans =
      normalizeFixedDecimal(
        requestedChanges.maximum_quantity_per_transaction,
        2,
      )
  }

  if (
    Object.hasOwn(
      requestedChanges,
      'taxable_rebate',
    )
  ) {
    replacements.taxableRebate = normalizeMoney(
      requestedChanges.taxable_rebate,
    )
  }

  if (
    Object.hasOwn(
      requestedChanges,
      'tax_rate_ids',
    )
  ) {
    replacements.taxRates =
      normalizeCommanderSysidList(
        requestedChanges.tax_rate_ids,
      )
  }

  if (
    Object.hasOwn(
      requestedChanges,
      'id_check_ids',
    )
  ) {
    replacements.idChecks =
      normalizeCommanderSysidList(
        requestedChanges.id_check_ids,
      )
  }

  // Commander flag sysids remain untouched until
  // their exact meanings are proven.
  return buildTemplatePreservingProductXml(
    product,
    replacements,
  )
}

export function buildCreateProductXml(input) {
  const product = normalizeCreateProductInput(input)
  const referenceXml = (container, childName, sysids) => (
    `<${container}>${sysids.map(
      sysid => `<domain:${childName} sysid="${esc(sysid)}"/>`,
    ).join('')}</${container}>`
  )

  return (
    `<domain:PLUs `
    + `xmlns:domain="${COMMANDER_PRODUCT_NAMESPACE}" `
    + `xmlns:vs="urn:vfi-sapphire:vs.2001-10-01" `
    + `page="1" ofPages="1">`
    + `<domain:PLU>`
    + `<upc>${esc(product.upc)}</upc>`
    + `<upcModifier>${esc(product.modifier)}</upcModifier>`
    + `<description>${esc(product.description)}</description>`
    + `<price>${product.price}</price>`
    + `<SellUnit>${product.sellUnit}</SellUnit>`
    + `<department>${product.departmentSysId}</department>`
    + `<maxQtyPerTrans>${product.maxQtyPerTrans}</maxQtyPerTrans>`
    + `<pcode>${product.pcode}</pcode>`
    + referenceXml('idChecks', 'idCheck', product.idCheckSysIds)
    + referenceXml('taxRates', 'taxRate', product.taxRateSysIds)
    + referenceXml('flags', 'flag', product.flagSysIds)
    + `<taxableRebate><amount>${product.taxableRebateAmount}</amount></taxableRebate>`
    + `</domain:PLU>`
    + `</domain:PLUs>`
  )
}

export function buildProductWriteXml(command, product) {
  const validated = validateProductCommand(command)
  if (validated.command_type === 'update_price') return { supported: true, command: 'uPLUs', xml: buildUpdatePriceXml(product, validated.requested_changes.retail_price) }
  if (validated.command_type === 'update_product') return { supported: true, command: 'uPLUs', xml: buildUpdateProductXml(product, validated.requested_changes) }
  if (validated.command_type === 'create_product') return { supported: true, command: 'uPLUs', xml: buildCreateProductXml(createProductInputFromCommand(validated, validated.identity)) }
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

function equivalentCurrent(expected, current) {
  return (
    !expected
    || Object.entries(expected).every(
      ([key, expectedValue]) =>
        sameProductStateValue(
          current[key],
          expectedValue,
        ),
    )
  )
}

function finalMatches(command, product) {
  if (command.command_type === 'update_price') {
    return (
      product.retail_price
      === command.requested_changes.retail_price
    )
  }

  if (command.command_type === 'update_product') {
    return Object.entries(
      command.requested_changes,
    ).every(
      ([key, requestedValue]) =>
        sameProductStateValue(
          product[key],
          requestedValue,
        ),
    )
  }

  if (command.command_type === 'create_product') {
    const requested = command.requested_changes

    return (
      product.upc === command.identity.upc
      && product.modifier === command.identity.modifier
      && product.description === requested.description
      && product.retail_price === requested.retail_price
      && product.department_number === requested.department_number
      && product.payment_product_code === requested.payment_product_code
      && product.selling_unit === requested.selling_unit
      && product.maximum_quantity_per_transaction
        === requested.maximum_quantity_per_transaction
      && product.taxable_rebate === requested.taxable_rebate
      && sameCommanderSysidSets(
        product.tax_rate_ids,
        requested.tax_rate_ids,
      )
      && sameCommanderSysidSets(
        product.id_check_ids,
        requested.id_check_ids,
      )
      && sameCommanderSysidSets(
        product.flag_ids,
        requested.flag_ids,
      )
    )
  }

  return false
}

function sameCommanderSysidSets(left, right) {
  return (
    Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every(item => right.includes(item))
  )
}

const CREATE_READBACK_MAX_ATTEMPTS = 3
const CREATE_READBACK_RETRY_DELAY_MS = 250

function defaultCreateReadbackSleep(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs))
}

export function createIdempotencyStore() {
  const entries = new Map()
  return {
    get(command) { const entry = entries.get(command.idempotency_key); if (!entry) return null; return entry.fingerprint === JSON.stringify(command) ? entry.result : 'idempotency_key_conflict' },
    put(command, result) { entries.set(command.idempotency_key, { fingerprint: JSON.stringify(command), result }); },
  }
}
/** Offline-injectable workflow. It never creates a session or network transport itself. */
export async function executeProductCommand({ command, sessionProvider, readProduct, writeProduct, waitForCreateReadback = defaultCreateReadbackSleep, idempotencyStore = createIdempotencyStore() }) {
  let validated
  try { validated = validateProductCommand(command) } catch { return { status: 'validation_failed' } }
  const prior = idempotencyStore.get(validated); if (prior) return prior === 'idempotency_key_conflict' ? { status: 'validation_failed', error_code: prior } : prior
  if (!SUPPORTED_PRODUCT_COMMANDS.has(validated.command_type)) return { status: 'unsupported_operation', error_code: buildProductWriteXml(validated, null).error_code }
  let session = null
  try {
    session = await sessionProvider()
    if (!session) return { status: 'session_failed' }
    const current = await readProduct({ identity: validated.identity, session })
    if (validated.command_type === 'create_product') {
      if (current) return { status: 'product_already_exists' }
      const write = buildProductWriteXml(validated, null)
      try {
        const outcome = await writeProduct({ session, command: write.command, xml: write.xml })
        if (!outcome || outcome.ok !== true) return { status: 'write_failed' }
      } catch { return { status: 'write_outcome_unknown' } }
      let readback
      let lastReadError
      for (let attempt = 0; attempt < CREATE_READBACK_MAX_ATTEMPTS; attempt += 1) {
        try {
          readback = await readProduct({ identity: validated.identity, session })
          if (readback && finalMatches(validated, readback)) {
            const result = { status: 'success', idempotent: false }
            idempotencyStore.put(validated, result)
            return result
          }
        } catch (error) {
          lastReadError = error
        }
        if (attempt + 1 < CREATE_READBACK_MAX_ATTEMPTS) {
          await waitForCreateReadback(CREATE_READBACK_RETRY_DELAY_MS)
        }
      }
      if (lastReadError) throw lastReadError
      return { status: 'create_verification_failed' }
    }
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
  if (command?.command_type === 'create_product') {
    try {
      validateProductCommand(command)
      return {
        valid: true,
        executable: true,
        error_code: null,
      }
    } catch {
      return {
        valid: false,
        executable: false,
        error_code: 'validation_failed',
      }
    }
  }

  return command && ['update_product', 'deactivate_product', 'reactivate_product'].includes(command.command_type) ? { valid: true, executable: false, error_code: 'product_queue_execution_disabled' } : { valid: false, executable: false, error_code: 'validation_failed' }
}

export { COMMANDER_NAXML_COMMANDS, CommanderNaxmlError, sendCommanderNaxml }
