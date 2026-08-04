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

export function parseCommanderVpluResponse(xml) {
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
    const description = nodeValue(child(node, 'description', true))
    const price = nodeValue(child(node, 'price', true))

    if (!upc || !modifier || !description || !price) {
      fail('vplu_response_invalid')
    }

    const departmentNumber =
      nodeValue(child(node, 'department', false))

    return Object.freeze({
      upc: normalizeUpc(upc),
      modifier: normalizeModifier(modifier),
      description: text(description, 512),
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
    })
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
