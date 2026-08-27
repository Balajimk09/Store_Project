import {
  executeProductCommand,
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

function normalizeDescription(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new CommanderPriceAdapterError('malformed_response', 'Description input was invalid.')
  }
  return value.normalize('NFC')
}

function normalizeDepartment(value) {
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value)) {
    throw new CommanderPriceAdapterError('malformed_response', 'Department input was invalid.')
  }
  return value
}

function normalizeProductSysid(value) {
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value)) {
    throw new CommanderPriceAdapterError(
      'malformed_response',
      'Commander product sysid was invalid.',
    )
  }

  return value
}

function normalizeProductDecimal(value, fractionDigits, maxWholeDigits = 6) {
  if (typeof value !== 'string') {
    throw new CommanderPriceAdapterError(
      'malformed_response',
      'Commander product decimal was invalid.',
    )
  }

  const pattern = new RegExp(
    `^(?:0|[1-9]\\d{0,${maxWholeDigits - 1}})(?:\\.\\d{1,${fractionDigits}})?$`,
  )

  if (!pattern.test(value)) {
    throw new CommanderPriceAdapterError(
      'malformed_response',
      'Commander product decimal was invalid.',
    )
  }

  const amount = Number(value)

  if (!Number.isFinite(amount) || amount < 0) {
    throw new CommanderPriceAdapterError(
      'malformed_response',
      'Commander product decimal was invalid.',
    )
  }

  return amount.toFixed(fractionDigits)
}

function normalizeProductMoneyAllowZero(value) {
  if (
    typeof value !== 'string'
    || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)
  ) {
    throw new CommanderPriceAdapterError(
      'malformed_response',
      'Commander product money was invalid.',
    )
  }

  const amount = Number(value)

  if (
    !Number.isFinite(amount)
    || amount < 0
    || amount > 999999.99
  ) {
    throw new CommanderPriceAdapterError(
      'malformed_response',
      'Commander product money was invalid.',
    )
  }

  return amount.toFixed(2)
}

function normalizeProductSysidList(value) {
  if (!Array.isArray(value) || value.length > 16) {
    throw new CommanderPriceAdapterError(
      'malformed_response',
      'Commander product sysid list was invalid.',
    )
  }

  const result = value.map(normalizeProductSysid)

  if (new Set(result).size !== result.length) {
    throw new CommanderPriceAdapterError(
      'malformed_response',
      'Commander product sysid list was invalid.',
    )
  }

  return Object.freeze(result)
}

function sameAdapterValue(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every(
        (value, index) => value === right[index],
      )
    )
  }

  return left === right
}

const OPTIONAL_PRODUCT_INPUTS = Object.freeze([
  [
    'expectedPaymentProductCode',
    'paymentProductCode',
    'payment_product_code',
    normalizeProductSysid,
  ],
  [
    'expectedSellingUnit',
    'sellingUnit',
    'selling_unit',
    value => normalizeProductDecimal(value, 3),
  ],
  [
    'expectedMaxQtyPerTrans',
    'maxQtyPerTrans',
    'maximum_quantity_per_transaction',
    value => normalizeProductDecimal(value, 2),
  ],
  [
    'expectedTaxableRebate',
    'taxableRebate',
    'taxable_rebate',
    normalizeProductMoneyAllowZero,
  ],
  [
    'expectedTaxRateIds',
    'taxRateIds',
    'tax_rate_ids',
    normalizeProductSysidList,
  ],
  [
    'expectedIdCheckIds',
    'idCheckIds',
    'id_check_ids',
    normalizeProductSysidList,
  ],
])

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
    ...(typeof adapter.updateProduct === 'function'
      ? { updateProduct: (input) => invoke('updateProduct', input) }
      : {}),
    ...(typeof adapter.readProductDetail === 'function'
      ? { readProductDetail: (input) => invoke('readProductDetail', input) }
      : {}),
    ...(typeof adapter.createProduct === 'function'
      ? { createProduct: (input) => invoke('createProduct', input) }
      : {}),
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

    async updateProduct(input) {
      const baseKeys = [
        'upc',
        'modifier',
        'expectedDescription',
        'description',
        'expectedDepartment',
        'department',
        'expectedPrice',
        'price',
      ]

      const optionalInputKeys = OPTIONAL_PRODUCT_INPUTS.flatMap(
        ([expectedKey, requestedKey]) => [
          expectedKey,
          requestedKey,
        ],
      )

      const allowedKeys = new Set([
        ...baseKeys,
        ...optionalInputKeys,
      ])

      if (
        !isPlainRecord(input)
        || baseKeys.some(key => !Object.hasOwn(input, key))
        || Object.keys(input).some(key => !allowedKeys.has(key))
      ) {
        throw new CommanderPriceAdapterError(
          'malformed_response',
          'Product update input was invalid.',
        )
      }

      for (const [expectedKey, requestedKey] of OPTIONAL_PRODUCT_INPUTS) {
        if (
          Object.hasOwn(input, expectedKey)
          !== Object.hasOwn(input, requestedKey)
        ) {
          throw new CommanderPriceAdapterError(
            'malformed_response',
            'Product update optional field pair was invalid.',
          )
        }
      }

      const identity = assertIdentity({
        upc: input.upc,
        modifier: input.modifier,
      })

      const expectedState = {
        description: normalizeDescription(
          input.expectedDescription,
        ),

        department_number: normalizeDepartment(
          input.expectedDepartment,
        ),

        retail_price: normalizePrice(
          input.expectedPrice,
        ),
      }

      const requestedState = {
        description: normalizeDescription(
          input.description,
        ),

        department_number: normalizeDepartment(
          input.department,
        ),

        retail_price: normalizePrice(
          input.price,
        ),
      }

      for (
        const [
          expectedKey,
          requestedKey,
          commandKey,
          normalize,
        ] of OPTIONAL_PRODUCT_INPUTS
      ) {
        if (!Object.hasOwn(input, expectedKey)) {
          continue
        }

        expectedState[commandKey] = normalize(
          input[expectedKey],
        )

        requestedState[commandKey] = normalize(
          input[requestedKey],
        )
      }

      const unchanged = Object.keys(expectedState).every(
        key => sameAdapterValue(
          expectedState[key],
          requestedState[key],
        ),
      )

      if (unchanged) {
        throw new CommanderPriceAdapterError(
          'malformed_response',
          'Product update does not change any supported Commander field.',
        )
      }

      const current = await readCurrent(identity)

      if (
        typeof current.description !== 'string'
        || typeof current.department_number !== 'string'
      ) {
        throw new CommanderPriceAdapterError(
          'malformed_response',
          'Commander product fields were unavailable.',
        )
      }

      const alreadyApplied = Object.keys(requestedState).every(
        key => sameAdapterValue(
          current[key],
          requestedState[key],
        ),
      )

      if (alreadyApplied) {
        return {
          idempotent: true,
        }
      }

      for (const key of Object.keys(expectedState)) {
        if (
          !sameAdapterValue(
            current[key],
            expectedState[key],
          )
        ) {
          throw new CommanderPriceAdapterError(
            'price_conflict',
            'Commander product changed before the update.',
          )
        }
      }

      const sourceProductKey =
        `upc:${identity.upc}|modifier:${identity.modifier}`

      const fingerprint = JSON.stringify({
        expectedState,
        requestedState,
      })

      let hash = 2166136261

      for (
        let index = 0;
        index < fingerprint.length;
        index += 1
      ) {
        hash ^= fingerprint.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
      }

      const command = Object.freeze({
        command_id:
          `product-${identity.upc}-${identity.modifier}`,

        command_type:
          'update_product',

        source_product_key:
          sourceProductKey,

        identity,

        expected_current:
          Object.freeze(expectedState),

        requested_changes:
          Object.freeze(requestedState),

        approval: null,

        created_at:
          new Date().toISOString(),

        idempotency_key:
          `product:${identity.upc}:${identity.modifier}:${(hash >>> 0).toString(16)}`,
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
        throw new CommanderPriceAdapterError(
          'update_rejected',
          'Commander rejected the product update.',
        )
      }

      if (write?.status !== 'success') {
        throw new CommanderPriceAdapterError(
          'update_rejected',
          'Commander rejected the product update.',
        )
      }

      return {
        idempotent: false,
      }
    },
    async createProduct(input) {
      const keys = ['upc', 'modifier', 'description', 'price', 'department', 'paymentProductCode', 'sellingUnit', 'maxQtyPerTrans', 'taxableRebate', 'taxRateIds', 'idCheckIds', 'flagIds', 'jobId']
      if (!isPlainRecord(input) || Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) {
        throw new CommanderPriceAdapterError('malformed_response', 'Product create input was invalid.')
      }
      const identity = assertIdentity({ upc: input.upc, modifier: input.modifier })
      const command = Object.freeze({
        command_id: `create-${identity.upc}-${identity.modifier}`,
        command_type: 'create_product',
        source_product_key: `upc:${identity.upc}|modifier:${identity.modifier}`,
        identity,
        expected_current: null,
        requested_changes: Object.freeze({
          description: normalizeDescription(input.description), retail_price: normalizePrice(input.price),
          department_number: normalizeDepartment(input.department), payment_product_code: normalizeProductSysid(input.paymentProductCode),
          selling_unit: normalizeProductDecimal(input.sellingUnit, 3), maximum_quantity_per_transaction: normalizeProductDecimal(input.maxQtyPerTrans, 2),
          taxable_rebate: normalizeProductMoneyAllowZero(input.taxableRebate), tax_rate_ids: normalizeProductSysidList(input.taxRateIds),
          id_check_ids: normalizeProductSysidList(input.idCheckIds), flag_ids: normalizeProductSysidList(input.flagIds),
        }),
        approval: null, created_at: new Date().toISOString(), idempotency_key: `create:${input.jobId}`,
      })
      const result = await executeProductCommand({
        command,
        sessionProvider: async () => Object.freeze({}),
        readProduct: async () => {
          try { return await readCurrent(identity) } catch (error) { if (error?.kind === 'product_not_found') return null; throw error }
        },
        writeProduct: async () => {
          const write = await sendSupportedProductWriteImpl({ origin, sessionCookie, trust, command, product: null })
          return { ok: write?.status === 'success' }
        },
      })
      if (result?.status === 'success') return { idempotent: result.idempotent === true }
      const kind = result?.status === 'product_already_exists' ? 'product_already_exists' : result?.status === 'create_verification_failed' ? 'verification_mismatch' : 'update_rejected'
      throw new CommanderPriceAdapterError(kind, 'Commander product creation was not verified.')
    },
    async readProduct(input) {
      if (!isPlainRecord(input) || Object.keys(input).length !== 2) {
        throw new CommanderPriceAdapterError('malformed_response', 'Product read input was invalid.')
      }
      const identity = assertIdentity(input)
      const product = await readCurrent(identity)
      return Object.freeze({ upc: product.upc, modifier: product.modifier, price: product.retail_price })
    },

    async readProductDetail(input) {
      if (
        !isPlainRecord(input)
        || Object.keys(input).length !== 2
      ) {
        throw new CommanderPriceAdapterError(
          'malformed_response',
          'Product read input was invalid.',
        )
      }

      const identity = assertIdentity(input)
      const product = await readCurrent(identity)

      if (
        typeof product.description !== 'string'
        || typeof product.department_number !== 'string'
        || typeof product.payment_product_code !== 'string'
        || typeof product.selling_unit !== 'string'
        || typeof product.maximum_quantity_per_transaction !== 'string'
        || typeof product.taxable_rebate !== 'string'
        || !Array.isArray(product.flag_ids)
        || !Array.isArray(product.tax_rate_ids)
        || !Array.isArray(product.id_check_ids)
      ) {
        throw new CommanderPriceAdapterError(
          'malformed_response',
          'Commander product fields were unavailable.',
        )
      }

      return Object.freeze({
        upc: product.upc,
        modifier: product.modifier,

        description: normalizeDescription(
          product.description,
        ),

        department: normalizeDepartment(
          product.department_number,
        ),

        price: product.retail_price,

        payment_product_code: normalizeProductSysid(
          product.payment_product_code,
        ),

        selling_unit: normalizeProductDecimal(
          product.selling_unit,
          3,
        ),

        maximum_quantity_per_transaction:
          normalizeProductDecimal(
            product.maximum_quantity_per_transaction,
            2,
          ),

        taxable_rebate:
          normalizeProductMoneyAllowZero(
            product.taxable_rebate,
          ),

        // Read-only until Commander flag sysids are proven.
        flag_ids: normalizeProductSysidList(
          product.flag_ids,
        ),

        tax_rate_ids: normalizeProductSysidList(
          product.tax_rate_ids,
        ),

        id_check_ids: normalizeProductSysidList(
          product.id_check_ids,
        ),
      })
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
