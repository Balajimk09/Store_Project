import { createHash } from 'node:crypto'
import { Agent, request as httpsRequest } from 'node:https'
import { checkServerIdentity } from 'node:tls'
import { TextDecoder } from 'node:util'

export const COMMANDER_VPLU_PATH = '/cgi-bin/NAXML?'
export const COMMANDER_VPLU_TIMEOUT_MS = 15_000
export const COMMANDER_VPLU_MAX_RESPONSE_BYTES = 1024 * 1024
export const COMMANDER_PRODUCT_NAMESPACE =
  'urn:vfi-sapphire:np.domain.2001-07-01'

const REQUIRED_FIELDS = Object.freeze([
  'upc',
  'upcModifier',
  'description',
  'price',
])

const EXTENDED_REQUIRED_FIELDS = Object.freeze([
  'pcode',
  'SellUnit',
  'maxQtyPerTrans',
  'taxableRebate',
])

const EXTENDED_OPTIONAL_CONTAINER_FIELDS = Object.freeze([
  'flags',
  'taxRates',
  'idChecks',
])

const MAX_REFERENCE_IDS = 16

export class CommanderVpluReadError extends Error {
  constructor(code) {
    super(code)
    this.name = 'CommanderVpluReadError'
    this.code = code
  }
}

function fail(code) {
  throw new CommanderVpluReadError(code)
}

function text(value, maximum, code = 'vplu_response_invalid') {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) fail(code)
  return value.normalize('NFC')
}

function descriptionText(value) {
  if (
    typeof value !== 'string'
    || value.length > 512
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) fail('vplu_response_invalid')
  return value.normalize('NFC')
}

function normalizeUpc(value) {
  const normalized = text(value, 32, 'request_invalid')
  if (!/^\d+$/.test(normalized)) fail('request_invalid')
  return normalized
}

function normalizeModifier(value = '000') {
  const normalized = text(value, 32, 'request_invalid')
  if (!/^\d+$/.test(normalized)) fail('request_invalid')
  return normalized
}

function normalizeMoney(value) {
  if (
    typeof value !== 'string'
    || !/^\d+(?:\.\d{1,2})?$/.test(value)
  ) fail('vplu_response_invalid')

  const amount = Number(value)
  if (
    !Number.isFinite(amount)
    || amount < 0
    || amount > 999999.99
  ) fail('vplu_response_invalid')

  return amount.toFixed(2)
}

function normalizeCommanderSysid(value) {
  if (typeof value !== 'string' || !/^\d{1,16}$/u.test(value)) {
    fail('vplu_response_invalid')
  }
  return value
}

function normalizeFixedDecimal(value, fractionDigits) {
  if (typeof value !== 'string') fail('vplu_response_invalid')
  const pattern = new RegExp(
    `^(?:0|[1-9]\\d{0,5})(?:\\.\\d{1,${fractionDigits}})?$`,
  )
  if (!pattern.test(value)) fail('vplu_response_invalid')
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) fail('vplu_response_invalid')
  return number.toFixed(fractionDigits)
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function decodeXml(value) {
  if (
    /&(?!#(?:x[0-9a-fA-F]+|\d+);|(?:amp|lt|gt|quot|apos);)/.test(
      value,
    )
  ) fail('vplu_response_invalid')

  return value.replace(
    /&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g,
    (_, entity) => {
      const named = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
      }

      if (Object.hasOwn(named, entity)) return named[entity]

      const codePoint = entity.startsWith('#x')
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)

      if (
        !Number.isInteger(codePoint)
        || codePoint < 0
        || codePoint > 0x10ffff
      ) fail('vplu_response_invalid')

      return String.fromCodePoint(codePoint)
    },
  )
}

function localName(name) {
  return name.split(':').at(-1)
}

function parseXml(xml) {
  if (
    typeof xml !== 'string'
    || Buffer.byteLength(xml, 'utf8')
      > COMMANDER_VPLU_MAX_RESPONSE_BYTES
    || /<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)
  ) fail('vplu_response_invalid')

  const stack = []
  let root = null
  let cursor = 0
  let nodeCount = 0

  while (cursor < xml.length) {
    if (xml.startsWith('<?xml', cursor)) {
      const end = xml.indexOf('?>', cursor)
      if (end < 0) fail('vplu_response_invalid')
      cursor = end + 2
      continue
    }

    const whitespace = xml.slice(cursor).match(/^\s+/)
    if (whitespace) {
      cursor += whitespace[0].length
      continue
    }

    if (xml.startsWith('</', cursor)) {
      const match =
        xml.slice(cursor).match(/^<\/([A-Za-z_][\w.:-]*)\s*>/)
      if (
        !match
        || stack.length === 0
        || stack.at(-1).name !== match[1]
      ) fail('vplu_response_invalid')

      stack.pop()
      cursor += match[0].length
      continue
    }

    if (
      xml[cursor] !== '<'
      || xml.startsWith('<!--', cursor)
    ) fail('vplu_response_invalid')

    const end = xml.indexOf('>', cursor + 1)
    if (end < 0) fail('vplu_response_invalid')

    const raw = xml.slice(cursor + 1, end)
    const selfClosing = /\/\s*$/.test(raw)
    const match =
      raw.match(/^\s*([A-Za-z_][\w.:-]*)([\s\S]*?)\/?\s*$/)
    if (!match) fail('vplu_response_invalid')

    const attributes = []
    const input = match[2].replace(/\/\s*$/, '')
    let attributeCursor = 0

    while (attributeCursor < input.length) {
      const spacing = input.slice(attributeCursor).match(/^\s+/)
      if (spacing) {
        attributeCursor += spacing[0].length
        continue
      }

      const attribute = input.slice(attributeCursor).match(
        /^([A-Za-z_][\w.:-]*)\s*=\s*(["'])([\s\S]*?)\2/,
      )

      if (!attribute) fail('vplu_response_invalid')
      if (
        attributes.some((entry) => entry.name === attribute[1])
      ) fail('vplu_response_invalid')

      attributes.push({
        name: attribute[1],
        value: decodeXml(attribute[3]),
      })
      attributeCursor += attribute[0].length
    }

    nodeCount += 1
    if (nodeCount > 10_000 || stack.length > 64) {
      fail('vplu_response_invalid')
    }

    const node = {
      name: match[1],
      attrs: attributes,
      children: [],
      text: '',
    }

    if (stack.length) {
      stack.at(-1).children.push(node)
    } else if (root) {
      fail('vplu_response_invalid')
    } else {
      root = node
    }

    if (!selfClosing) stack.push(node)
    cursor = end + 1

    const next = xml.indexOf('<', cursor)
    if (!selfClosing && next > cursor) {
      node.text += decodeXml(xml.slice(cursor, next))
      cursor = next
    }
  }

  if (!root || stack.length) fail('vplu_response_invalid')
  return root
}

function child(node, name, required = false) {
  const matches = node.children.filter(
    (entry) => localName(entry.name) === name,
  )

  if (
    matches.length > 1
    || (required && matches.length !== 1)
  ) fail('vplu_response_invalid')

  return matches[0] || null
}

function nodeValue(node) {
  if (!node || node.children.length) return null
  const value = node.text.trim()
  return value.length ? value : null
}

function descriptionValue(node) {
  if (!node || node.children.length) return null
  return node.text.trim()
}

function readCommanderReferenceIds(container, childName) {
  if (
    !container
    || container.attrs.length !== 0
    || container.text.trim() !== ''
    || container.children.length > MAX_REFERENCE_IDS
  ) fail('vplu_response_invalid')

  const ids = container.children.map((item) => {
    if (
      localName(item.name) !== childName
      || item.children.length !== 0
      || item.text.trim() !== ''
      || item.attrs.length !== 1
      || localName(item.attrs[0].name) !== 'sysid'
    ) fail('vplu_response_invalid')
    return normalizeCommanderSysid(item.attrs[0].value)
  })

  if (new Set(ids).size !== ids.length) fail('vplu_response_invalid')
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

function readExtendedCommanderProductState(node) {
  const required = Object.fromEntries(
    EXTENDED_REQUIRED_FIELDS.map((field) => [field, child(node, field, false)]),
  )
  const optional = Object.fromEntries(
    EXTENDED_OPTIONAL_CONTAINER_FIELDS.map((field) => [field, child(node, field, false)]),
  )
  const requiredPresent = Object.values(required).filter(Boolean).length
  const optionalPresent = Object.values(optional).filter(Boolean).length

  // Preserve the explicit legacy V1 contract only when no V2 field is present.
  if (requiredPresent === 0 && optionalPresent === 0) return null

  // A V2 product must contain the four proven scalar/core fields. The three
  // reference containers are conditional in real Commander responses.
  if (requiredPresent !== EXTENDED_REQUIRED_FIELDS.length) {
    fail('vplu_response_invalid')
  }

  const paymentProductCode = nodeValue(required.pcode)
  const sellingUnit = nodeValue(required.SellUnit)
  const maximumQuantity = nodeValue(required.maxQtyPerTrans)
  if (
    paymentProductCode === null
    || sellingUnit === null
    || maximumQuantity === null
  ) fail('vplu_response_invalid')

  return Object.freeze({
    payment_product_code: normalizeCommanderSysid(paymentProductCode),
    selling_unit: normalizeFixedDecimal(sellingUnit, 3),
    maximum_quantity_per_transaction: normalizeFixedDecimal(maximumQuantity, 2),
    taxable_rebate: readCommanderTaxableRebate(required.taxableRebate),
    flag_ids: optional.flags === null
      ? Object.freeze([])
      : readCommanderReferenceIds(optional.flags, 'flag'),
    tax_rate_ids: optional.taxRates === null
      ? Object.freeze([])
      : readCommanderReferenceIds(optional.taxRates, 'taxRate'),
    id_check_ids: optional.idChecks === null
      ? Object.freeze([])
      : readCommanderReferenceIds(optional.idChecks, 'idCheck'),
  })
}

function serializeNode(node) {
  const attributes = node.attrs
    .map(
      (attribute) =>
        ` ${attribute.name}="${escapeXml(attribute.value)}"`,
    )
    .join('')

  return (
    `<${node.name}${attributes}>`
    + node.children.map(serializeNode).join('')
    + escapeXml(node.text)
    + `</${node.name}>`
  )
}

function validateOrigin(origin) {
  if (
    typeof origin !== 'string'
    || origin.includes('\\')
    || origin.includes('%')
  ) fail('transport_failed')

  let url
  try {
    url = new URL(origin)
  } catch {
    fail('transport_failed')
  }

  if (
    url.protocol !== 'https:'
    || !url.hostname
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '' && url.pathname !== '/')
  ) fail('transport_failed')

  return url
}

function validateCookie(cookie) {
  if (
    typeof cookie !== 'string'
    || cookie.length < 1
    || cookie.length > 4096
    || /[\u0000-\u001f\u007f-\u009f&=]/u.test(cookie)
  ) fail('transport_failed')

  return cookie
}

function createVerifiedAgent(trust) {
  if (
    !trust
    || (typeof trust.caBundle !== 'string' && !Buffer.isBuffer(trust.caBundle))
    || typeof trust.serverName !== 'string'
    || !/^[A-F0-9]{64}$/.test(trust.peerSha256 || '')
  ) fail('transport_failed')

  return new Agent({
    ca: trust.caBundle,
    allowPartialTrustChain: true,
    rejectUnauthorized: true,
    checkServerIdentity: (_host, certificate) => {
      const hostnameError = checkServerIdentity(
        trust.serverName,
        certificate,
      )
      if (hostnameError) return hostnameError

      if (!Buffer.isBuffer(certificate?.raw)) {
        return new Error('commander_tls_peer_mismatch')
      }

      const observed = createHash('sha256')
        .update(certificate.raw)
        .digest('hex')
        .toUpperCase()

      return observed === trust.peerSha256
        ? undefined
        : new Error('commander_tls_peer_mismatch')
    },
  })
}

function mapTransportError(error) {
  if (
    error?.message === 'commander_tls_peer_mismatch'
    || error?.code === 'commander_tls_peer_mismatch'
  ) return new CommanderVpluReadError(
    'commander_tls_peer_mismatch',
  )

  if (error?.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    return new CommanderVpluReadError(
      'commander_tls_hostname_invalid',
    )
  }

  if (error instanceof CommanderVpluReadError) return error

  if (
    error?.code === 'ECONNREFUSED'
    || error?.code === 'ENETUNREACH'
    || error?.code === 'EHOSTUNREACH'
    || error?.code === 'EADDRNOTAVAIL'
    || error?.code === 'ENOTFOUND'
    || error?.code === 'EAI_AGAIN'
  ) return new CommanderVpluReadError('commander_connect_failed')

  if (
    error?.code === 'ECONNRESET'
    || error?.code === 'EPIPE'
    || error?.message === 'socket hang up'
  ) return new CommanderVpluReadError('commander_connection_reset')

  return new CommanderVpluReadError('transport_failed')
}

export function buildCommanderVpluSelectXml({
  upc,
  modifier = '000',
}) {
  const normalizedUpc = normalizeUpc(upc)
  const normalizedModifier = normalizeModifier(modifier)

  return (
    `<domain:PLUSelect xmlns:domain="${COMMANDER_PRODUCT_NAMESPACE}">`
    + '<query><where>'
    + `<upc source="keyboard">${escapeXml(normalizedUpc)}</upc>`
    + `<upcModifier>${escapeXml(normalizedModifier)}</upcModifier>`
    + '</where></query><pageSize>100</pageSize><page>1</page>'
    + '</domain:PLUSelect>'
  )
}

export function buildCommanderVpluRequestBody({
  sessionCookie,
  upc,
  modifier = '000',
}) {
  const cookie = validateCookie(sessionCookie)
  const xml = buildCommanderVpluSelectXml({ upc, modifier })

  return `cmd=vPLUs&cookie=${encodeURIComponent(cookie)}\r\n\r\n${xml}`
}

function buildCommanderVpluReadBody({ sessionCookie, xml }) {
  const cookie = validateCookie(sessionCookie)

  if (
    typeof xml !== 'string'
    || xml.length < 1
    || Buffer.byteLength(xml, 'utf8') > COMMANDER_VPLU_MAX_RESPONSE_BYTES
  ) fail('request_invalid')

  return `cmd=vPLUs&cookie=${encodeURIComponent(cookie)}\r\n\r\n${xml}`
}

export function parseCommanderVpluResponse(
  xml,
  { includeWriteTemplate = false } = {},
) {
  if (typeof includeWriteTemplate !== 'boolean') {
    fail('vplu_response_invalid')
  }

  const root = parseXml(xml)

  if (
    root.name !== 'domain:PLUs'
    || root.attrs.find(
      (attribute) => attribute.name === 'xmlns:domain',
    )?.value !== COMMANDER_PRODUCT_NAMESPACE
  ) fail('vplu_response_invalid')

  const productNodes = root.children.filter(
    (node) => node.name === 'domain:PLU',
  )

  if (!productNodes.length) return []

  const products = productNodes.map((node) => {
    for (const required of REQUIRED_FIELDS) {
      child(node, required, true)
    }

    const upc = nodeValue(child(node, 'upc', true))
    const modifier = nodeValue(child(node, 'upcModifier', true))
    const description = descriptionValue(child(node, 'description', true))
    const price = nodeValue(child(node, 'price', true))

    if (!upc || !modifier || description === null || !price) {
      fail('vplu_response_invalid')
    }

    const departmentNumber =
      nodeValue(child(node, 'department', false))

    const product = {
      upc: normalizeUpc(upc),
      modifier: normalizeModifier(modifier),
      description: descriptionText(description),
      retail_price: normalizeMoney(price),
      cost: null,
      department_number: departmentNumber,
      department_name: null,
      category_number: null,
      category_name: null,
      tax_number: null,
      tax_name: null,
      age_restriction: null,
      active: null,
      raw_payload_hash: createHash('sha256')
        .update(serializeNode(node), 'utf8')
        .digest('hex'),
    }

    const extended = readExtendedCommanderProductState(node)
    if (extended) Object.assign(product, extended)

    if (includeWriteTemplate) {
      // Keep the validated node in memory only for the one controlled write.
      product._write_template = node
    }

    return Object.freeze(product)
  })

  const seen = new Set()
  for (const product of products) {
    const key = `upc:${product.upc}|modifier:${product.modifier}`
    if (seen.has(key)) fail('duplicate_product_identity')
    seen.add(key)
  }

  return products
}

export async function defaultCommanderVpluTransport({
  url,
  options,
  body,
  timeoutMs,
  requestFactory = httpsRequest,
}) {
  return new Promise((resolve, reject) => {
    let settled = false

    const settle = (callback, value) => {
      if (settled) return
      settled = true
      callback(value)
    }

    const request = requestFactory(
      url,
      options,
      (response) => {
        const chunks = []
        let bytes = 0

        response.on('data', (chunk) => {
          bytes += chunk.length
          if (bytes > COMMANDER_VPLU_MAX_RESPONSE_BYTES) {
            request.destroy()
            settle(
              reject,
              new CommanderVpluReadError('response_too_large'),
            )
            return
          }
          chunks.push(Buffer.from(chunk))
        })

        response.on('end', () => {
          if (settled) return

          let responseText
          try {
            responseText = new TextDecoder(
              'utf-8',
              { fatal: true },
            ).decode(Buffer.concat(chunks))
          } catch {
            settle(
              reject,
              new CommanderVpluReadError('response_invalid'),
            )
            return
          }

          settle(resolve, {
            status: response.statusCode || 0,
            body: responseText,
          })
        })

        response.on(
          'error',
          (error) => settle(reject, mapTransportError(error)),
        )
      },
    )

    request.setTimeout(timeoutMs, () => {
      request.destroy()
      settle(
        reject,
        new CommanderVpluReadError('timeout'),
      )
    })

    request.on(
      'error',
      (error) => settle(reject, mapTransportError(error)),
    )
    request.write(body)
    request.end()
  })
}

/**
 * Sends one fixed read-only vPLUs request. The caller can choose only XML for
 * the already fixed read command; it cannot select another Commander command.
 */
export async function sendCommanderVpluReadRequest({
  origin,
  sessionCookie,
  trust,
  xml,
  timeoutMs = COMMANDER_VPLU_TIMEOUT_MS,
  transport,
  requestFactory,
}) {
  let agent

  try {
    if (
      !Number.isInteger(timeoutMs)
      || timeoutMs < 1
      || timeoutMs > 60_000
    ) fail('request_invalid')

    const url = validateOrigin(origin)
    const body = buildCommanderVpluReadBody({
      sessionCookie,
      xml,
    })

    const endpoint = `${url.origin}${COMMANDER_VPLU_PATH}`
    const options = {
      method: 'POST',
      headers: {
        'content-type': 'text/plain; charset=UTF-8',
        'content-length': Buffer.byteLength(body),
      },
      rejectUnauthorized: true,
      servername: trust?.serverName,
    }

    let response
    if (transport) {
      response = await transport({
        url: endpoint,
        options,
        body,
        timeoutMs,
      })
    } else {
      agent = createVerifiedAgent(trust)
      response = await defaultCommanderVpluTransport({
        url: endpoint,
        options: { ...options, agent },
        body,
        timeoutMs,
        requestFactory,
      })
    }

    if (
      !response
      || !Number.isInteger(response.status)
      || typeof response.body !== 'string'
      || Buffer.byteLength(response.body, 'utf8')
        > COMMANDER_VPLU_MAX_RESPONSE_BYTES
    ) fail('transport_failed')

    return response
  } catch (error) {
    if (error instanceof CommanderVpluReadError) throw error
    throw mapTransportError(error)
  } finally {
    agent?.destroy()
  }
}

export async function readCommanderVpluProduct({
  origin,
  sessionCookie,
  trust,
  upc,
  modifier = '000',
  timeoutMs = COMMANDER_VPLU_TIMEOUT_MS,
  transport,
  requestFactory,
}) {
  let agent

  try {
    if (
      !Number.isInteger(timeoutMs)
      || timeoutMs < 1
      || timeoutMs > 60_000
    ) fail('request_invalid')

    const url = validateOrigin(origin)
    const normalizedUpc = normalizeUpc(upc)
    const normalizedModifier = normalizeModifier(modifier)
    const body = buildCommanderVpluRequestBody({
      sessionCookie,
      upc: normalizedUpc,
      modifier: normalizedModifier,
    })

    const endpoint = `${url.origin}${COMMANDER_VPLU_PATH}`
    const options = {
      method: 'POST',
      headers: {
        'content-type': 'text/plain; charset=UTF-8',
        'content-length': Buffer.byteLength(body),
      },
      rejectUnauthorized: true,
      servername: trust?.serverName,
    }

    let response
    if (transport) {
      response = await transport({
        url: endpoint,
        options,
        body,
        timeoutMs,
      })
    } else {
      agent = createVerifiedAgent(trust)
      response = await defaultCommanderVpluTransport({
        url: endpoint,
        options: { ...options, agent },
        body,
        timeoutMs,
        requestFactory,
      })
    }

    if (
      !response
      || !Number.isInteger(response.status)
      || typeof response.body !== 'string'
      || Buffer.byteLength(response.body, 'utf8')
        > COMMANDER_VPLU_MAX_RESPONSE_BYTES
    ) fail('transport_failed')

    if (response.status === 401 || response.status === 403) {
      return { status: 'session_failed' }
    }

    if (response.status < 200 || response.status >= 300) {
      return { status: 'readback_failed' }
    }

    const products = parseCommanderVpluResponse(response.body)
    const selected = products.filter(
      (product) =>
        product.upc === normalizedUpc
        && product.modifier === normalizedModifier,
    )

    return selected.length === 1
      ? { status: 'success', product: selected[0] }
      : { status: 'product_not_found' }
  } catch (error) {
    if (
      error?.code === 'commander_tls_hostname_invalid'
      || error?.code === 'commander_tls_peer_mismatch'
    ) return { status: error.code }

    if (
      error?.code === 'response_invalid'
      || error?.code === 'response_too_large'
      || error?.code === 'vplu_response_invalid'
      || error?.code === 'duplicate_product_identity'
    ) return { status: 'readback_failed' }

    return { status: 'session_failed' }
  } finally {
    agent?.destroy()
  }
}
