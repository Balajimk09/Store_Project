const MAX_PRODUCTS = 5_000;
const MAX_TEXT = 512;
const MAX_SCOPE_TEXT = 128;
const SCOPE_KEYS = Object.freeze(['store_id', 'connector_id', 'source_system', 'source_store_number']);
const PRODUCT_KEYS = Object.freeze(['source_product_key', 'upc', 'plu', 'modifier', 'description', 'retail_price', 'cost', 'department', 'category', 'tax', 'age_restriction', 'active', 'synchronization_state']);
const SAFE_TEXT = /^[A-Za-z0-9._:|+\- ]+$/;

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function text(value, max = MAX_TEXT, required = false) {
  if (value === null || value === undefined) { if (required) fail('catalog_provider_invalid'); return null; }
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail('catalog_provider_invalid');
  return value;
}
function money(value) { if (value === null || value === undefined) return null; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Math.abs(Math.round(value * 100) - (value * 100)) > 1e-8) fail('catalog_provider_invalid'); return value; }

export function isValidCatalogTimestamp(value) {
  if (typeof value !== 'string' || value.length > 40) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText = '', zone, sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const hour = Number(hourText); const minute = Number(minuteText); const second = Number(secondText);
  const milliseconds = Number((fractionText || '').padEnd(3, '0'));
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== 'Z' && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false;
  const localMilliseconds = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  const local = new Date(localMilliseconds);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second || local.getUTCMilliseconds() !== milliseconds) return false;
  const offsetMinutes = zone === 'Z' ? 0 : (Number(offsetHourText) * 60 + Number(offsetMinuteText)) * (sign === '+' ? 1 : -1);
  const instant = new Date(localMilliseconds - offsetMinutes * 60_000);
  if (!Number.isFinite(instant.getTime())) return false;
  const roundTrip = new Date(instant.getTime() + offsetMinutes * 60_000);
  return roundTrip.getUTCFullYear() === year && roundTrip.getUTCMonth() === month - 1 && roundTrip.getUTCDate() === day && roundTrip.getUTCHours() === hour && roundTrip.getUTCMinutes() === minute && roundTrip.getUTCSeconds() === second && roundTrip.getUTCMilliseconds() === milliseconds;
}

export function validateCatalogProviderScope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== SCOPE_KEYS.length || SCOPE_KEYS.some((key) => !Object.hasOwn(value, key))) fail('catalog_scope_invalid');
  const scope = {};
  for (const key of SCOPE_KEYS) {
    const item = value[key];
    if (typeof item !== 'string' || item.length < 1 || item.trim().length < 1 || item.length > MAX_SCOPE_TEXT || !SAFE_TEXT.test(item)) fail('catalog_scope_invalid');
    scope[key] = item;
  }
  return Object.freeze(scope);
}

export function sameCatalogProviderScope(left, right) {
  return SCOPE_KEYS.every((key) => left?.[key] === right?.[key]);
}

export function normalizeCatalogProviderProduct(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== PRODUCT_KEYS.length || PRODUCT_KEYS.some((key) => !Object.hasOwn(value, key))) fail('catalog_provider_invalid');
  const product = {
    source_product_key: text(value.source_product_key, 160, true),
    upc: text(value.upc, 32), plu: text(value.plu, 64), modifier: text(value.modifier, 32),
    description: text(value.description, MAX_TEXT, true), retail_price: money(value.retail_price), cost: money(value.cost),
    department: text(value.department, 128), category: text(value.category, 128), tax: text(value.tax, 128), age_restriction: text(value.age_restriction, 128),
    active: value.active === null || value.active === undefined ? null : value.active,
    synchronization_state: text(value.synchronization_state, 64, true),
  };
  if (product.upc !== null && !/^\d{1,32}$/.test(product.upc)) fail('catalog_provider_invalid');
  if (product.active !== null && typeof product.active !== 'boolean') fail('catalog_provider_invalid');
  return Object.freeze(product);
}

export function validateCatalogProviderSnapshot(value, expectedScope) {
  const scope = validateCatalogProviderScope(value?.scope);
  if (!sameCatalogProviderScope(scope, expectedScope) || !['complete_snapshot', 'incomplete_snapshot'].includes(value?.status) || !isValidCatalogTimestamp(value?.captured_at) || !Array.isArray(value.products) || value.products.length > MAX_PRODUCTS || Object.keys(value).some((key) => !['status', 'scope', 'captured_at', 'products'].includes(key))) fail('catalog_provider_invalid');
  const products = value.products.map(normalizeCatalogProviderProduct);
  const keys = new Set(); for (const product of products) { if (keys.has(product.source_product_key)) fail('duplicate_source_product_key'); keys.add(product.source_product_key); }
  return Object.freeze({ status: value.status, scope, captured_at: value.captured_at, products: Object.freeze(products) });
}

export const CATALOG_PROVIDER_LIMITS = Object.freeze({ maxProducts: MAX_PRODUCTS, maxText: MAX_TEXT, maxScopeText: MAX_SCOPE_TEXT });
