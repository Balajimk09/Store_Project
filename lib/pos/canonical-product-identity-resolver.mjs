const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_IDENTITIES = 100;
const MAX_CLIENT_KEY_LENGTH = 120;
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_NAME_LENGTH = 240;
const MAX_AMBIGUOUS_CANDIDATES = 3;

export class CanonicalProductIdentityResolverError extends Error {
  constructor(code = 'invalid_request') {
    super(code);
    this.name = 'CanonicalProductIdentityResolverError';
    this.code = code;
  }
}

function fail() {
  throw new CanonicalProductIdentityResolverError();
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const received = Object.keys(value);
  return received.length === keys.length && received.every((key) => keys.includes(key));
}

function requiredUuid(value) {
  if (typeof value !== 'string' || !UUID.test(value.trim())) fail();
  return value.trim().toLowerCase();
}

function requiredText(value, maximum) {
  if (typeof value !== 'string') fail();
  const text = value.trim();
  if (!text || text.length > maximum) fail();
  return text;
}

function nullableText(value, maximum) {
  if (value === null) return null;
  if (typeof value !== 'string') fail();
  const text = value.trim();
  if (!text) return null;
  if (text.length > maximum) fail();
  return text;
}

function normalizeCandidate(value) {
  if (!isRecord(value) || typeof value.id !== 'string' || !UUID.test(value.id)) return null;
  return {
    id: value.id.toLowerCase(),
    upc: typeof value.upc === 'string' && value.upc.trim() ? value.upc.trim() : null,
    plu: typeof value.plu === 'string' && value.plu.trim() ? value.plu.trim() : null,
    productCode: typeof value.product_code === 'string' && value.product_code.trim() ? value.product_code.trim() : null,
    itemName: typeof value.item_name === 'string' && value.item_name.trim() ? value.item_name.trim() : null,
    department: typeof value.department === 'string' && value.department.trim() ? value.department.trim() : null,
    sellingPrice: value.selling_price === null || value.selling_price === undefined ? null : String(value.selling_price),
    isActive: value.is_active === true ? true : value.is_active === false ? false : null,
  };
}

function candidateSummary(candidate) {
  return {
    id: candidate.id,
    upc: candidate.upc,
    plu: candidate.plu,
    productCode: candidate.productCode,
    itemName: candidate.itemName,
    department: candidate.department,
    sellingPrice: candidate.sellingPrice,
    isActive: candidate.isActive,
  };
}

function uniqueCandidates(candidates) {
  const byId = new Map();
  for (const candidate of candidates) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function findCanonicalProductIdentityCandidates(identity, candidateRows) {
  const candidates = uniqueCandidates((Array.isArray(candidateRows) ? candidateRows : [])
    .map(normalizeCandidate)
    .filter(Boolean));
  const exactMatches = [];
  const fields = [
    ['upc', identity?.upc],
    ['plu', identity?.plu],
    ['productCode', identity?.productCode],
  ];
  for (const [field, value] of fields) {
    if (typeof value !== 'string' || !value) continue;
    exactMatches.push(...candidates.filter((candidate) => candidate[field] === value));
  }
  return Object.freeze(uniqueCandidates(exactMatches));
}

export function summarizeCanonicalProductIdentityCandidate(value) {
  const candidate = normalizeCandidate(value);
  return candidate === null ? null : Object.freeze(candidateSummary(candidate));
}

export function parseCanonicalProductIdentityResolveRequest(value) {
  if (!exactKeys(value, ['storeId', 'identities']) || !Array.isArray(value.identities)) fail();
  if (value.identities.length < 1 || value.identities.length > MAX_IDENTITIES) fail();

  const clientKeys = new Set();
  const identities = value.identities.map((identity) => {
    if (!exactKeys(identity, ['clientKey', 'upc', 'plu', 'productCode', 'name'])) fail();
    const normalized = {
      clientKey: requiredText(identity.clientKey, MAX_CLIENT_KEY_LENGTH),
      upc: nullableText(identity.upc, MAX_IDENTIFIER_LENGTH),
      plu: nullableText(identity.plu, MAX_IDENTIFIER_LENGTH),
      productCode: nullableText(identity.productCode, MAX_IDENTIFIER_LENGTH),
      name: nullableText(identity.name, MAX_NAME_LENGTH),
    };
    if (!normalized.upc && !normalized.plu && !normalized.productCode && !normalized.name) fail();
    if (clientKeys.has(normalized.clientKey)) fail();
    clientKeys.add(normalized.clientKey);
    return Object.freeze(normalized);
  });

  return Object.freeze({
    storeId: requiredUuid(value.storeId),
    identities: Object.freeze(identities),
  });
}

export function collectCanonicalProductIdentityValues(identities) {
  const collect = (field) => [...new Set(identities.map((identity) => identity[field]).filter(Boolean))];
  return Object.freeze({
    upcs: collect('upc'),
    plus: collect('plu'),
    productCodes: collect('productCode'),
  });
}

export function resolveCanonicalProductIdentities(identities, candidateRows) {
  return identities.map((identity) => {
    const uniqueMatches = findCanonicalProductIdentityCandidates(identity, candidateRows);
    if (uniqueMatches.length === 1) {
      return Object.freeze({
        clientKey: identity.clientKey,
        status: 'MATCHED',
        product: candidateSummary(uniqueMatches[0]),
        candidates: [],
      });
    }
    if (uniqueMatches.length > 1) {
      return Object.freeze({
        clientKey: identity.clientKey,
        status: 'AMBIGUOUS',
        product: null,
        candidates: uniqueMatches.slice(0, MAX_AMBIGUOUS_CANDIDATES).map(candidateSummary),
      });
    }

    return Object.freeze({
      clientKey: identity.clientKey,
      status: 'NOT_FOUND',
      product: null,
      candidates: [],
    });
  });
}

export async function readBoundedCanonicalProductIdentityResolveJson(request) {
  const contentType = request?.headers?.get?.('content-type')?.trim() ?? '';
  if (!/^application\/json(?:\s*;\s*charset=[A-Za-z0-9._-]+)?$/iu.test(contentType)) fail();
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) fail();
  if (!request.body) fail();

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch {}
        fail();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return parseCanonicalProductIdentityResolveRequest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (error) {
    if (error instanceof CanonicalProductIdentityResolverError) throw error;
    fail();
  }
}

export const canonicalProductIdentityResolverContract = Object.freeze({
  maxBodyBytes: MAX_BODY_BYTES,
  maxIdentities: MAX_IDENTITIES,
  maxAmbiguousCandidates: MAX_AMBIGUOUS_CANDIDATES,
  identifierPrecedence: ['upc', 'plu', 'productCode'],
});
