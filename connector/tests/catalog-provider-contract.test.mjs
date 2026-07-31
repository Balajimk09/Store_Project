import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCatalogProviderProduct, validateCatalogProviderScope, validateCatalogProviderSnapshot } from '../lib/catalog-sync/catalog-provider-contract.mjs';

const scope = { store_id: 'store', connector_id: 'connector', source_system: 'fixture', source_store_number: 'source' };
const product = { source_product_key: 'plu:001|modifier:0', upc: '001', plu: '001', modifier: '0', description: 'Fixture', retail_price: 1.25, cost: null, department: null, category: null, tax: null, age_restriction: null, active: true, synchronization_state: 'source_observed' };

test('provider contract requires explicit identity scope and emits immutable StorePulse canonical products', () => {
  const normalized = normalizeCatalogProviderProduct(product); assert.equal(normalized.description, 'Fixture'); assert.equal(Object.isFrozen(normalized), true); assert.throws(() => { normalized.description = 'changed'; }, TypeError);
  assert.deepEqual(validateCatalogProviderScope(scope), scope); assert.throws(() => validateCatalogProviderScope({ ...scope, connector_id: '' }), /catalog_scope_invalid/);
  const source = [product]; const snapshot = validateCatalogProviderSnapshot({ status: 'complete_snapshot', scope, captured_at: '2026-07-22T00:00:00.000Z', products: source }, scope); source[0].description = 'caller changed'; assert.equal(snapshot.products[0].description, 'Fixture');
});

test('provider contract rejects missing fields, excess records, unsafe strings, and duplicate source keys', () => {
  assert.throws(() => normalizeCatalogProviderProduct({ ...product, extra: true }), /catalog_provider_invalid/);
  assert.throws(() => normalizeCatalogProviderProduct({ ...product, upc: 'abc' }), /catalog_provider_invalid/);
  assert.throws(() => validateCatalogProviderSnapshot({ status: 'complete_snapshot', scope, captured_at: 'bad', products: [] }, scope), /catalog_provider_invalid/);
  assert.throws(() => validateCatalogProviderSnapshot({ status: 'complete_snapshot', scope, captured_at: '2026-07-22T00:00:00.000Z', products: [product, product] }, scope), /duplicate_source_product_key/);
});

test('provider contract rejects normalized calendar timestamps and accepts strict UTC timestamps', () => {
  const snapshot = (captured_at) => ({ status: 'complete_snapshot', scope, captured_at, products: [] });
  for (const capturedAt of ['2026-02-29T00:00:00Z', '2026-02-30T00:00:00Z', '2026-04-31T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z']) {
    assert.throws(() => validateCatalogProviderSnapshot(snapshot(capturedAt), scope), /catalog_provider_invalid/);
  }
  for (const capturedAt of ['2024-02-29T12:34:56Z', '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.123Z']) {
    assert.equal(validateCatalogProviderSnapshot(snapshot(capturedAt), scope).captured_at, capturedAt);
  }
});
