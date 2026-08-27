import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CanonicalProductIdentityResolverError,
  canonicalProductIdentityResolverContract,
  parseCanonicalProductIdentityResolveRequest,
  resolveCanonicalProductIdentities,
} from '../lib/pos/canonical-product-identity-resolver.mjs';
import {
  doesCanonicalProductBarcodeResolutionBlockCreation,
  isCurrentCanonicalProductBarcodeResolution,
  normalizeCanonicalProductBarcode,
} from '../lib/pos/canonical-product-barcode-scan.mjs';

const STORE_ID = 'ec192877-0156-42ab-8fbf-31105f3e2ea3';
const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT_C = '33333333-3333-4333-8333-333333333333';
const PRODUCT_D = '44444444-4444-4444-8444-444444444444';
const routePath = new URL('../app/api/products/resolve-identities/route.ts', import.meta.url);
const pagePath = new URL('../app/(store)/app/products/page.tsx', import.meta.url);
const invoicesPagePath = new URL('../app/(store)/app/invoices/page.tsx', import.meta.url);
const productFormPath = new URL('../components/products/ProductForm.tsx', import.meta.url);

function identity(overrides = {}) {
  return {
    clientKey: 'line-1',
    upc: '00024300834714',
    plu: null,
    productCode: null,
    name: '$1 CANDY',
    ...overrides,
  };
}

function product(id, overrides = {}) {
  return {
    id,
    upc: null,
    plu: null,
    product_code: null,
    item_name: 'Canonical Product',
    department: 'Grocery',
    selling_price: '8.625',
    is_active: true,
    ...overrides,
  };
}

test('identity resolver request is bounded, strict, and preserves string identifiers', () => {
  const request = parseCanonicalProductIdentityResolveRequest({
    storeId: STORE_ID,
    identities: [identity()],
  });
  assert.equal(request.storeId, STORE_ID);
  assert.equal(request.identities[0].upc, '00024300834714');
  assert.equal(request.identities[0].plu, null);
  assert.equal(canonicalProductIdentityResolverContract.maxIdentities, 100);
  assert.throws(() => parseCanonicalProductIdentityResolveRequest({
    storeId: STORE_ID,
    identities: [identity(), identity({ clientKey: 'line-1' })],
  }), CanonicalProductIdentityResolverError);
  assert.throws(() => parseCanonicalProductIdentityResolveRequest({
    storeId: STORE_ID,
    identities: [identity({ extra: 'nope' })],
  }), CanonicalProductIdentityResolverError);
  assert.throws(() => parseCanonicalProductIdentityResolveRequest({
    storeId: STORE_ID,
    identities: Array.from({ length: 101 }, (_, index) => identity({ clientKey: `line-${index}` })),
  }), CanonicalProductIdentityResolverError);
  assert.throws(() => parseCanonicalProductIdentityResolveRequest({
    storeId: STORE_ID,
    identities: [identity({ upc: 24300834714 })],
  }), CanonicalProductIdentityResolverError);
});

test('exact UPC, PLU, and product code resolve without any browser catalog cache', () => {
  const identities = parseCanonicalProductIdentityResolveRequest({
    storeId: STORE_ID,
    identities: [
      identity({ clientKey: 'outside-first-1000', upc: '00024300834714' }),
      identity({ clientKey: 'plu', upc: null, plu: '0007', name: null }),
      identity({ clientKey: 'product-code', upc: null, productCode: 'SKU-001', name: null }),
    ],
  }).identities;
  const resolutions = resolveCanonicalProductIdentities(identities, [
    product(PRODUCT_A, { upc: '00024300834714' }),
    product(PRODUCT_B, { plu: '0007' }),
    product(PRODUCT_C, { product_code: 'SKU-001' }),
  ]);
  assert.deepEqual(resolutions.map((result) => result.status), ['MATCHED', 'MATCHED', 'MATCHED']);
  assert.equal(resolutions[0].product.id, PRODUCT_A);
  assert.equal(resolutions[0].product.upc, '00024300834714');
  assert.equal(resolutions[1].product.plu, '0007');
  assert.equal(resolutions[2].product.productCode, 'SKU-001');
});

test('conflicting or duplicate exact identifiers are ambiguous and name is never a fallback', () => {
  const conflicting = parseCanonicalProductIdentityResolveRequest({
    storeId: STORE_ID,
    identities: [identity({ upc: '00024300834714', plu: '0007' })],
  }).identities;
  const duplicate = parseCanonicalProductIdentityResolveRequest({
    storeId: STORE_ID,
    identities: [identity({ upc: null, plu: 'DUPLICATE', name: null })],
  }).identities;
  const nameOnly = parseCanonicalProductIdentityResolveRequest({
    storeId: STORE_ID,
    identities: [identity({ upc: null, plu: null, productCode: null, name: 'Canonical Product' })],
  }).identities;
  const candidates = [
    product(PRODUCT_A, { upc: '00024300834714' }),
    product(PRODUCT_B, { plu: '0007' }),
    product(PRODUCT_C, { plu: 'DUPLICATE' }),
    product(PRODUCT_D, { plu: 'DUPLICATE' }),
  ];
  const [conflictResult] = resolveCanonicalProductIdentities(conflicting, candidates);
  const [duplicateResult] = resolveCanonicalProductIdentities(duplicate, candidates);
  const [nameResult] = resolveCanonicalProductIdentities(nameOnly, candidates);
  assert.equal(conflictResult.status, 'AMBIGUOUS');
  assert.equal(conflictResult.candidates.length, 2);
  assert.equal(duplicateResult.status, 'AMBIGUOUS');
  assert.equal(duplicateResult.candidates.length, 2);
  assert.equal(nameResult.status, 'NOT_FOUND');
});

test('ambiguous candidate output is bounded and missing identifiers return NOT_FOUND', () => {
  const identities = parseCanonicalProductIdentityResolveRequest({
    storeId: STORE_ID,
    identities: [identity({ upc: null, plu: 'DUPLICATE', name: null }), identity({ clientKey: 'missing', upc: '00000000000017' })],
  }).identities;
  const candidates = [PRODUCT_A, PRODUCT_B, PRODUCT_C, PRODUCT_D].map((id) => product(id, { plu: 'DUPLICATE' }));
  const [ambiguous, missing] = resolveCanonicalProductIdentities(identities, candidates);
  assert.equal(ambiguous.status, 'AMBIGUOUS');
  assert.equal(ambiguous.candidates.length, 3);
  assert.equal(missing.status, 'NOT_FOUND');
  assert.deepEqual(missing.candidates, []);
});

test('identity resolver route is authenticated, store-scoped, bounded, and read-only', async () => {
  const route = await readFile(routePath, 'utf8');
  assert.match(route, /routeClient\.auth\.getUser\(\)/u);
  assert.match(route, /readBoundedCanonicalProductIdentityResolveJson\(request\)/u);
  assert.match(route, /\.from\('stores'\)[\s\S]*?\.eq\('id', requestBody\.storeId\)/u);
  assert.match(route, /\.from\('products'\)\.select\(PRODUCT_IDENTITY_COLUMNS\)\.eq\('store_id', requestBody\.storeId\)\.in\('upc', values\.upcs\)\.limit\(100\)/u);
  assert.match(route, /\.in\('plu', values\.plus\)/u);
  assert.match(route, /\.in\('product_code', values\.productCodes\)/u);
  assert.match(route, /id, upc, plu, product_code, item_name, department, selling_price, is_active/u);
  assert.doesNotMatch(route, /getSupabaseAdmin|SUPABASE_SERVICE_ROLE_KEY|\.insert\(|\.update\(|\.upsert\(|\.delete\(|commander|uPLUs|pos_publish_jobs/iu);
});



test('barcode scan state preserves leading zeroes and permits creation only after a current NOT_FOUND result', () => {
  const upc = normalizeCanonicalProductBarcode(' 00000000000017 ');
  assert.equal(upc, '00000000000017');
  assert.equal(doesCanonicalProductBarcodeResolutionBlockCreation({ status: 'idle', upc: '' }, upc), true);
  assert.equal(doesCanonicalProductBarcodeResolutionBlockCreation({ status: 'matched', upc }, upc), true);
  assert.equal(doesCanonicalProductBarcodeResolutionBlockCreation({ status: 'ambiguous', upc }, upc), true);
  assert.equal(doesCanonicalProductBarcodeResolutionBlockCreation({ status: 'error', upc }, upc), true);
  assert.equal(doesCanonicalProductBarcodeResolutionBlockCreation({ status: 'not_found', upc: '00000000000018' }, upc), true);
  assert.equal(doesCanonicalProductBarcodeResolutionBlockCreation({ status: 'not_found', upc }, upc), false);
  assert.equal(doesCanonicalProductBarcodeResolutionBlockCreation({ status: 'not_found', upc }, ''), false);
  assert.equal(isCurrentCanonicalProductBarcodeResolution({ status: 'not_found', upc }, upc), true);
});

test('Add Product UPC supports HID Enter resolution and contains no device APIs or UPC coercion', async () => {
  const [page, form] = await Promise.all([
    readFile(pagePath, 'utf8'),
    readFile(productFormPath, 'utf8'),
  ]);
  assert.match(form, /event\.key !== 'Enter'/u);
  assert.match(form, /event\.preventDefault\(\)/u);
  assert.match(form, /onUpcEnter\?\.\(event\.currentTarget\.value\)/u);
  assert.match(form, /Ready to scan barcode or enter UPC manually\./u);
  assert.match(page, /resolveAddProductBarcode\(value\)/u);
  assert.match(page, /doesCanonicalProductBarcodeResolutionBlockCreation\(addProductBarcodeResolution, upc\)/u);
  assert.match(page, /status: 'matched'/u);
  assert.match(page, /status: 'ambiguous'/u);
  assert.match(page, /status: 'not_found'/u);
  assert.match(page, /status: 'error'/u);
  assert.match(page, /productCode: null/u);
  assert.match(page, /plu: null/u);
  assert.doesNotMatch(`${page}\n${form}`, /Number\(form\.upc\)|parseInt\(form\.upc\)|\+form\.upc/u);
  assert.doesNotMatch(`${page}\n${form}`, /navigator\.mediaDevices|BarcodeDetector|WebHID|WebUSB|ZXing|Quagga/iu);
  const barcodeFlowStart = form.indexOf('const handleUpcKeyDown')
  const barcodeFlowEnd = form.indexOf('  return (', barcodeFlowStart)

  assert.ok(
    barcodeFlowStart >= 0,
    'Add Product barcode Enter handler must exist',
  )

  assert.ok(
    barcodeFlowEnd > barcodeFlowStart,
    'Add Product barcode flow must have a bounded source section',
  )

  const addProductBarcodeFlow = form.slice(
    barcodeFlowStart,
    barcodeFlowEnd,
  )

  assert.doesNotMatch(
    addProductBarcodeFlow,
    /commander|uPLUs|pos_publish_jobs/iu,
    'Add Product barcode resolution must remain isolated from Commander publishing',
  );
});
