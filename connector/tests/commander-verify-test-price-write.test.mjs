import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIdempotencyStore,
} from '../lib/commander/commander-product-integration.mjs';

import {
  createCommanderOperationQueue,
} from '../lib/commander/runtime/commander-operation-queue.mjs';

import {
  createCommanderSessionManager,
} from '../lib/commander/session/commander-session-manager.mjs';

import {
  CONTROLLED_TEST_PRODUCT,
  runVerifyTestPriceWrite,
} from '../lib/commander/maintenance/verify-test-price-write.mjs';

const trust = {
  caBundle: Buffer.from(
    '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n',
  ),
  serverName: 'commander.fixture',
  peerSha256: 'A'.repeat(64),
};

function productXml({
  price = '0.02',
  upc = CONTROLLED_TEST_PRODUCT.upc,
  modifier = CONTROLLED_TEST_PRODUCT.modifier,
  description = CONTROLLED_TEST_PRODUCT.description,
} = {}) {
  return `<domain:PLUs page="1" ofPages="1" xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><domain:PLU><upc>${upc}</upc><upcModifier>${modifier}</upcModifier><description>${description}</description><department>1</department><fees><fee>0</fee></fees><pcode>0</pcode><price>${price}</price><flags><domain:flag sysid="1"/></flags><taxRates><domain:taxRate sysid="1"/></taxRates><idChecks><domain:idCheck sysid="1"/></idChecks><SellUnit>1.000</SellUnit><taxableRebate><amount>0.00</amount></taxableRebate><maxQtyPerTrans>0.00</maxQtyPerTrans></domain:PLU></domain:PLUs>`;
}

function makeInput(overrides = {}) {
  const base = {
    approval: {
      approved: true,
      operation: 'verify_test_price_write',
      approval_id: 'approval-1',
      approved_at: '2026-07-22T23:00:00.000Z',
    },
    command_id: 'command-1',
    controlled_test_product: true,
    created_at: '2026-07-22T22:59:00.000Z',
    expected_current_price: '0.02',
    idempotency_key: 'idempotency-1',
    modifier: CONTROLLED_TEST_PRODUCT.modifier,
    requested_price: '0.03',
    upc: CONTROLLED_TEST_PRODUCT.upc,
  };

  return {
    ...base,
    ...overrides,
    approval: {
      ...base.approval,
      ...(overrides.approval || {}),
    },
  };
}

function dependencies({ authenticate, transport }) {
  return {
    queue: createCommanderOperationQueue(),
    sessionManager: createCommanderSessionManager({ authenticate }),
    trust,
    origin: 'https://commander.fixture',
    transport,
  };
}

test('guard rejects missing approval, mismatched approval, unsafe identity, and extra fields before authentication', async () => {
  let authenticationCount = 0;
  let transportCount = 0;

  const shared = dependencies({
    authenticate: async () => {
      authenticationCount += 1;
      return { cookie: 'private-cookie' };
    },
    transport: async () => {
      transportCount += 1;
      throw new Error('transport must not run');
    },
  });

  const approvalRequired = await runVerifyTestPriceWrite({
    input: makeInput({
      approval: {
        approved: false,
      },
    }),
    ...shared,
  });

  assert.equal(approvalRequired.safe_error_code, 'approval_required');

  const approvalMismatch = await runVerifyTestPriceWrite({
    input: makeInput({
      approval: {
        operation: 'read_test_product',
      },
    }),
    ...shared,
  });

  assert.equal(approvalMismatch.safe_error_code, 'approval_mismatch');

  const wrongProduct = await runVerifyTestPriceWrite({
    input: makeInput({
      upc: '00000000000000',
    }),
    ...shared,
  });

  assert.equal(wrongProduct.safe_error_code, 'invalid_input');

  const extraField = await runVerifyTestPriceWrite({
    input: {
      ...makeInput(),
      origin: 'https://unsafe.example',
    },
    ...shared,
  });

  assert.equal(extraField.safe_error_code, 'invalid_input');
  assert.equal(authenticationCount, 0);
  assert.equal(transportCount, 0);
});

test('guard performs one authenticated vPLUs, uPLUs, vPLUs sequence and returns only bounded safe metadata', async () => {
  let authenticationCount = 0;
  let requestCount = 0;
  let currentPrice = '0.02';

  const sessionManager = createCommanderSessionManager({
    authenticate: async () => ({
      cookie: `private-cookie-${++authenticationCount}`,
    }),
  });

  const result = await runVerifyTestPriceWrite({
    input: makeInput(),
    queue: createCommanderOperationQueue(),
    sessionManager,
    trust,
    origin: 'https://commander.fixture',
    transport: async ({ body, options }) => {
      requestCount += 1;

      assert.equal(options.rejectUnauthorized, true);
      assert.equal(options.servername, 'commander.fixture');
      assert.equal(body.includes('private-cookie-1'), true);

      if (body.startsWith('cmd=vPLUs&cookie=')) {
        return {
          status: 200,
          body: productXml({ price: currentPrice }),
        };
      }

      assert.equal(body.startsWith('cmd=uPLUs&cookie='), true);
      assert.match(body, /<price>0\.03<\/price>/);

      currentPrice = '0.03';

      return {
        status: 200,
        body: '<VFI:Response xmlns:VFI="urn:vfi-sapphire:np.domain.2001-07-01"/>',
      };
    },
    idempotencyStore: createIdempotencyStore(),
  });

  assert.deepEqual(result, {
    write_succeeded: true,
    authenticated: true,
    tls_verified: true,
    product_found: true,
    identity_matched: true,
    expected_price_matched: true,
    write_attempted: true,
    write_accepted: true,
    readback_succeeded: true,
    readback_matched: true,
    idempotent: false,
    safe_fields_present: ['upc', 'description', 'price'],
    safe_error_code: null,
  });

  assert.equal(authenticationCount, 1);
  assert.equal(requestCount, 3);
  assert.equal(sessionManager.status(), 'expired');

  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('private-cookie'), false);
  assert.equal(serialized.includes(CONTROLLED_TEST_PRODUCT.upc), false);
  assert.equal(serialized.includes('<domain:'), false);
});

test('guard detects identity conflicts, price conflicts, write rejection, and readback mismatch', async () => {
  const run = async (transport, input = makeInput()) => {
    const sessionManager = createCommanderSessionManager({
      authenticate: async () => ({
        cookie: 'private-cookie',
      }),
    });

    return runVerifyTestPriceWrite({
      input,
      queue: createCommanderOperationQueue(),
      sessionManager,
      trust,
      origin: 'https://commander.fixture',
      transport,
      idempotencyStore: createIdempotencyStore(),
    });
  };

  const identityMismatch = await run(async () => ({
    status: 200,
    body: productXml({
      description: 'NOT THE CONTROLLED PRODUCT',
    }),
  }));

  assert.equal(
    identityMismatch.safe_error_code,
    'product_identity_mismatch',
  );

  const priceConflict = await run(async () => ({
    status: 200,
    body: productXml({
      price: '0.01',
    }),
  }));

  assert.equal(priceConflict.safe_error_code, 'product_conflict');
  assert.equal(priceConflict.write_attempted, false);

  let writeFailureCalls = 0;

  const writeFailure = await run(async ({ body }) => {
    writeFailureCalls += 1;

    if (body.startsWith('cmd=vPLUs&cookie=')) {
      return {
        status: 200,
        body: productXml(),
      };
    }

    return {
      status: 500,
      body: '<failure/>',
    };
  });

  assert.equal(writeFailure.safe_error_code, 'write_failed');
  assert.equal(writeFailure.write_attempted, true);
  assert.equal(writeFailure.write_accepted, false);
  assert.equal(writeFailureCalls, 2);

  let readbackCalls = 0;

  const readbackMismatch = await run(async ({ body }) => {
    readbackCalls += 1;

    if (body.startsWith('cmd=uPLUs&cookie=')) {
      return {
        status: 200,
        body: '<VFI:Response xmlns:VFI="urn:vfi-sapphire:np.domain.2001-07-01"/>',
      };
    }

    return {
      status: 200,
      body: productXml({
        price: '0.02',
      }),
    };
  });

  assert.equal(readbackMismatch.safe_error_code, 'readback_mismatch');
  assert.equal(readbackMismatch.write_accepted, true);
  assert.equal(readbackMismatch.readback_succeeded, true);
  assert.equal(readbackMismatch.readback_matched, false);
  assert.equal(readbackCalls, 3);
});

test('guard short-circuits an already-applied price and enforces idempotency-key consistency', async () => {
  let authenticationCount = 0;
  let requestCount = 0;

  const store = createIdempotencyStore();

  const buildDependencies = () => ({
    queue: createCommanderOperationQueue(),
    sessionManager: createCommanderSessionManager({
      authenticate: async () => ({
        cookie: `private-cookie-${++authenticationCount}`,
      }),
    }),
    trust,
    origin: 'https://commander.fixture',
    transport: async ({ body }) => {
      requestCount += 1;
      assert.equal(body.startsWith('cmd=vPLUs&cookie='), true);

      return {
        status: 200,
        body: productXml({
          price: '0.02',
        }),
      };
    },
    idempotencyStore: store,
  });

  const input = makeInput({
    requested_price: '0.02',
  });

  const first = await runVerifyTestPriceWrite({
    input,
    ...buildDependencies(),
  });

  assert.equal(first.write_succeeded, true);
  assert.equal(first.idempotent, true);
  assert.equal(first.write_attempted, false);
  assert.equal(requestCount, 1);
  assert.equal(authenticationCount, 1);

  const replay = await runVerifyTestPriceWrite({
    input,
    ...buildDependencies(),
  });

  assert.deepEqual(replay, first);
  assert.equal(requestCount, 1);
  assert.equal(authenticationCount, 1);

  const conflict = await runVerifyTestPriceWrite({
    input: makeInput({
      requested_price: '0.03',
    }),
    ...buildDependencies(),
  });

  assert.equal(conflict.safe_error_code, 'idempotency_key_conflict');
  assert.equal(requestCount, 1);
  assert.equal(authenticationCount, 1);
});