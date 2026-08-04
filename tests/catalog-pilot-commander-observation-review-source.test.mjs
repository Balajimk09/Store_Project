import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const routePath = new URL('../app/api/products/commander-observations/route.ts', import.meta.url)
const pagePath = new URL('../app/(store)/app/products/page.tsx', import.meta.url)
const helperPath = new URL('../lib/pos/catalog-pilot-commander-observations.mjs', import.meta.url)

test('Commander observation review route is session-authorized, bounded, and read-only', async () => {
  const [route, helper] = await Promise.all([readFile(routePath, 'utf8'), readFile(helperPath, 'utf8')])

  assert.match(route, /export async function GET\(request: Request\)/)
  assert.match(route, /client\.auth\.getUser\(\)/)
  assert.match(route, /listCommanderObservationReview/)
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|getSupabaseAdmin|export async function (POST|PATCH|PUT|DELETE)/)
  assert.match(helper, /\.from\('stores'\)[\s\S]*?\.eq\('id', storeId\)[\s\S]*?\.eq\('owner_id', userId\)/)
  assert.match(helper, /\.from\('pos_catalog_source_observations'\)[\s\S]*?\.eq\('store_id', storeId\)[\s\S]*?\.eq\('source_system', COMMANDER_SOURCE_SYSTEM\)/)
  assert.match(helper, /\.order\('observed_at', \{ ascending: false \}\)[\s\S]*?\.order\('source_product_key', \{ ascending: true \}\)[\s\S]*?\.limit\(MAX_OBSERVATIONS\)/)
  assert.doesNotMatch(helper, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|commander-vplu|four-product-read-child|Supabase/i)
})

test('Products review surface shows Commander staging with source-identity-gated manual price actions', async () => {
  const page = await readFile(pagePath, 'utf8')

  assert.match(page, /api\/products\/commander-observations\?storeId=/)
  assert.match(page, /Commander POS Sync/)
  assert.match(page, /Staged Commander Products/)
  assert.match(page, /commanderObservations\.map\(/)
  assert.match(page, /Loading Commander staged products/)
  assert.match(page, /No Commander products are staged for this store/)
  assert.match(
    page,
    /commanderPriceIdentityByKey\.get\(observation\.source_product_key\)/,
  )
  assert.match(page, /openCommanderPrice\(observation\)/)
  assert.match(page, /Request Price Update/)
  assert.doesNotMatch(page, /CONTROLLED_COMMANDER_PRICE_PRODUCT|Change Test Price/)
  assert.match(page, />Read only</)
  assert.doesNotMatch(page, /Apply Commander|Approve Commander|Publish All|Promote Commander|Sync-to-POS/)
})
