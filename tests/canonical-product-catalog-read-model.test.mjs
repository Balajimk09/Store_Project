import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CanonicalProductCatalogReadError,
  canonicalProductPageCount,
  parseCanonicalProductCatalogQuery,
} from '../lib/pos/canonical-product-catalog-read-model.mjs';

const migrationPath = new URL('../supabase/migrations/20260811190932_add_canonical_product_catalog_read_rpc.sql', import.meta.url);
const routePath = new URL('../app/api/products/catalog/route.ts', import.meta.url);
const productsPagePath = new URL('../app/(store)/app/products/page.tsx', import.meta.url);

const storeId = '11111111-1111-4111-8111-111111111111';

test('canonical Products query is bounded and can request beyond a default first page', () => {
  const query = parseCanonicalProductCatalogQuery(new URLSearchParams({
    storeId,
    page: '21',
    pageSize: '50',
  }));

  assert.equal(query.offset, 1000);
  assert.equal(query.pageSize, 50);
  assert.equal(canonicalProductPageCount(1001, 50), 21);
  assert.throws(
    () => parseCanonicalProductCatalogQuery(new URLSearchParams({ storeId, pageSize: '1000' })),
    CanonicalProductCatalogReadError,
  );
});

test('canonical Products search preserves leading-zero UPC input and accepts bounded page sizes', () => {
  const query = parseCanonicalProductCatalogQuery(new URLSearchParams({
    storeId,
    page: '2',
    pageSize: '25',
    search: '00999999999992',
  }));

  assert.equal(query.search, '00999999999992');
  assert.equal(query.offset, 25);
});

test('catalog RPC searches UPC, PLU, product code, and name before deterministic pagination', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /concat_ws\(' ', product\.item_name, product\.upc, product\.plu, product\.product_code, product\.sku\)/u);
  assert.match(sql, /order by lower\(coalesce\(filtered\.item_name, ''\)\), filtered\.id\s+offset \(select effective_offset from request_bounds\)\s+limit \(select effective_limit from request_bounds\)/u);
  assert.match(sql, /when p_limit > 100 then 100/u);
  assert.ok(sql.indexOf('from filtered') < sql.indexOf('offset (select effective_offset from request_bounds)'));
});

test('catalog route authenticates, scopes to the requested store, and invokes the paginated RPCs', async () => {
  const source = await readFile(routePath, 'utf8');

  assert.match(source, /routeClient\.auth\.getUser\(\)/u);
  assert.match(source, /from\('stores'\)\s*\.select\('id'\)\s*\.eq\('id', query\.storeId\)\s*\.maybeSingle\(\)/u);
  assert.match(source, /rpc\('read_store_canonical_product_catalog'/u);
  assert.match(source, /rpc\('count_store_canonical_product_catalog'/u);
  assert.match(source, /pagination: \{[\s\S]*page_size: query\.pageSize/u);
});

test('Products page reads the canonical server page and refreshes it after a successful local create', async () => {
  const source = await readFile(productsPagePath, 'utf8');

  assert.match(source, /fetch\(`\/api\/products\/catalog\?\$\{params\.toString\(\)\}`\)/u);
  assert.match(source, /if \(activeStoreId\) return canonicalCatalogProducts;/u);
  assert.match(source, /const result = modalMode === 'add'[\s\S]*?await createProduct\(productToSave\)/u);
  assert.match(source, /setCanonicalCatalogRefresh\(\(current\) => current \+ 1\);/u);
  assert.match(source, /setCanonicalCatalogPage\(\(page\) => page \+ 1\)/u);
});