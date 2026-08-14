const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MAX_BODY_BYTES = 1024
const BATCH_SIZE = 100
const MAX_BATCHES_PER_REQUEST = 500

export class CommanderCatalogProductImportError extends Error {
  constructor(code, stage = 'validation') {
    super(code)
    this.code = code
    this.stage = stage
  }
}

function fail(code = 'promotion_unavailable', stage = 'validation') {
  throw new CommanderCatalogProductImportError(code, stage)
}

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredUuid(value, code = 'invalid_action') {
  if (typeof value !== 'string' || !UUID.test(value)) fail(code)
  return value.toLowerCase()
}

function nonnegativeInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail()
  return value
}

function exactKeys(value, keys) {
  if (!record(value)) return false
  const received = Object.keys(value)
  return received.length === keys.length && received.every(key => keys.includes(key))
}

export function parseCommanderCatalogProductImportRequest(value) {
  if (!exactKeys(value, ['action', 'catalog_sync_run_id']) || value.action !== 'import_all_ready') {
    fail('invalid_action')
  }
  return Object.freeze({
    action: 'import_all_ready',
    catalog_sync_run_id: requiredUuid(value.catalog_sync_run_id),
  })
}

export async function readBoundedCommanderCatalogProductImportJson(request) {
  const contentType = request?.headers?.get?.('content-type')?.trim() ?? ''
  if (!/^application\/json(?:\s*;\s*charset=[A-Za-z0-9._-]+)?$/iu.test(contentType)) fail('invalid_action')
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_BODY_BYTES)) fail('invalid_action')
  if (!request.body) fail('invalid_action')

  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        try { await reader.cancel() } catch {}
        fail('invalid_action')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  try {
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return parseCommanderCatalogProductImportRequest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } catch (error) {
    if (error instanceof CommanderCatalogProductImportError) throw error
    fail('invalid_action')
  }
}

function normalizeBatchResult(value, expectedRunId) {
  if (!record(value) || requiredUuid(value.catalog_sync_run_id) !== expectedRunId) fail()
  const result = {
    catalog_sync_run_id: expectedRunId,
    eligible_count: nonnegativeInteger(value.eligible_count),
    imported_count: nonnegativeInteger(value.imported_count),
    linked_existing_count: nonnegativeInteger(value.linked_existing_count),
    already_imported_count: nonnegativeInteger(value.already_imported_count),
    needs_review_count: nonnegativeInteger(value.needs_review_count),
    failed_count: nonnegativeInteger(value.failed_count),
    remaining_count: nonnegativeInteger(value.remaining_count),
  }
  if (result.imported_count > result.eligible_count || result.remaining_count > result.eligible_count) fail()
  return Object.freeze(result)
}

function safeRpcError(error) {
  const safeDatabaseCodes = new Set([
    'catalog_review_stale',
    'catalog_promotion_forbidden',
    'catalog_promotion_invalid',
    'catalog_promotion_master_data_unavailable',
  ])
  if (record(error) && error.code === 'P0001' && typeof error.message === 'string' && safeDatabaseCodes.has(error.message)) {
    return error.message
  }
  if (record(error) && error.code === '42501') return 'promotion_permission_denied'
  return 'promotion_unavailable'
}

/**
 * Runs bounded, independently atomic database batches. A retry resumes by
 * excluding source rows that already acquired their durable source identity.
 */
export async function executeCommanderCatalogProductImport({ client, actorId, catalogSyncRunId } = {}) {
  if (!client || typeof client.rpc !== 'function') fail()
  const normalizedActorId = requiredUuid(actorId, 'unauthorized')
  const normalizedRunId = requiredUuid(catalogSyncRunId)
  let initialEligible = null
  let imported = 0
  let last = null
  let previousRemaining = null
  let maximumBatches = MAX_BATCHES_PER_REQUEST

  for (let batch = 0; batch < maximumBatches; batch += 1) {
    const { data, error } = await client.rpc('promote_commander_live_catalog_products', {
      p_catalog_sync_run_id: normalizedRunId,
      p_actor_id: normalizedActorId,
      p_batch_size: BATCH_SIZE,
    })
    if (error) fail(safeRpcError(error), 'rpc')
    if (!Array.isArray(data) || data.length !== 1) fail('promotion_unavailable', 'rpc')
    last = normalizeBatchResult(data[0], normalizedRunId)
    if (initialEligible === null) {
      initialEligible = last.eligible_count
      maximumBatches = Math.min(
        MAX_BATCHES_PER_REQUEST,
        Math.max(1, Math.ceil(initialEligible / BATCH_SIZE) + 1),
      )
    }
    imported += last.imported_count

    if (last.remaining_count === 0) {
      return Object.freeze({
        ok: true,
        catalog_sync_run_id: normalizedRunId,
        eligible_count: initialEligible,
        imported_count: imported,
        linked_existing_count: last.linked_existing_count,
        already_imported_count: last.already_imported_count,
        needs_review_count: last.needs_review_count,
        failed_count: 0,
        remaining_count: 0,
        error_code: null,
      })
    }
    if (last.imported_count === 0 && (previousRemaining === null || last.remaining_count >= previousRemaining)) {
      fail('catalog_import_no_progress', 'rpc')
    }
    previousRemaining = last.remaining_count
  }
  fail('catalog_import_batch_limit', 'rpc')
}

export const commanderCatalogProductImportContract = Object.freeze({
  action: 'import_all_ready',
  batchSize: BATCH_SIZE,
  maxBatchesPerRequest: MAX_BATCHES_PER_REQUEST,
  maxBodyBytes: MAX_BODY_BYTES,
})
