import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const routePath = new URL('../app/api/products/commander-price/route.ts', import.meta.url)
const pagePath = new URL('../app/(store)/app/products/page.tsx', import.meta.url)
const helperPath = new URL('../lib/pos/controlled-commander-price-publish.mjs', import.meta.url)

test('Commander price route uses the signed-in user, bounded generic RPC, and no service-role access', async () => {
  const [route, helper] = await Promise.all([readFile(routePath, 'utf8'), readFile(helperPath, 'utf8')])
  assert.match(route, /client\.auth\.getUser\(\)/)
  assert.match(route, /readBoundedCommanderPriceJson/)
  assert.match(route, /requestCommanderPriceUpdate/)
  assert.match(route, /listCommanderPriceIdentities/)
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|getSupabaseAdmin|service_role/)
  assert.match(helper, /\.rpc\('request_commander_price_update'/)
  assert.match(helper, /source_system', COMMANDER_SOURCE_SYSTEM/)
  assert.doesNotMatch(helper, /uPLUs|vPLUs|child_process|spawn\(|execFile\(|session_cookie|commander_username|commander_password/)
})

test('Products UI exposes only exact mapped Commander identities and waits for verification', async () => {
  const page = await readFile(pagePath, 'utf8')
  assert.match(page, /commanderPriceIdentityByKey/)
  assert.match(page, /source_product_key/)
  assert.match(page, /Request Price Update/)
  assert.match(page, /Manual Commander price update/)
  assert.match(page, /mandatory vPLUs readback confirms/)
  assert.match(page, /COMMANDER_PRICE_ACTIVE_JOB_STATUSES/)
  assert.match(page, /disabled=\{commanderPriceSubmitting \|\| !commanderPriceConfirmed\}/)
  assert.doesNotMatch(page, /CONTROLLED_COMMANDER_PRICE_PRODUCT|STOREPULSE_TEST_PRICE_ONLY|Change Test Price|Queue Controlled Price Update/)
  assert.doesNotMatch(page, /Apply Commander|Approve Commander|Publish All|Bulk Publish|Sync-to-POS/)
})
