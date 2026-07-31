const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class CatalogPilotPreviewPersistenceError extends Error {
  constructor(code) {
    super(code)
    this.name = 'CatalogPilotPreviewPersistenceError'
    this.code = code
  }
}

function fail(code) {
  throw new CatalogPilotPreviewPersistenceError(code)
}

export async function persistCatalogPilotPreview({ client, payload }) {
  if (!client || typeof client.rpc !== 'function') fail('persistence_unavailable')
  if (!payload || typeof payload !== 'object' || !payload.run || !Array.isArray(payload.items)) {
    fail('persistence_payload_invalid')
  }

  const { data, error } = await client.rpc('create_pos_catalog_pilot_preview', {
    p_run: payload.run,
    p_items: payload.items,
  })

  if (error) {
    const message = typeof error.message === 'string' ? error.message : ''
    if (message.includes('catalog_pilot_idempotency_conflict')) fail('idempotency_conflict')
    fail('persistence_failed')
  }

  const row = Array.isArray(data) ? data[0] : data
  if (
    !row ||
    typeof row !== 'object' ||
    typeof row.sync_run_id !== 'string' ||
    !UUID.test(row.sync_run_id) ||
    typeof row.created !== 'boolean'
  ) fail('persistence_response_invalid')

  return Object.freeze({
    syncRunId: row.sync_run_id.toLowerCase(),
    created: row.created,
  })
}
