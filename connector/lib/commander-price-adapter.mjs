import {
  readCommanderProduct,
  sendSupportedProductWrite,
} from './commander/commander-product-integration.mjs'
import { CommanderPriceAdapterError } from './pos-publish-errors.mjs'

const PRICE_PATTERN = /^(?:0|[1-9]\d*)\.\d{2}$/
const UPC_PATTERN = /^\d{14}$/
const MODIFIER_PATTERN = /^\d{3}$/

function isPlainRecord(value) {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function normalizePrice(value) {
  if (typeof value !== 'string' || !PRICE_PATTERN.test(value)) {
    throw new CommanderPriceAdapterError('malformed_response', 'Price input was invalid.')
  }
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999.99) {
    throw new CommanderPriceAdapterError('malformed_response', 'Price input was invalid.')
  }
  return amount.toFixed(2)
}

function assertIdentity(input) {
  if (!isPlainRecord(input) || Object.keys(input).length !== 2 || !UPC_PATTERN.test(input.upc) || !MODIFIER_PATTERN.test(input.modifier)) {
    throw new CommanderPriceAdapterError('identity_mismatch', 'Commander product identity was invalid.')
  }
  return Object.freeze({ upc: input.upc, modifier: input.modifier })
}

function assertReturnedProduct(product, identity) {
  if (
    !product
    || product.upc !== identity.upc
    || product.modifier !== identity.modifier
    || typeof product.retail_price !== 'string'
    || !PRICE_PATTERN.test(product.retail_price)
  ) {
    throw new CommanderPriceAdapterError('identity_mismatch', 'Commander product identity did not match.')
  }
  return product
}

function mapReadFailure(status) {
  if (status === 'product_not_found') {
    return new CommanderPriceAdapterError('product_not_found', 'Controlled pilot product was not found.')
  }
  if (status === 'commander_tls_hostname_invalid' || status === 'commander_tls_peer_mismatch') {
    return new CommanderPriceAdapterError('tls_failed', 'Commander TLS verification failed.')
  }
  if (status === 'session_failed') {
    return new CommanderPriceAdapterError('auth_failed', 'Commander authentication was rejected.')
  }
  if (status === 'readback_failed') {
    return new CommanderPriceAdapterError('unreachable', 'Commander read request failed.')
  }
  return new CommanderPriceAdapterError('malformed_response', 'Commander returned an unexpected result.')
}

export function assertCommanderPriceAdapter(adapter) {
  if (!adapter || typeof adapter.updatePrice !== 'function' || typeof adapter.readProduct !== 'function') {
    throw new CommanderPriceAdapterError('malformed_response', 'Commander adapter is unavailable.')
  }
  const invoke = async (method, input) => {
    try {
      return await adapter[method](input)
    } catch (error) {
      if (error instanceof CommanderPriceAdapterError) throw error
      throw new CommanderPriceAdapterError('malformed_response', 'Commander adapter returned an unexpected error.')
    }
  }
  return {
    updatePrice: (input) => invoke('updatePrice', input),
    readProduct: (input) => invoke('readProduct', input),
  }
}

/**
 * Creates the bounded Commander price adapter.
 * Authentication is performed by the primary PowerShell service process;
 * this adapter receives only its bounded session cookie and performs pinned HTTPS.
 */
export function createCommanderPriceAdapter({
  origin,
  sessionCookie,
  trust,
  readCommanderProductImpl = readCommanderProduct,
  sendSupportedProductWriteImpl = sendSupportedProductWrite,
} = {}) {
  if (
    typeof origin !== 'string'
    || typeof sessionCookie !== 'string'
    || sessionCookie.length < 1
    || sessionCookie.length > 4096
    || /[\u0000-\u001f\u007f-\u009f&=]/u.test(sessionCookie)
    || !trust
    || typeof readCommanderProductImpl !== 'function'
    || typeof sendSupportedProductWriteImpl !== 'function'
  ) {
    throw new CommanderPriceAdapterError('malformed_response', 'Commander adapter configuration was invalid.')
  }

  async function readCurrent(identity) {
    let response
    try {
      response = await readCommanderProductImpl({
        origin,
        sessionCookie,
        trust,
        upc: identity.upc,
        modifier: identity.modifier,
      })
    } catch {
      throw new CommanderPriceAdapterError('unreachable', 'Commander read request failed.')
    }
    if (response?.status !== 'success') throw mapReadFailure(response?.status)
    return assertReturnedProduct(response.product, identity)
  }

  return assertCommanderPriceAdapter({
    async updatePrice(input) {
      if (!isPlainRecord(input) || Object.keys(input).length !== 4) {
        throw new CommanderPriceAdapterError('malformed_response', 'Price update input was invalid.')
      }
      const identity = assertIdentity({ upc: input.upc, modifier: input.modifier })
      const expectedPrice = normalizePrice(input.expectedPrice)
      const requestedPrice = normalizePrice(input.price)
      if (expectedPrice === requestedPrice) {
        throw new CommanderPriceAdapterError('malformed_response', 'Requested price must differ from the expected current price.')
      }

      const current = await readCurrent(identity)
      if (current.retail_price === requestedPrice) {
        return { idempotent: true }
      }
      if (current.retail_price !== expectedPrice) {
        throw new CommanderPriceAdapterError('price_conflict', 'Commander price changed before the update.')
      }

      const sourceProductKey = `upc:${identity.upc}|modifier:${identity.modifier}`
      const command = Object.freeze({
        command_id: `price-${identity.upc}-${identity.modifier}`,
        command_type: 'update_price',
        source_product_key: sourceProductKey,
        identity,
        expected_current: Object.freeze({ retail_price: expectedPrice }),
        requested_changes: Object.freeze({ retail_price: requestedPrice }),
        approval: null,
        created_at: new Date().toISOString(),
        idempotency_key: `price:${identity.upc}:${identity.modifier}:${expectedPrice}:${requestedPrice}`,
      })

      let write
      try {
        write = await sendSupportedProductWriteImpl({
          origin,
          sessionCookie,
          trust,
          command,
          product: current,
        })
      } catch {
        throw new CommanderPriceAdapterError('update_rejected', 'Commander rejected the price update.')
      }
      if (write?.status !== 'success') {
        throw new CommanderPriceAdapterError('update_rejected', 'Commander rejected the price update.')
      }
      return { idempotent: false }
    },

    async readProduct(input) {
      if (!isPlainRecord(input) || Object.keys(input).length !== 2) {
        throw new CommanderPriceAdapterError('malformed_response', 'Product read input was invalid.')
      }
      const identity = assertIdentity(input)
      const product = await readCurrent(identity)
      return Object.freeze({ upc: product.upc, modifier: product.modifier, price: product.retail_price })
    },
  })
}

// Compatibility export for the completed controlled pilot. New callers use the generic name.
export const createControlledCommanderPriceAdapter = createCommanderPriceAdapter

// This mock-only adapter deliberately contains no network, authentication, XML, or Commander protocol code.
export function createMockCommanderPriceAdapter({ updatePrice, readProduct }) {
  return assertCommanderPriceAdapter({ updatePrice, readProduct })
}

export { CommanderPriceAdapterError }
