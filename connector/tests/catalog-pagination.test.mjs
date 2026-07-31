import assert from 'node:assert/strict';
import test from 'node:test';
import { collectCatalogPages } from '../lib/catalog-sync/catalog-pagination.mjs';

const scope = { store_id: 'store', connector_id: 'connector', source_system: 'fixture', source_store_number: 'source' };

test('pagination returns a complete immutable accumulation without sorting provider arrays', async () => {
  const pages = [[{ id: 2 }], [{ id: 1 }]]; let calls = 0;
  const result = await collectCatalogPages({ scope, readPage: async ({ continuation }) => { const items = pages[calls++]; return continuation === null ? { items, reported_count: 1, response_bytes: 10, complete: false, continuation: 'opaque-next' } : { items, reported_count: 1, response_bytes: 10, complete: true, continuation: null }; } });
  assert.equal(result.status, 'complete_snapshot'); assert.deepEqual(result.products, [{ id: 2 }, { id: 1 }]); assert.deepEqual(pages[0], [{ id: 2 }]);
});

test('pagination fails closed for cycles, malformed pages, counts, bounds, and deadlines', async () => {
  const cases = [
    async () => ({ items: [], complete: false, continuation: 'same' }),
    async () => ({ items: [], complete: false, continuation: '' }),
    async () => ({ items: [], complete: true, continuation: 'unexpected' }),
    async () => ({ items: [], complete: false, continuation: 'next', reported_count: 1 }),
  ];
  for (const readPage of cases) assert.equal((await collectCatalogPages({ scope, readPage, limits: { maxPages: 2 } })).status, 'bounded_pagination_failure');
  let calls = 0; const cycle = await collectCatalogPages({ scope, readPage: async () => ({ items: [], complete: false, continuation: (++calls === 1 ? 'repeat' : 'repeat') }), limits: { maxPages: 3 } }); assert.equal(cycle.error_code, 'pagination_continuation_invalid');
  const overflow = await collectCatalogPages({ scope, readPage: async () => ({ items: [{}, {}], complete: true, continuation: null }), limits: { maxProducts: 1 } }); assert.equal(overflow.error_code, 'pagination_product_limit_exceeded');
  const deadline = await collectCatalogPages({ scope, now: (() => { let tick = 0; return () => (tick += 2); })(), limits: { maxDurationMs: 1 }, readPage: async () => ({ items: [], complete: true, continuation: null }) }); assert.equal(deadline.error_code, 'pagination_deadline_exceeded');
});

test('pagination bounds every provider failure without returning partial products', async () => {
  const cases = [
    { name: 'page limit', limits: { maxPages: 1 }, pages: [{ items: [{ id: 1 }], complete: false, continuation: 'A' }], code: 'pagination_page_limit_exceeded' },
    { name: 'response bytes', limits: { maxResponseBytes: 10 }, pages: [{ items: [], response_bytes: 11, complete: true, continuation: null }], code: 'pagination_response_too_large' },
    { name: 'continuation length', limits: { maxContinuationLength: 1 }, pages: [{ items: [], complete: false, continuation: 'AB' }], code: 'pagination_continuation_invalid' },
    { name: 'multi token cycle', limits: { maxPages: 4 }, pages: [{ items: [{ id: 1 }], complete: false, continuation: 'A' }, { items: [{ id: 2 }], complete: false, continuation: 'B' }, { items: [{ id: 3 }], complete: false, continuation: 'A' }], code: 'pagination_continuation_invalid' },
    { name: 'non array items', limits: {}, pages: [{ items: {}, complete: true, continuation: null }], code: 'pagination_page_invalid' },
  ];
  for (const scenario of cases) {
    let index = 0;
    const result = await collectCatalogPages({ scope, limits: scenario.limits, readPage: async () => scenario.pages[index++] });
    assert.equal(result.error_code, scenario.code, scenario.name);
    assert.deepEqual(result.products, [], scenario.name);
    assert.equal(result.complete, false, scenario.name);
  }
  for (const readPage of [() => { throw new Error('offline failure'); }, async () => Promise.reject(new Error('offline failure'))]) {
    const result = await collectCatalogPages({ scope, readPage });
    assert.equal(result.error_code, 'provider_unavailable');
    assert.deepEqual(result.products, []);
    assert.equal(result.complete, false);
  }
});
