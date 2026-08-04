import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SELECTED_PREVIEW_ENDPOINT_PATH,
  createSelectedProductPreviewIdempotencyKey,
  normalizeCommanderProductForPreview,
  parseCommanderSelectedProductsArtifact,
  runCommanderSelectedProductPreview,
  validateCommanderSelectedProductsArtifact,
} from '../lib/catalog-sync/selected-product-preview-runner.mjs';

const STORE_ID = 'ec192877-0156-42ab-8fbf-31105f3e2ea3';
const OWNER_ID = 'c702332a-9299-4b1a-9583-a01302bd7b4a';
const SYNC_RUN_ID = '11111111-1111-4111-8111-111111111111';

function artifact(products = [
  { upc: '00999999999993', modifier: '000', reason: 'Controlled product.' },
  { upc: '00000000000014', modifier: '145', reason: 'Modifier coverage.' },
]) {
  return {
    schema_version: '1', mode: 'selected_products',
    store: { store_id: STORE_ID, owner_id: OWNER_ID, store_name: 'Balaji Stores', source_system: 'verifone_commander', source_store_number: 'AB123' },
    safety: { read_only: true, automatic_publishing_enabled: false, retain_raw_xml: false, retain_credentials_or_cookies: false, max_selected_products: 10 },
    products,
  };
}
function product(upc, modifier, overrides = {}) {
  return {
    plu: null, modifier, upc, source_product_key: `upc:${upc}|modifier:${modifier}`, identity_provisional: true,
    description: 'STOREPULSE TEST', retail_price: '0.02', cost: null,
    department_number: '10', department_name: null, category_number: null, category_name: null,
    tax_number: null, tax_name: null, age_restriction: null, active: null,
    raw_payload_hash: 'a'.repeat(64),
    _write_template: { name: 'domain:PLU', secretRawStructure: '<domain:PLU>must-not-leak</domain:PLU>' },
    ...overrides,
  };
}
function successBody(selectionCount, receivedProductCount) {
  return { ok: true, syncRunId: SYNC_RUN_ID, created: true, connectorName: 'StorePulse Commander', storeId: STORE_ID, mode: 'selected_products', catalogComplete: false, previewOnly: true, selectionCount, receivedProductCount };
}

test('selection artifact is exact, bounded, duplicate-safe, and preserves leading zeroes', () => {
  const normalized = validateCommanderSelectedProductsArtifact(artifact());
  assert.equal(normalized.selectedProducts.length, 2);
  assert.equal(normalized.selectedProducts[0].upc, '00999999999993');
  assert.equal(normalized.selectedProducts[1].modifier, '145');
  assert.equal(normalized.store.sourceStoreNumber, 'AB123');
  assert.throws(() => validateCommanderSelectedProductsArtifact({ ...artifact(), extra: true }), /selection_artifact_invalid/);
  assert.throws(() => validateCommanderSelectedProductsArtifact(artifact([
    { upc: '1', modifier: '000', reason: 'First.' }, { upc: '1', modifier: '000', reason: 'Duplicate.' },
  ])), /selection_artifact_invalid/);
});

test('artifact text parser rejects invalid JSON and oversized input', () => {
  assert.equal(parseCommanderSelectedProductsArtifact(JSON.stringify(artifact())).mode, 'selected_products');
  assert.throws(() => parseCommanderSelectedProductsArtifact('{'), /selection_artifact_invalid/);
  assert.throws(() => parseCommanderSelectedProductsArtifact(' '.repeat(40 * 1024)), /selection_artifact_invalid/);
});

test('Commander product normalization emits only the preview contract fields', () => {
  const selectedIdentity = validateCommanderSelectedProductsArtifact(artifact([{ upc: '00999999999993', modifier: '000', reason: 'Controlled.' }])).selectedProducts[0];
  const normalized = normalizeCommanderProductForPreview({ sourceStoreNumber: 'AB123', selectedIdentity, product: product(selectedIdentity.upc, selectedIdentity.modifier) });
  assert.deepEqual(Object.keys(normalized), [
    'sourceSystem','sourceStoreNumber','sourceProductKey','upc','modifier','description','retailPrice','cost','departmentNumber','departmentName','categoryNumber','categoryName','taxNumber','taxName','ageRestriction','active','payloadHash',
  ]);
  assert.equal(normalized.retailPrice, 0.02);
  assert.equal('_write_template' in normalized, false);
});

test('idempotency key is deterministic, bounded, and capture-sensitive', () => {
  const selected = validateCommanderSelectedProductsArtifact(artifact()).selectedProducts;
  const first = createSelectedProductPreviewIdempotencyKey({ sourceStoreNumber: 'AB123', capturedAt: '2026-07-31T15:00:00.000Z', selectedProducts: selected });
  const repeated = createSelectedProductPreviewIdempotencyKey({ sourceStoreNumber: 'AB123', capturedAt: '2026-07-31T15:00:00.000Z', selectedProducts: selected });
  const later = createSelectedProductPreviewIdempotencyKey({ sourceStoreNumber: 'AB123', capturedAt: '2026-07-31T15:00:01.000Z', selectedProducts: selected });
  assert.equal(first, repeated); assert.notEqual(first, later); assert.match(first, /^catalog-preview:[0-9a-f]{64}$/);
});

test('runner reads selected identities sequentially and submits one preview-only request', async () => {
  const calls = []; let activeReads = 0; let maximumConcurrentReads = 0; let submission;
  const result = await runCommanderSelectedProductPreview({
    selectionArtifact: artifact(), clock: () => new Date('2026-07-31T15:00:00.000Z'),
    readSelectedProduct: async (identity) => {
      activeReads += 1; maximumConcurrentReads = Math.max(maximumConcurrentReads, activeReads); calls.push(identity); await Promise.resolve(); activeReads -= 1;
      return identity.modifier === '145' ? { status: 'product_not_found' } : { status: 'success', product: product(identity.upc, identity.modifier) };
    },
    submitPreview: async (request) => { submission = request; return { status: 200, body: successBody(2, 1) }; },
  });
  assert.equal(result.ok, true); assert.equal(result.selection_count, 2); assert.equal(result.received_product_count, 1); assert.equal(result.missing_selected_count, 1);
  assert.equal(maximumConcurrentReads, 1);
  assert.deepEqual(calls, [{ upc: '00999999999993', modifier: '000' }, { upc: '00000000000014', modifier: '145' }]);
  assert.equal(submission.endpointPath, SELECTED_PREVIEW_ENDPOINT_PATH); assert.equal(submission.method, 'POST');
  assert.match(submission.idempotencyKey, /^catalog-preview:[0-9a-f]{64}$/); assert.equal(submission.body.products.length, 1);
  const serialized = JSON.stringify(submission);
  assert.equal(serialized.includes('_write_template'), false); assert.equal(serialized.includes('must-not-leak'), false); assert.equal(serialized.includes('cookie'), false); assert.equal(serialized.includes('uPLUs'), false);
});

test('runner aborts without submission for authentication, TLS, read, and identity failures', async () => {
  for (const [readResult, expectedCode] of [
    [{ status: 'session_failed' }, 'commander_authentication_failed'],
    [{ status: 'commander_tls_hostname_invalid' }, 'commander_tls_hostname_invalid'],
    [{ status: 'commander_tls_peer_mismatch' }, 'commander_tls_peer_mismatch'],
    [{ status: 'readback_failed' }, 'commander_read_failed'],
    [{ status: 'success', product: product('999', '000') }, 'commander_product_invalid'],
  ]) {
    let submissions = 0;
    const result = await runCommanderSelectedProductPreview({
      selectionArtifact: artifact([{ upc: '00999999999993', modifier: '000', reason: 'Controlled.' }]),
      readSelectedProduct: async () => readResult,
      submitPreview: async () => { submissions += 1; return { status: 200, body: successBody(1, 1) }; },
      clock: () => new Date('2026-07-31T15:00:00.000Z'),
    });
    assert.equal(result.ok, false); assert.equal(result.safe_error_code, expectedCode); assert.equal(result.preview_submitted, false); assert.equal(submissions, 0);
  }
});

test('runner maps preview authorization, idempotency, transport, and response failures safely', async () => {
  for (const [response, expectedCode] of [
    [{ status: 401, body: {} }, 'preview_unauthorized'], [{ status: 409, body: {} }, 'preview_idempotency_conflict'],
    [{ status: 500, body: {} }, 'preview_submission_failed'], [{ status: 200, body: { ok: true } }, 'preview_response_invalid'],
  ]) {
    const result = await runCommanderSelectedProductPreview({
      selectionArtifact: artifact([{ upc: '00999999999993', modifier: '000', reason: 'Controlled.' }]),
      readSelectedProduct: async (identity) => ({ status: 'success', product: product(identity.upc, identity.modifier) }),
      submitPreview: async () => response, clock: () => new Date('2026-07-31T15:00:00.000Z'),
    });
    assert.equal(result.ok, false); assert.equal(result.safe_error_code, expectedCode); assert.equal(result.preview_submitted, false);
  }
});

test('runner neither mutates the artifact nor exposes product values in its public result', async () => {
  const input = artifact([{ upc: '00999999999993', modifier: '000', reason: 'Controlled.' }]); const before = JSON.stringify(input);
  const result = await runCommanderSelectedProductPreview({
    selectionArtifact: input,
    readSelectedProduct: async (identity) => ({ status: 'success', product: product(identity.upc, identity.modifier, { description: 'PRIVATE PRODUCT DESCRIPTION' }) }),
    submitPreview: async () => ({ status: 200, body: successBody(1, 1) }),
    clock: () => new Date('2026-07-31T15:00:00.000Z'),
  });
  assert.equal(JSON.stringify(input), before); assert.equal(JSON.stringify(result).includes('PRIVATE PRODUCT DESCRIPTION'), false);
  assert.deepEqual(Object.keys(result), ['ok','preview_only','catalog_complete','preview_submitted','selection_count','received_product_count','missing_selected_count','sync_run_id','created','safe_error_code']);
});
