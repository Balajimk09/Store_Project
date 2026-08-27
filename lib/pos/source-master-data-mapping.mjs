const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SOURCE_KEY = /^[A-Za-z0-9_.-]{1,64}$/u
const SOURCE_CONTEXT_KEY = /^[A-Za-z0-9_.-]{0,64}$/u
const RESTRICTION_TYPES = new Set([
  'alcohol',
  'tobacco',
  'vape',
  'lottery',
  'adult_content',
  'cbd',
  'energy_drinks',
])

export const MASTER_DATA_MAPPING_ENTITY_TYPES = Object.freeze(['tax', 'age_validation', 'department', 'category'])
export const MASTER_DATA_MAPPING_ACTIONS = Object.freeze(['create', 'map_existing', 'ignore'])
export const COMMANDER_MASTER_DATA_MAPPING_SOURCE_SYSTEM = 'commander'

export class SourceMasterDataMappingError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

const fail = code => { throw new SourceMasterDataMappingError(code) }

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('master_data_mapping_invalid')
  return value.toLowerCase()
}

function stringKey(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail('master_data_mapping_invalid')
  return value
}

export function parseCommanderMasterDataMappingRequest(value) {
  if (!isRecord(value) || Object.keys(value).length !== 3
    || !Object.hasOwn(value, 'storeId') || !Object.hasOwn(value, 'masterDataRunId') || !Object.hasOwn(value, 'requests')) {
    fail('master_data_mapping_invalid')
  }
  if (!Array.isArray(value.requests) || value.requests.length === 0 || value.requests.length > 100) {
    fail('master_data_mapping_invalid')
  }

  const seen = new Set()
  const requests = value.requests.map((request) => {
    if (!isRecord(request)) fail('master_data_mapping_invalid')
    const allowed = new Set(['entityType', 'sourceKey', 'sourceContextKey', 'action', 'canonicalId', 'restrictionType'])
    if (Object.keys(request).some((name) => !allowed.has(name))) fail('master_data_mapping_invalid')
    const entityType = request.entityType
    const action = request.action
    if (!MASTER_DATA_MAPPING_ENTITY_TYPES.includes(entityType) || !MASTER_DATA_MAPPING_ACTIONS.includes(action)) {
      fail('master_data_mapping_invalid')
    }
    const sourceKey = stringKey(request.sourceKey, SOURCE_KEY)
    const sourceContextKey = request.sourceContextKey === undefined || request.sourceContextKey === null
      ? ''
      : stringKey(request.sourceContextKey, SOURCE_CONTEXT_KEY)
    if ((entityType === 'category') !== (sourceContextKey !== '')) fail('master_data_mapping_invalid')
    if (entityType === 'category' && sourceKey === '0') fail('master_data_mapping_invalid')
    const canonicalId = request.canonicalId === undefined || request.canonicalId === null ? null : uuid(request.canonicalId)
    if ((action === 'map_existing') !== (canonicalId !== null)) fail('master_data_mapping_invalid')
    const restrictionType = request.restrictionType === undefined || request.restrictionType === null ? null : request.restrictionType
    if (restrictionType !== null && (typeof restrictionType !== 'string' || !RESTRICTION_TYPES.has(restrictionType))) {
      fail('master_data_mapping_invalid')
    }
    if (entityType === 'age_validation' && action === 'create' && restrictionType === null) {
      fail('master_data_mapping_restriction_type_required')
    }
    if (entityType !== 'age_validation' && restrictionType !== null) fail('master_data_mapping_invalid')

    const identity = `${entityType}\u0000${sourceKey}\u0000${sourceContextKey}`
    if (seen.has(identity)) fail('master_data_mapping_invalid')
    seen.add(identity)
    return Object.freeze({
      entity_type: entityType,
      source_key: sourceKey,
      source_context_key: sourceContextKey,
      action,
      canonical_id: canonicalId,
      restriction_type: restrictionType,
    })
  })

  return Object.freeze({
    storeId: uuid(value.storeId),
    masterDataRunId: uuid(value.masterDataRunId),
    requests: Object.freeze(requests),
  })
}

export function sourceMasterDataMappingSummary({ taxes, ageValidations, departments, categories, mappings }) {
  const mappingKeys = new Set((Array.isArray(mappings) ? mappings : [])
    .filter((mapping) => mapping.status === 'mapped')
    .map((mapping) => `${mapping.entity_type}\u0000${mapping.source_key}\u0000${mapping.source_context_key ?? ''}`))
  const countMapped = (entityType, rows, context = row => row.source_context_key ?? '') => (Array.isArray(rows) ? rows : [])
    .filter((row) => mappingKeys.has(`${entityType}\u0000${row.source_key}\u0000${context(row)}`)).length
  return Object.freeze({
    taxes: Object.freeze({ source: Array.isArray(taxes) ? taxes.length : 0, mapped: countMapped('tax', taxes) }),
    age_validations: Object.freeze({ source: Array.isArray(ageValidations) ? ageValidations.length : 0, mapped: countMapped('age_validation', ageValidations) }),
    departments: Object.freeze({ source: Array.isArray(departments) ? departments.length : 0, mapped: countMapped('department', departments) }),
    categories: Object.freeze({ source: Array.isArray(categories) ? categories.length : 0, mapped: countMapped('category', categories, row => row.source_context_key ?? '') }),
  })
}

export const commanderProductDepartmentPromotionJoin = Object.freeze({
  sourceProductDepartmentKey: 'pos_catalog_source_product_observations.source_department_key',
  sourceDepartmentKey: 'pos_catalog_source_department_definitions.source_department_key',
  mappingEntity: 'pos_catalog_source_master_data_mappings(entity_type=department)',
  canonicalDepartmentId: 'store_departments.id',
})
