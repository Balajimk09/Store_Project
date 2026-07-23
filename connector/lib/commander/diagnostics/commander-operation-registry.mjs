export const COMMANDER_OPERATIONS = Object.freeze({
  validate_structure: Object.freeze({ operation: 'validate_structure', category: 'authentication', mode: 'read_only', approvalRequired: true, command: 'validate', requestType: 'no_body', maximumResponseBytes: 262144, status: 'implemented' }),
  read_test_product: Object.freeze({ operation: 'read_test_product', category: 'catalog', mode: 'read_only', approvalRequired: true, status: 'blocked' }),
  inspect_catalog_pagination: Object.freeze({ operation: 'inspect_catalog_pagination', category: 'catalog', mode: 'read_only', approvalRequired: true, status: 'blocked' }),
  verify_test_price_write: Object.freeze({ operation: 'verify_test_price_write', category: 'products', mode: 'write', approvalRequired: true, status: 'blocked' }),
})
export function getCommanderOperation(operation) {
  const value = COMMANDER_OPERATIONS[operation]
  if (!value || value.status !== 'implemented') {
    const error = new Error('operation_not_allowed')
    error.code = 'operation_not_allowed'
    throw error
  }
  return value
}
