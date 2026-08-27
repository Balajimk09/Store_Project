const PAGE_SIZES = Object.freeze([25, 50, 100]);
const DEFAULT_PAGE_SIZE = 50;
const MAX_QUERY_LENGTH = 160;
const MAX_FILTER_LENGTH = 120;
const POSTGRES_INTEGER_MAX = 2147483647;

export class CanonicalProductCatalogReadError extends Error {
  constructor(code = 'invalid_query') {
    super(code);
    this.name = 'CanonicalProductCatalogReadError';
    this.code = code;
  }
}

function requiredUuid(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(text)) {
    throw new CanonicalProductCatalogReadError();
  }
  return text;
}

function boundedOptionalText(value, maximum = MAX_FILTER_LENGTH) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  if (text.length > maximum) throw new CanonicalProductCatalogReadError();
  return text;
}

function positiveInteger(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (!/^\d+$/u.test(String(value))) throw new CanonicalProductCatalogReadError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new CanonicalProductCatalogReadError();
  return parsed;
}

function nonNegativeDecimal(value) {
  const text = boundedOptionalText(value, 32);
  if (text === null) return null;
  if (!/^\d+(?:\.\d+)?$/u.test(text)) throw new CanonicalProductCatalogReadError();
  return text;
}

function booleanQuery(value) {
  if (value === null || value === undefined || value === '') return false;
  if (value === 'true') return true;
  throw new CanonicalProductCatalogReadError();
}

function enumQuery(value, accepted, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (accepted.includes(value)) return value;
  throw new CanonicalProductCatalogReadError();
}

function parseCanonicalProductCatalogFilters(searchParams) {
  const minPrice = nonNegativeDecimal(searchParams.get('minPrice'));
  const maxPrice = nonNegativeDecimal(searchParams.get('maxPrice'));
  if (minPrice !== null && maxPrice !== null && Number(minPrice) > Number(maxPrice)) {
    throw new CanonicalProductCatalogReadError();
  }

  return {
    search: boundedOptionalText(searchParams.get('search'), MAX_QUERY_LENGTH),
    department: boundedOptionalText(searchParams.get('department')),
    vendor: boundedOptionalText(searchParams.get('vendor')),
    stock: enumQuery(searchParams.get('stock'), ['all', 'in_stock', 'reorder'], 'all'),
    minPrice,
    maxPrice,
    ebtOnly: booleanQuery(searchParams.get('ebtOnly')),
    ageRestrictedOnly: booleanQuery(searchParams.get('ageRestrictedOnly')),
    taxableOnly: booleanQuery(searchParams.get('taxableOnly')),
    active: enumQuery(searchParams.get('active'), ['all', 'active', 'inactive', 'unknown'], 'all'),
  };
}

export function parseCanonicalProductCatalogQuery(searchParams) {
  const allowed = new Set([
    'storeId', 'page', 'pageSize', 'search', 'department', 'vendor', 'stock', 'minPrice', 'maxPrice',
    'ebtOnly', 'ageRestrictedOnly', 'taxableOnly', 'active',
  ]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) throw new CanonicalProductCatalogReadError();
  }

  const page = positiveInteger(searchParams.get('page'), 1);
  const pageSize = positiveInteger(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE);
  if (!PAGE_SIZES.includes(pageSize)) throw new CanonicalProductCatalogReadError();
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset) || offset > POSTGRES_INTEGER_MAX) {
    throw new CanonicalProductCatalogReadError();
  }
  return {
    storeId: requiredUuid(searchParams.get('storeId')),
    page,
    pageSize,
    offset,
    ...parseCanonicalProductCatalogFilters(searchParams),
  };
}

export function canonicalProductPageCount(total, pageSize) {
  return Math.max(1, Math.ceil(Number(total || 0) / pageSize));
}

export function normalizeCanonicalProductRow(row) {
  return {
    id: String(row.id),
    upc: row.upc === null || row.upc === undefined ? '' : String(row.upc),
    item_name: row.item_name === null || row.item_name === undefined ? '' : String(row.item_name),
    category: row.category === null || row.category === undefined ? '' : String(row.category),
    department: row.department === null || row.department === undefined ? '' : String(row.department),
    sku: row.sku === null || row.sku === undefined ? null : String(row.sku),
    plu: row.plu === null || row.plu === undefined ? null : String(row.plu),
    product_code: row.product_code === null || row.product_code === undefined ? null : String(row.product_code),
    brand: row.brand === null || row.brand === undefined ? null : String(row.brand),
    cost_price: row.cost_price === null || row.cost_price === undefined ? null : String(row.cost_price),
    selling_price: row.selling_price === null || row.selling_price === undefined ? null : String(row.selling_price),
    stock: row.stock === null || row.stock === undefined ? null : String(row.stock),
    reorder_level: row.reorder_level === null || row.reorder_level === undefined ? null : String(row.reorder_level),
    vendor: row.vendor === null || row.vendor === undefined ? null : String(row.vendor),
    tax_rate: row.tax_rate === null || row.tax_rate === undefined ? null : String(row.tax_rate),
    tax_category: row.tax_category === null || row.tax_category === undefined ? null : String(row.tax_category),
    taxable: row.taxable === true,
    ebt_eligible: row.ebt_eligible === true,
    age_verification: row.age_verification === true,
    minimum_age: row.minimum_age === null || row.minimum_age === undefined ? null : Number(row.minimum_age),
    age_restriction_type: row.age_restriction_type === null || row.age_restriction_type === undefined ? null : String(row.age_restriction_type),
    is_active: row.is_active === true ? true : row.is_active === false ? false : null,
    notes: row.notes === null || row.notes === undefined ? null : String(row.notes),
    units_per_case: row.units_per_case === null || row.units_per_case === undefined ? null : String(row.units_per_case),
    cases_on_hand: row.cases_on_hand === null || row.cases_on_hand === undefined ? null : String(row.cases_on_hand),
    loose_units: row.loose_units === null || row.loose_units === undefined ? null : String(row.loose_units),
    commander_linked: row.commander_linked === true,
  };
}

export function normalizeCanonicalProductMetrics(row) {
  return {
    total_products: Number(row?.total_products || 0),
    commander_linked: Number(row?.commander_linked || 0),
    active_products: Number(row?.active_products || 0),
    inactive_products: Number(row?.inactive_products || 0),
    unknown_products: Number(row?.unknown_products || 0),
    low_stock_products: Number(row?.low_stock_products || 0),
  };
}

export function normalizeCanonicalProductFacets(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const list = (field) => Array.isArray(source[field])
    ? source[field].filter((item) => typeof item === 'string' && item.length > 0).slice(0, 500)
    : [];
  return { departments: list('departments'), vendors: list('vendors') };
}