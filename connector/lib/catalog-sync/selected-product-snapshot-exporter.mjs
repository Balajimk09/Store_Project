import {
  normalizeCommanderProductForPreview,
  parseCommanderSelectedProductsArtifact,
} from './selected-product-preview-runner.mjs'
import {
  createCatalogPilotSnapshot,
  serializeCatalogPilotSnapshot,
} from '../../../lib/pos/catalog-pilot-snapshot.mjs'

const APPROVAL_KEYS = Object.freeze([
  'approved',
  'operation',
  'supervised',
  'read_only',
  'selected_products_reviewed',
])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index])
}

function safeFailure(code, selectionCount = 0, receivedCount = 0) {
  return Object.freeze({
    ok: false,
    read_only: true,
    snapshot_written: false,
    selection_count: selectionCount,
    received_product_count: receivedCount,
    safe_error_code: code,
  })
}

function validateApproval(value) {
  if (!isRecord(value) || !exactKeys(value, ['approval'])) {
    return 'invalid_input'
  }

  const approval = value.approval
  if (!isRecord(approval) || approval.approved !== true) {
    return 'approval_required'
  }

  if (approval.operation !== 'export_selected_products_snapshot') {
    return 'approval_mismatch'
  }

  if (
    !exactKeys(approval, APPROVAL_KEYS)
    || approval.supervised !== true
    || approval.read_only !== true
    || approval.selected_products_reviewed !== true
  ) {
    return 'approval_invalid'
  }

  return null
}

export async function runCommanderSelectedProductSnapshotExport({
  approval,
  selectionArtifact,
  readSelectedProduct,
  writeSnapshot,
  clock = () => new Date(),
} = {}) {
  const approvalError = validateApproval({ approval })
  if (approvalError) return safeFailure(approvalError)

  let selection
  try {
    selection = parseCommanderSelectedProductsArtifact(selectionArtifact)
  } catch {
    return safeFailure('selection_artifact_invalid')
  }

  const selectionCount = selection.selectedProducts.length
  if (selectionCount > 5) {
    return safeFailure('selection_artifact_invalid', selectionCount)
  }

  if (
    typeof readSelectedProduct !== 'function'
    || typeof writeSnapshot !== 'function'
  ) {
    return safeFailure('export_dependency_invalid', selectionCount)
  }

  const products = []

  for (const identity of selection.selectedProducts) {
    let result
    try {
      result = await readSelectedProduct(
        Object.freeze({
          upc: identity.upc,
          modifier: identity.modifier,
        }),
      )
    } catch {
      return safeFailure(
        'commander_read_failed',
        selectionCount,
        products.length,
      )
    }

    if (!isRecord(result) || typeof result.status !== 'string') {
      return safeFailure(
        'commander_read_failed',
        selectionCount,
        products.length,
      )
    }

    if (result.status === 'product_not_found') {
      return safeFailure(
        'selected_product_not_found',
        selectionCount,
        products.length,
      )
    }

    if (
      result.status === 'commander_tls_hostname_invalid'
      || result.status === 'commander_tls_peer_mismatch'
    ) {
      return safeFailure(result.status, selectionCount, products.length)
    }

    if (result.status === 'session_failed') {
      return safeFailure(
        'commander_authentication_failed',
        selectionCount,
        products.length,
      )
    }

    if (result.status !== 'success') {
      return safeFailure(
        'commander_read_failed',
        selectionCount,
        products.length,
      )
    }

    try {
      products.push(
        normalizeCommanderProductForPreview({
          sourceStoreNumber: selection.store.sourceStoreNumber,
          selectedIdentity: identity,
          product: result.product,
        }),
      )
    } catch {
      return safeFailure(
        'commander_product_invalid',
        selectionCount,
        products.length,
      )
    }
  }

  let snapshot
  let contents

  try {
    snapshot = createCatalogPilotSnapshot({
      storeId: selection.store.storeId,
      ownerId: selection.store.ownerId,
      sourceStoreNumber: selection.store.sourceStoreNumber,
      capturedAt: clock(),
      selectedProducts: selection.selectedProducts.map(
        ({ upc, modifier }) => Object.freeze({ upc, modifier }),
      ),
      products,
    })
    contents = serializeCatalogPilotSnapshot(snapshot)
  } catch {
    return safeFailure(
      'snapshot_creation_failed',
      selectionCount,
      products.length,
    )
  }

  try {
    const result = await writeSnapshot(
      Object.freeze({
        fileName: 'commander-selected-products-snapshot.json',
        contents,
        snapshotHash: snapshot.snapshotHash,
      }),
    )

    if (
      !isRecord(result)
      || result.written !== true
      || typeof result.location !== 'string'
      || result.location.length < 1
      || result.location.length > 512
    ) {
      return safeFailure(
        'snapshot_write_failed',
        selectionCount,
        products.length,
      )
    }
  } catch {
    return safeFailure(
      'snapshot_write_failed',
      selectionCount,
      products.length,
    )
  }

  return Object.freeze({
    ok: true,
    read_only: true,
    snapshot_written: true,
    selection_count: selectionCount,
    received_product_count: products.length,
    snapshot_hash: snapshot.snapshotHash,
    safe_error_code: null,
  })
}
