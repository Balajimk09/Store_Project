import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const routePath = new URL('../app/api/connectors/catalog-pilot/preview/route.ts', import.meta.url)
const migrationPath = new URL('../supabase/migrations/20260730215000_add_pos_catalog_pilot_preview_rpc.sql', import.meta.url)

test('preview route is bounded, connector-authenticated, JSON-only, and preview-only', async () => {
  const source = await readFile(routePath, 'utf8')
  assert.match(source, /MAX_BODY_BYTES = 64 \* 1024/)
  assert.match(source, /contentType !== 'application\/json'/)
  assert.match(source, /\.eq\('token_hash', hashToken\(rawToken\)\)/)
  assert.match(source, /persistCatalogPilotPreview/)
  assert.match(source, /previewOnly: true/)
  assert.doesNotMatch(source, /\.from\(['"]products['"]\)/)
  assert.doesNotMatch(source, /NAXML|uPLUs|rawXml|cookie/i)
})

test('preview RPC is invoker-security, service-role-only, atomic, and cannot write products', async () => {
  const source = await readFile(migrationPath, 'utf8')
  assert.match(source, /security invoker/i)
  assert.match(source, /revoke all on function .* from public/i)
  assert.match(source, /grant execute on function .* to service_role/i)
  assert.match(source, /insert into public\.pos_catalog_sync_runs/i)
  assert.match(source, /insert into public\.pos_catalog_sync_items/i)
  assert.doesNotMatch(source, /^\s*(?:insert into|update|delete from)\s+public\.products\b/gim)
  assert.doesNotMatch(source, /security definer/i)
})
