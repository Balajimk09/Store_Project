import { createHash } from 'node:crypto';

import {
  COMMANDER_SOURCE_SYSTEM,
  MAX_SELECTED_PRODUCTS,
  normalizeCatalogPilotProduct,
  stableCatalogValue,
  validateSelectedProductSet,
} from '../../../lib/pos/catalog-pilot-contract.mjs';

export const SELECTED_PREVIEW_ENDPOINT_PATH = '/api/connectors/catalog-pilot/preview';
export const SELECTED_PREVIEW_MAX_BODY_BYTES = 64 * 1024;
export const SELECTED_PREVIEW_MAX_ARTIFACT_BYTES = 32 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_STORE_NUMBER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const STRICT_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const ARTIFACT_KEYS = Object.freeze(['schema_version', 'mode', 'store', 'safety', 'products']);
const STORE_KEYS = Object.freeze(['store_id', 'owner_id', 'store_name', 'source_system', 'source_store_number']);
const SAFETY_KEYS = Object.freeze(['read_only', 'automatic_publishing_enabled', 'retain_raw_xml', 'retain_credentials_or_cookies', 'max_selected_products']);
const SELECTED_PRODUCT_KEYS = Object.freeze(['upc', 'modifier', 'reason']);

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function safeText(value, maximum) {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
function strictCapturedAt(value) {
  if (value instanceof Date) { if (!Number.isFinite(value.getTime())) fail('capture_time_invalid'); return value.toISOString(); }
  if (typeof value !== 'string' || !STRICT_UTC_TIMESTAMP.test(value)) fail('capture_time_invalid');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail('capture_time_invalid');
  return value;
}
function nullableText(value) { return value === undefined ? null : value; }
function nullableMoney(value) {
  if (value === null || value === undefined) return null;
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) fail('commander_product_invalid');
  return amount;
}
function safeFailure(code, selectionCount = 0, receivedProductCount = 0) {
  return Object.freeze({
    ok: false, preview_only: true, catalog_complete: false, preview_submitted: false,
    selection_count: selectionCount, received_product_count: receivedProductCount,
    missing_selected_count: Math.max(0, selectionCount - receivedProductCount), safe_error_code: code,
  });
}
function validateServerSuccess(value, expectedSelectionCount, expectedReceivedCount) {
  if (!isRecord(value) || value.ok !== true || typeof value.syncRunId !== 'string' || !UUID.test(value.syncRunId)
    || typeof value.created !== 'boolean' || value.mode !== 'selected_products' || value.catalogComplete !== false
    || value.previewOnly !== true || value.selectionCount !== expectedSelectionCount || value.receivedProductCount !== expectedReceivedCount) {
    fail('preview_response_invalid');
  }
  return Object.freeze({ syncRunId: value.syncRunId.toLowerCase(), created: value.created });
}

export function parseCommanderSelectedProductsArtifact(text) {
  if (typeof text !== 'string' || text.length < 1 || Buffer.byteLength(text, 'utf8') > SELECTED_PREVIEW_MAX_ARTIFACT_BYTES) fail('selection_artifact_invalid');
  let value; try { value = JSON.parse(text); } catch { fail('selection_artifact_invalid'); }
  return validateCommanderSelectedProductsArtifact(value);
}

export function validateCommanderSelectedProductsArtifact(value) {
  if (!hasExactKeys(value, ARTIFACT_KEYS) || value.schema_version !== '1' || value.mode !== 'selected_products'
    || !hasExactKeys(value.store, STORE_KEYS) || !hasExactKeys(value.safety, SAFETY_KEYS) || !Array.isArray(value.products)) fail('selection_artifact_invalid');
  const store = value.store;
  if (!UUID.test(store.store_id) || !UUID.test(store.owner_id) || !safeText(store.store_name, 128)
    || store.source_system !== COMMANDER_SOURCE_SYSTEM || typeof store.source_store_number !== 'string' || !SOURCE_STORE_NUMBER.test(store.source_store_number)) fail('selection_artifact_invalid');
  const safety = value.safety;
  if (safety.read_only !== true || safety.automatic_publishing_enabled !== false || safety.retain_raw_xml !== false
    || safety.retain_credentials_or_cookies !== false || safety.max_selected_products !== MAX_SELECTED_PRODUCTS) fail('selection_artifact_invalid');
  if (value.products.length < 1 || value.products.length > MAX_SELECTED_PRODUCTS) fail('selection_artifact_invalid');
  const selectedProducts = value.products.map((product) => {
    if (!hasExactKeys(product, SELECTED_PRODUCT_KEYS) || !safeText(product.reason, 512)) fail('selection_artifact_invalid');
    return { upc: product.upc, modifier: product.modifier };
  });
  let normalizedSelection; try { normalizedSelection = validateSelectedProductSet(selectedProducts); } catch { fail('selection_artifact_invalid'); }
  return Object.freeze({
    schemaVersion: '1', mode: 'selected_products',
    store: Object.freeze({ storeId: store.store_id.toLowerCase(), ownerId: store.owner_id.toLowerCase(), storeName: store.store_name, sourceSystem: COMMANDER_SOURCE_SYSTEM, sourceStoreNumber: store.source_store_number }),
    selectedProducts: Object.freeze(normalizedSelection.map(({ upc, modifier, sourceProductKey }) => Object.freeze({ upc, modifier, sourceProductKey }))),
  });
}

export function createSelectedProductPreviewIdempotencyKey({ sourceStoreNumber, capturedAt, selectedProducts }) {
  if (typeof sourceStoreNumber !== 'string' || !SOURCE_STORE_NUMBER.test(sourceStoreNumber)) fail('idempotency_input_invalid');
  const normalizedCapturedAt = strictCapturedAt(capturedAt);
  let selection; try { selection = validateSelectedProductSet(selectedProducts.map(({ upc, modifier }) => ({ upc, modifier }))); } catch { fail('idempotency_input_invalid'); }
  const digest = createHash('sha256').update(stableCatalogValue({ version: 'commander-selected-preview:v1', sourceStoreNumber, capturedAt: normalizedCapturedAt, selectedProducts: selection }), 'utf8').digest('hex');
  return `catalog-preview:${digest}`;
}

export function normalizeCommanderProductForPreview({ sourceStoreNumber, selectedIdentity, product }) {
  if (typeof sourceStoreNumber !== 'string' || !SOURCE_STORE_NUMBER.test(sourceStoreNumber) || !isRecord(selectedIdentity) || !isRecord(product)
    || product.upc !== selectedIdentity.upc || product.modifier !== selectedIdentity.modifier || typeof product.raw_payload_hash !== 'string' || !SHA256.test(product.raw_payload_hash)) fail('commander_product_invalid');
  let normalized;
  try {
    normalized = normalizeCatalogPilotProduct({
      sourceSystem: COMMANDER_SOURCE_SYSTEM, sourceStoreNumber, sourceProductKey: selectedIdentity.sourceProductKey,
      upc: product.upc, modifier: product.modifier, description: product.description,
      retailPrice: nullableMoney(product.retail_price), cost: nullableMoney(product.cost),
      departmentNumber: nullableText(product.department_number), departmentName: nullableText(product.department_name),
      categoryNumber: nullableText(product.category_number), categoryName: nullableText(product.category_name),
      taxNumber: nullableText(product.tax_number), taxName: nullableText(product.tax_name),
      ageRestriction: nullableText(product.age_restriction), active: product.active ?? null, payloadHash: product.raw_payload_hash,
    });
  } catch { fail('commander_product_invalid'); }
  return normalized;
}

export async function runCommanderSelectedProductPreview({ selectionArtifact, readSelectedProduct, submitPreview, clock = () => new Date() } = {}) {
  let selection;
  try { selection = typeof selectionArtifact === 'string' ? parseCommanderSelectedProductsArtifact(selectionArtifact) : validateCommanderSelectedProductsArtifact(selectionArtifact); }
  catch { return safeFailure('selection_artifact_invalid'); }
  const selectionCount = selection.selectedProducts.length;
  if (typeof readSelectedProduct !== 'function' || typeof submitPreview !== 'function') return safeFailure('runner_dependency_invalid', selectionCount);
  const products = [];
  for (const selectedIdentity of selection.selectedProducts) {
    let read;
    try { read = await readSelectedProduct(Object.freeze({ upc: selectedIdentity.upc, modifier: selectedIdentity.modifier })); }
    catch { return safeFailure('commander_read_failed', selectionCount, products.length); }
    if (!isRecord(read) || typeof read.status !== 'string') return safeFailure('commander_read_failed', selectionCount, products.length);
    if (read.status === 'product_not_found') continue;
    if (read.status === 'commander_tls_hostname_invalid' || read.status === 'commander_tls_peer_mismatch') return safeFailure(read.status, selectionCount, products.length);
    if (read.status === 'session_failed') return safeFailure('commander_authentication_failed', selectionCount, products.length);
    if (read.status !== 'success') return safeFailure('commander_read_failed', selectionCount, products.length);
    try { products.push(normalizeCommanderProductForPreview({ sourceStoreNumber: selection.store.sourceStoreNumber, selectedIdentity, product: read.product })); }
    catch { return safeFailure('commander_product_invalid', selectionCount, products.length); }
  }
  let capturedAt; try { capturedAt = strictCapturedAt(clock()); } catch { return safeFailure('capture_time_invalid', selectionCount, products.length); }
  let idempotencyKey;
  try { idempotencyKey = createSelectedProductPreviewIdempotencyKey({ sourceStoreNumber: selection.store.sourceStoreNumber, capturedAt, selectedProducts: selection.selectedProducts }); }
  catch { return safeFailure('idempotency_input_invalid', selectionCount, products.length); }
  const body = Object.freeze({
    schemaVersion: '1', mode: 'selected_products', sourceSystem: COMMANDER_SOURCE_SYSTEM,
    sourceStoreNumber: selection.store.sourceStoreNumber, capturedAt,
    selectedProducts: Object.freeze(selection.selectedProducts.map(({ upc, modifier }) => Object.freeze({ upc, modifier }))),
    products: Object.freeze(products),
  });
  let serialized; try { serialized = JSON.stringify(body); } catch { return safeFailure('preview_request_invalid', selectionCount, products.length); }
  if (Buffer.byteLength(serialized, 'utf8') > SELECTED_PREVIEW_MAX_BODY_BYTES || /(?:_write_template|sessionCookie|session_cookie|raw_xml|<domain:PLU)/i.test(serialized)) return safeFailure('preview_request_invalid', selectionCount, products.length);
  let response;
  try { response = await submitPreview(Object.freeze({ endpointPath: SELECTED_PREVIEW_ENDPOINT_PATH, method: 'POST', idempotencyKey, body })); }
  catch { return safeFailure('preview_submission_failed', selectionCount, products.length); }
  if (!isRecord(response) || !Number.isInteger(response.status)) return safeFailure('preview_submission_failed', selectionCount, products.length);
  if (response.status === 401 || response.status === 403) return safeFailure('preview_unauthorized', selectionCount, products.length);
  if (response.status === 409) return safeFailure('preview_idempotency_conflict', selectionCount, products.length);
  if (response.status < 200 || response.status >= 300) return safeFailure('preview_submission_failed', selectionCount, products.length);
  let server; try { server = validateServerSuccess(response.body, selectionCount, products.length); } catch { return safeFailure('preview_response_invalid', selectionCount, products.length); }
  return Object.freeze({
    ok: true, preview_only: true, catalog_complete: false, preview_submitted: true,
    selection_count: selectionCount, received_product_count: products.length,
    missing_selected_count: selectionCount - products.length, sync_run_id: server.syncRunId,
    created: server.created, safe_error_code: null,
  });
}
