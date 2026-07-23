import {
  createIdempotencyStore,
  normalizeProductIdentity,
  readCommanderProduct,
  sendSupportedProductWrite,
  validateProductCommand,
} from '../commander-product-integration.mjs';

export const CONTROLLED_TEST_PRODUCT = Object.freeze({
  upc: '00999999999993',
  modifier: '000',
  description: 'STOREPULSE TEST',
});

const INPUT_KEYS = new Set([
  'approval',
  'command_id',
  'controlled_test_product',
  'created_at',
  'expected_current_price',
  'idempotency_key',
  'modifier',
  'requested_price',
  'upc',
]);

const APPROVAL_KEYS = new Set([
  'approved',
  'approved_at',
  'approval_id',
  'operation',
]);

const SAFE_FIELDS = Object.freeze([
  'upc',
  'description',
  'price',
]);

const defaultIdempotencyStore = createIdempotencyStore();

function exactObjectKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const actual = Object.keys(value);

  return (
    actual.length === keys.size &&
    actual.every((key) => keys.has(key))
  );
}

function validToken(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(value)
  );
}

function validIsoTimestamp(value) {
  if (typeof value !== 'string') return false;

  const parsed = new Date(value);

  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString() === value
  );
}

function validMoney(value, allowZero = true) {
  if (
    typeof value !== 'string' ||
    !/^(?:0|[1-9]\d{0,5})\.\d{2}$/.test(value)
  ) {
    return false;
  }

  const amount = Number(value);

  return (
    Number.isFinite(amount) &&
    amount >= (allowZero ? 0 : 0.01) &&
    amount <= 999999.99
  );
}

function safe(code, state = {}) {
  return Object.freeze({
    write_succeeded: false,
    authenticated: false,
    tls_verified: false,
    product_found: false,
    identity_matched: false,
    expected_price_matched: false,
    write_attempted: false,
    write_accepted: false,
    readback_succeeded: false,
    readback_matched: false,
    idempotent: false,
    safe_fields_present: Object.freeze([]),
    ...state,
    safe_error_code: code,
  });
}

function successfulResult({ idempotent, writeAttempted }) {
  return safe(null, {
    write_succeeded: true,
    authenticated: true,
    tls_verified: true,
    product_found: true,
    identity_matched: true,
    expected_price_matched: true,
    write_attempted: writeAttempted,
    write_accepted: writeAttempted,
    readback_succeeded: true,
    readback_matched: true,
    idempotent,
    safe_fields_present: SAFE_FIELDS,
  });
}

function validateInput(input) {
  if (!exactObjectKeys(input, INPUT_KEYS)) {
    throw new Error('invalid_input');
  }

  if (!exactObjectKeys(input.approval, APPROVAL_KEYS)) {
    throw new Error('invalid_input');
  }

  if (
    input.controlled_test_product !== true ||
    input.upc !== CONTROLLED_TEST_PRODUCT.upc ||
    input.modifier !== CONTROLLED_TEST_PRODUCT.modifier ||
    !validMoney(input.expected_current_price) ||
    !validMoney(input.requested_price, false) ||
    !validToken(input.command_id) ||
    !validToken(input.idempotency_key) ||
    !validToken(input.approval.approval_id) ||
    !validIsoTimestamp(input.created_at) ||
    !validIsoTimestamp(input.approval.approved_at)
  ) {
    throw new Error('invalid_input');
  }

  const identity = normalizeProductIdentity({
    upc: CONTROLLED_TEST_PRODUCT.upc,
    modifier: CONTROLLED_TEST_PRODUCT.modifier,
  });

  const command = validateProductCommand({
    command_id: input.command_id,
    command_type: 'update_price',
    source_product_key: identity.source_product_key,
    identity: {
      upc: CONTROLLED_TEST_PRODUCT.upc,
      modifier: CONTROLLED_TEST_PRODUCT.modifier,
    },
    expected_current: {
      retail_price: input.expected_current_price,
    },
    requested_changes: {
      retail_price: input.requested_price,
    },
    approval: {
      approval_id: input.approval.approval_id,
      approved_at: input.approval.approved_at,
    },
    created_at: input.created_at,
    idempotency_key: input.idempotency_key,
  });

  return Object.freeze({
    command,
    expectedCurrentPrice: input.expected_current_price,
    requestedPrice: input.requested_price,
  });
}

function initialReadFailure(read) {
  if (
    read?.status === 'commander_tls_hostname_invalid' ||
    read?.status === 'commander_tls_peer_mismatch'
  ) {
    return safe(read.status);
  }

  if (read?.status === 'session_failed') {
    return safe('authentication_failed');
  }

  if (read?.status === 'product_not_found') {
    return safe('product_not_found');
  }

  return safe('vplus_failed');
}

function readbackFailure(read, state) {
  if (
    read?.status === 'commander_tls_hostname_invalid' ||
    read?.status === 'commander_tls_peer_mismatch'
  ) {
    return safe(read.status, state);
  }

  if (read?.status === 'session_failed') {
    return safe('authentication_failed', state);
  }

  return safe('readback_failed', state);
}

export async function runVerifyTestPriceWrite({
  input,
  queue,
  sessionManager,
  trust,
  origin,
  transport,
  idempotencyStore = defaultIdempotencyStore,
} = {}) {
  if (!input?.approval?.approved) {
    return safe('approval_required');
  }

  if (input.approval.operation !== 'verify_test_price_write') {
    return safe('approval_mismatch');
  }

  let validated;

  try {
    validated = validateInput(input);
  } catch {
    return safe('invalid_input');
  }

  if (
    !queue?.enqueue ||
    !sessionManager?.withSession ||
    !sessionManager?.invalidate ||
    !trust ||
    typeof origin !== 'string' ||
    typeof transport !== 'function' ||
    typeof idempotencyStore?.get !== 'function' ||
    typeof idempotencyStore?.put !== 'function'
  ) {
    return safe('internal_failure');
  }

  const prior = idempotencyStore.get(validated.command);

  if (prior === 'idempotency_key_conflict') {
    return safe('idempotency_key_conflict');
  }

  if (prior) {
    return prior;
  }

  let queued;

  try {
    queued = await queue.enqueue(
      { operationType: 'update_product_price' },
      async () => {
        try {
          return await sessionManager.withSession(async (cookie) => {
            let sessionCookie = cookie;

            try {
              const initial = await readCommanderProduct({
                origin,
                trust,
                sessionCookie,
                upc: CONTROLLED_TEST_PRODUCT.upc,
                modifier: CONTROLLED_TEST_PRODUCT.modifier,
                transport,
              });

              if (initial.status !== 'success') {
                return initialReadFailure(initial);
              }

              const product = initial.product;

              const authenticatedState = {
                authenticated: true,
                tls_verified: true,
                product_found: true,
              };

              if (
                product.upc !== CONTROLLED_TEST_PRODUCT.upc ||
                product.modifier !== CONTROLLED_TEST_PRODUCT.modifier ||
                product.description !== CONTROLLED_TEST_PRODUCT.description
              ) {
                return safe('product_identity_mismatch', authenticatedState);
              }

              const identityState = {
                ...authenticatedState,
                identity_matched: true,
              };

              if (product.retail_price !== validated.expectedCurrentPrice) {
                return safe('product_conflict', identityState);
              }

              const expectedState = {
                ...identityState,
                expected_price_matched: true,
              };

              if (product.retail_price === validated.requestedPrice) {
                const result = successfulResult({
                  idempotent: true,
                  writeAttempted: false,
                });

                idempotencyStore.put(validated.command, result);

                return result;
              }

              const write = await sendSupportedProductWrite({
                origin,
                trust,
                sessionCookie,
                command: validated.command,
                product,
                transport,
              });

              if (write.status !== 'success') {
                return safe('write_failed', {
                  ...expectedState,
                  write_attempted: true,
                });
              }

              const writeState = {
                ...expectedState,
                write_attempted: true,
                write_accepted: true,
              };

              const readback = await readCommanderProduct({
                origin,
                trust,
                sessionCookie,
                upc: CONTROLLED_TEST_PRODUCT.upc,
                modifier: CONTROLLED_TEST_PRODUCT.modifier,
                transport,
              });

              if (readback.status !== 'success') {
                return readbackFailure(readback, writeState);
              }

              const finalProduct = readback.product;

              const readbackState = {
                ...writeState,
                readback_succeeded: true,
              };

              if (
                finalProduct.upc !== CONTROLLED_TEST_PRODUCT.upc ||
                finalProduct.modifier !== CONTROLLED_TEST_PRODUCT.modifier ||
                finalProduct.description !== CONTROLLED_TEST_PRODUCT.description ||
                finalProduct.retail_price !== validated.requestedPrice
              ) {
                return safe('readback_mismatch', readbackState);
              }

              const result = successfulResult({
                idempotent: false,
                writeAttempted: true,
              });

              idempotencyStore.put(validated.command, result);

              return result;
            } catch {
              return safe('internal_failure');
            } finally {
              sessionCookie = null;
            }
          });
        } finally {
          sessionManager.invalidate();
        }
      },
    );
  } catch {
    return safe('internal_failure');
  }

  if (queued && typeof queued.write_succeeded === 'boolean') {
    return queued;
  }

  if (queued?.error_code === 'commander_connection_failed') {
    return safe('authentication_failed');
  }

  if (queued?.error_code === 'operation_not_allowed') {
    return safe('operation_not_allowed');
  }

  return safe('internal_failure');
}