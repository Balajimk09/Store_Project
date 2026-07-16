export const POS_PUBLISH_OPERATION = 'update_price';
export const POS_PUBLISH_STATUSES = ['pending', 'claimed', 'sending', 'verifying', 'completed', 'failed', 'cancelled'];

export class PosPublishJobError extends Error {}

function fail(message) {
  throw new PosPublishJobError(message);
}

export function validatePositiveTwoDecimalPrice(value) {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) fail('Price must be a positive amount with no more than two decimal places.');
  const price = Number(text);
  if (!Number.isFinite(price) || price <= 0) fail('Price must be greater than zero.');
  return price.toFixed(2);
}

export function validateUpdatePricePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('A price-only payload is required.');
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== 'price') fail('Only the price field is allowed in an update_price payload.');
  return { price: validatePositiveTwoDecimalPrice(payload.price) };
}

export function validateIdempotencyKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(key)) {
    fail('Idempotency key must be 16 to 128 URL-safe characters.');
  }
  return key;
}

export function assertStoreJobAuthorization(actorUserId, storeOwnerId) {
  if (!actorUserId || !storeOwnerId || actorUserId !== storeOwnerId) {
    fail('You are not authorized to create publishing jobs for this store.');
  }
}

export function canInspectPosPublishJobs(access) {
  return Boolean(access?.isSuperadmin || access?.permissions?.includes('connectors.view') || access?.permissions?.includes('stores.view'));
}

export function resolveIdempotency(existingJob, input) {
  if (!existingJob) return null;
  if (
    existingJob.store_id === input.storeId
    && existingJob.product_id === input.productId
    && existingJob.operation === POS_PUBLISH_OPERATION
  ) {
    return existingJob;
  }
  fail('Idempotency key is already reserved for a different publishing job.');
}

export function assertJobStatusTransition(fromStatus, toStatus, assignedConnectorId, claimedByConnectorId) {
  if (!POS_PUBLISH_STATUSES.includes(fromStatus) || !POS_PUBLISH_STATUSES.includes(toStatus)) {
    fail('Unsupported publishing job status.');
  }
  if (fromStatus === toStatus) return;
  const allowed = {
    pending: ['claimed', 'cancelled'],
    claimed: ['pending', 'sending', 'failed'],
    sending: ['verifying', 'failed'],
    verifying: ['completed', 'failed'],
    completed: [],
    failed: [],
    cancelled: [],
  };
  if (!allowed[fromStatus].includes(toStatus)) fail('Publishing job status transition is not allowed.');
  if (toStatus === 'claimed' && (!assignedConnectorId || assignedConnectorId !== claimedByConnectorId)) {
    fail('Only the assigned connector may claim a publishing job.');
  }
}
