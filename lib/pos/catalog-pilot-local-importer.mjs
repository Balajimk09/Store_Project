import {
  catalogPilotSnapshotIdempotencyKey,
  catalogPilotSnapshotToPreviewBody,
  parseCatalogPilotSnapshot,
} from './catalog-pilot-snapshot.mjs'
import { buildCatalogPilotPreviewPayload } from './catalog-pilot-preview-input.mjs'
import { persistCatalogPilotPreview } from './catalog-pilot-preview-service.mjs'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeFailure(code) {
  return Object.freeze({
    ok: false,
    selected_products_only: true,
    preview_created: false,
    promotion_completed: false,
    safe_error_code: code,
  })
}

function validateConnector(connector, snapshot) {
  return Boolean(
    isRecord(connector)
    && typeof connector.id === 'string'
    && UUID.test(connector.id)
    && typeof connector.storeId === 'string'
    && UUID.test(connector.storeId)
    && connector.storeId.toLowerCase() === snapshot.storeId
    && connector.sourceSystem === snapshot.sourceSystem
    && connector.sourceStoreNumber === snapshot.sourceStoreNumber,
  )
}

function normalizePromotionResponse(data, expectedRunId) {
  const row = Array.isArray(data) ? data[0] : data

  if (
    !isRecord(row)
    || typeof row.sync_run_id !== 'string'
    || !UUID.test(row.sync_run_id)
    || row.sync_run_id.toLowerCase() !== expectedRunId
    || !Number.isInteger(row.promoted_count)
    || !Number.isInteger(row.created_count)
    || !Number.isInteger(row.updated_count)
    || !Number.isInteger(row.unchanged_count)
    || row.promoted_count < 1
    || row.promoted_count > 5
    || row.created_count < 0
    || row.updated_count < 0
    || row.unchanged_count < 0
    || row.created_count + row.updated_count + row.unchanged_count
      !== row.promoted_count
  ) {
    throw new Error('promotion_response_invalid')
  }

  return Object.freeze({
    promotedCount: row.promoted_count,
    createdCount: row.created_count,
    updatedCount: row.updated_count,
    unchangedCount: row.unchanged_count,
  })
}

export async function importCatalogPilotSnapshot({
  snapshotText,
  connector,
  ownerId,
  client,
} = {}) {
  let snapshot

  try {
    snapshot = parseCatalogPilotSnapshot(snapshotText)
  } catch (error) {
    return safeFailure(
      error?.code === 'catalog_pilot_snapshot_hash_mismatch'
        ? 'snapshot_hash_mismatch'
        : 'snapshot_invalid',
    )
  }

  if (
    typeof ownerId !== 'string'
    || !UUID.test(ownerId)
    || ownerId.toLowerCase() !== snapshot.ownerId
    || !validateConnector(connector, snapshot)
    || !client
    || typeof client.rpc !== 'function'
  ) {
    return safeFailure('import_identity_invalid')
  }

  let previewPayload
  try {
    previewPayload = buildCatalogPilotPreviewPayload({
      body: catalogPilotSnapshotToPreviewBody(snapshot),
      connector,
      ownerId,
      idempotencyKey: catalogPilotSnapshotIdempotencyKey(snapshot),
    })
  } catch {
    return safeFailure('preview_payload_invalid')
  }

  let preview
  try {
    preview = await persistCatalogPilotPreview({
      client,
      payload: previewPayload,
    })
  } catch (error) {
    const code = error?.code
    if (code === 'idempotency_conflict') {
      return safeFailure('preview_idempotency_conflict')
    }
    return safeFailure('preview_persistence_failed')
  }

  let data
  let error

  try {
    const response = await client.rpc(
      'promote_pos_catalog_pilot_products',
      { p_sync_run_id: preview.syncRunId },
    )
    data = response?.data
    error = response?.error
  } catch {
    return safeFailure('promotion_failed')
  }

  if (error) return safeFailure('promotion_failed')

  let promotion
  try {
    promotion = normalizePromotionResponse(data, preview.syncRunId)
  } catch {
    return safeFailure('promotion_response_invalid')
  }

  if (promotion.promotedCount !== snapshot.products.length) {
    return safeFailure('promotion_response_invalid')
  }

  return Object.freeze({
    ok: true,
    selected_products_only: true,
    preview_created: preview.created,
    promotion_completed: true,
    sync_run_id: preview.syncRunId,
    snapshot_hash: snapshot.snapshotHash,
    selection_count: snapshot.selectedProducts.length,
    promoted_count: promotion.promotedCount,
    created_count: promotion.createdCount,
    updated_count: promotion.updatedCount,
    unchanged_count: promotion.unchangedCount,
    safe_error_code: null,
  })
}
