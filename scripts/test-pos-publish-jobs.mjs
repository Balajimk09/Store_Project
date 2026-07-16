import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POS_PUBLISH_OPERATION,
  PosPublishJobError,
  assertJobStatusTransition,
  assertStoreJobAuthorization,
  canInspectPosPublishJobs,
  resolveIdempotency,
  validateIdempotencyKey,
  validateUpdatePricePayload,
} from '../lib/pos-publish-jobs-core.mjs';

const jobInput = { storeId: 'store-1', productId: 'product-1' };

test('authorizes only the store owner to enqueue a publishing job', () => {
  assert.doesNotThrow(() => assertStoreJobAuthorization('owner-1', 'owner-1'));
  assert.throws(() => assertStoreJobAuthorization('other-user', 'owner-1'), PosPublishJobError);
});

test('authorizes only connector or store-view admins to inspect publishing jobs', () => {
  assert.equal(canInspectPosPublishJobs({ isSuperadmin: true, permissions: [] }), true);
  assert.equal(canInspectPosPublishJobs({ isSuperadmin: false, permissions: ['connectors.view'] }), true);
  assert.equal(canInspectPosPublishJobs({ isSuperadmin: false, permissions: ['stores.view'] }), true);
  assert.equal(canInspectPosPublishJobs({ isSuperadmin: false, permissions: ['products.view'] }), false);
});

test('validates a price-only update_price payload', () => {
  assert.deepEqual(validateUpdatePricePayload({ price: '1.20' }), { price: '1.20' });
  assert.throws(() => validateUpdatePricePayload({ price: '0' }), PosPublishJobError);
  assert.throws(() => validateUpdatePricePayload({ price: '1.001' }), PosPublishJobError);
  assert.throws(() => validateUpdatePricePayload({ price: '1.20', xml: '<unsafe />' }), PosPublishJobError);
  assert.throws(() => validateIdempotencyKey('short'), PosPublishJobError);
});

test('returns the existing job for a duplicate idempotency key in the same scope', () => {
  const existing = { store_id: 'store-1', product_id: 'product-1', operation: POS_PUBLISH_OPERATION, id: 'job-1' };
  assert.equal(resolveIdempotency(existing, jobInput), existing);
});

test('rejects an idempotency key already reserved for a different job', () => {
  const existing = { store_id: 'store-2', product_id: 'product-1', operation: POS_PUBLISH_OPERATION, id: 'job-1' };
  assert.throws(() => resolveIdempotency(existing, jobInput), PosPublishJobError);
});

test('enforces claim and terminal status transitions', () => {
  assert.doesNotThrow(() => assertJobStatusTransition('pending', 'claimed', 'connector-1', 'connector-1'));
  assert.throws(() => assertJobStatusTransition('pending', 'claimed', 'connector-1', 'connector-2'), PosPublishJobError);
  assert.doesNotThrow(() => assertJobStatusTransition('claimed', 'sending', 'connector-1', 'connector-1'));
  assert.doesNotThrow(() => assertJobStatusTransition('sending', 'verifying', 'connector-1', 'connector-1'));
  assert.doesNotThrow(() => assertJobStatusTransition('verifying', 'completed', 'connector-1', 'connector-1'));
  assert.doesNotThrow(() => assertJobStatusTransition('verifying', 'failed', 'connector-1', 'connector-1'));
  assert.throws(() => assertJobStatusTransition('completed', 'pending', 'connector-1', 'connector-1'), PosPublishJobError);
});
