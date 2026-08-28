import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const page = fs.readFileSync(new URL('../app/(store)/app/products/page.tsx', import.meta.url), 'utf8')

function sliceBetween(text, startNeedle, endNeedle) {
  const start = text.indexOf(startNeedle)
  const end = text.indexOf(endNeedle, start)
  assert.notEqual(start, -1, startNeedle)
  assert.notEqual(end, -1, endNeedle)
  return text.slice(start, end)
}

test('Edit Product dynamically loads only full Commander product context', () => {
  const productIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ]
  const loader = sliceBetween(page, '  const loadEditingCommanderProductContext = useCallback', '  const editingCommanderEffectiveProductFields = useMemo')
  const openEditModal = sliceBetween(page, '  const openEditModal = (product: Product) => {', '  const closeProductModal = () => {')
  const contextUrl = (storeId, productId) => `/api/products/commander-product?storeId=${encodeURIComponent(storeId)}&productId=${encodeURIComponent(productId)}&context=1`

  assert.match(loader, /commander-product\?storeId=\$\{encodeURIComponent\(activeStoreId\)\}&productId=\$\{encodeURIComponent\(productId\)\}&context=1/)
  assert.match(openEditModal, /void loadEditingCommanderProductContext\(product\.id\)/)
  assert.doesNotMatch(openEditModal, /loadEditingCommanderPriceContext|commander-price/)
  assert.doesNotMatch(page, /\/api\/products\/commander-price\?[^`'\n]*context=1/)
  assert.deepEqual(
    productIds.map((productId) => contextUrl('33333333-3333-4333-8333-333333333333', productId)),
    [
      '/api/products/commander-product?storeId=33333333-3333-4333-8333-333333333333&productId=11111111-1111-4111-8111-111111111111&context=1',
      '/api/products/commander-product?storeId=33333333-3333-4333-8333-333333333333&productId=22222222-2222-4222-8222-222222222222&context=1',
    ],
  )
})

test('Edit Product uses full context for price status and separates verification retry from POS-update retry', () => {
  const status = sliceBetween(page, '  const editPosUpdateStatus = useMemo', '  const retryEditingCommanderProductVerification = useCallback')
  const retryVerification = sliceBetween(page, '  const retryEditingCommanderProductVerification = useCallback', '  const retryFailedCommanderProductUpdate = useCallback')
  const retryUpdate = sliceBetween(page, '  const retryFailedCommanderProductUpdate = useCallback', '  const checkUpcDuplicate =')
  const productJobRefresh = sliceBetween(page, '  const refreshCommanderProductJob = useCallback', '  useEffect(() => {')
  const modal = sliceBetween(page, '      <ProductModal', '    </DashboardShell>')

  assert.match(status, /Checking current POS product\.\.\./)
  assert.match(status, /POS product could not be verified\. Commander-supported changes cannot be saved until verification succeeds\./)
  assert.match(status, /editingCommanderProductContext\.commander_price/)
  assert.match(status, /POS price synchronized at/)
  assert.match(status, /Saving will update POS price:/)
  assert.doesNotMatch(status, /POS price could not be verified/)

  assert.match(retryVerification, /void loadEditingCommanderProductContext\(editingProduct\.id\)/)
  assert.doesNotMatch(retryVerification, /submitCommanderPrice|submitCommanderProduct|fetch\(|POST|rpc/)

  assert.match(retryUpdate, /commanderProductJob\.operation !== 'update_product'/)
  assert.match(retryUpdate, /commanderProductJob\.status !== 'failed' && commanderProductJob\.status !== 'cancelled'/)
  assert.match(retryUpdate, /await loadEditingCommanderProductContext\(editingProduct\.id\)/)
  assert.match(retryUpdate, /buildCommanderProductUpdateRequest\(/)
  assert.match(retryUpdate, /submitCommanderProduct\(request\.request\)/)
  assert.doesNotMatch(retryUpdate, /submitCommanderPrice|submitCommanderPrice\(|update_price/)

  assert.match(productJobRefresh, /await loadEditingCommanderProductContext\(commanderProductJobProductId\)/)
  assert.doesNotMatch(productJobRefresh, /loadEditingCommanderPriceContext/)
  assert.match(modal, /onRetryPosVerification=\{/)
  assert.match(modal, /onRetryPosUpdate=\{/)
  assert.match(modal, /commanderProductJob\?\.operation === 'update_product'/)
})

test('normal edits and Add Product retain their generic product write paths', () => {
  const save = sliceBetween(page, '  const saveProduct = async () => {', '  const handleProductImportFile = async')

  assert.match(save, /buildCommanderProductUpdateRequest\(/)
  assert.match(save, /submitCommanderProduct\(request\.request\)/)
  assert.match(save, /submitCommanderProductCreate\(/)
  assert.doesNotMatch(page, /00999999999992/)
})
