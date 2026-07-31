import { validateCatalogProviderScope } from './catalog-provider-contract.mjs';

const DEFAULTS = Object.freeze({ maxPages: 100, maxProducts: 5_000, maxResponseBytes: 1024 * 1024, maxContinuationLength: 512, maxDurationMs: 60_000 });
const failure = (error_code) => Object.freeze({ status: 'bounded_pagination_failure', error_code, products: Object.freeze([]), complete: false });
function validLimit(value, lower, upper) { return Number.isSafeInteger(value) && value >= lower && value <= upper; }

/** Fetches opaque provider pages without interpreting or mutating provider-owned items. */
export async function collectCatalogPages({ scope, readPage, limits = {}, now = () => Date.now() } = {}) {
  const validatedScope = validateCatalogProviderScope(scope);
  if (typeof readPage !== 'function') return failure('provider_unavailable');
  const settings = { ...DEFAULTS, ...limits };
  if (!validLimit(settings.maxPages, 1, 10_000) || !validLimit(settings.maxProducts, 1, 100_000) || !validLimit(settings.maxResponseBytes, 1, 16 * 1024 * 1024) || !validLimit(settings.maxContinuationLength, 1, 4096) || !validLimit(settings.maxDurationMs, 1, 300_000)) return failure('pagination_limits_invalid');
  const started = now(); const seen = new Set(); const products = []; let continuation = null;
  for (let page = 0; page < settings.maxPages; page += 1) {
    if (now() - started > settings.maxDurationMs) return failure('pagination_deadline_exceeded');
    let result; try { result = await readPage(Object.freeze({ scope: validatedScope, continuation })); } catch { return failure('provider_unavailable'); }
    if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.items) || typeof result.complete !== 'boolean' || Object.keys(result).some((key) => !['items', 'continuation', 'complete', 'response_bytes', 'reported_count'].includes(key))) return failure('pagination_page_invalid');
    if (result.response_bytes !== undefined && (!validLimit(result.response_bytes, 0, settings.maxResponseBytes))) return failure('pagination_response_too_large');
    if (result.reported_count !== undefined && (!Number.isSafeInteger(result.reported_count) || result.reported_count !== result.items.length)) return failure('pagination_record_count_invalid');
    if (products.length + result.items.length > settings.maxProducts) return failure('pagination_product_limit_exceeded');
    products.push(...result.items);
    if (result.complete) return result.continuation === null ? Object.freeze({ status: 'complete_snapshot', complete: true, products: Object.freeze([...products]) }) : failure('pagination_unexpected_continuation');
    if (typeof result.continuation !== 'string' || result.continuation.length < 1 || result.continuation.length > settings.maxContinuationLength || /[\u0000-\u001f\u007f-\u009f]/u.test(result.continuation) || seen.has(result.continuation)) return failure('pagination_continuation_invalid');
    seen.add(result.continuation); continuation = result.continuation;
  }
  return failure('pagination_page_limit_exceeded');
}
