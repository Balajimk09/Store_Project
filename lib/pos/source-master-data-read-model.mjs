const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SAFE_SEARCH = /^[A-Za-z0-9 ._&()/-]*$/u
const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE = 10_000
const MAX_SEARCH_LENGTH = 80

export const COMMANDER_MASTER_DATA_SOURCE_SYSTEM = 'commander'

export class SourceMasterDataReadError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

const fail = code => { throw new SourceMasterDataReadError(code) }

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value, maximum = 512, { nullable = false } = {}) {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail('master_data_unavailable')
  return value
}

function key(value) {
  const normalized = text(value, 64)
  if (!normalized) fail('master_data_unavailable')
  return normalized
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 50_000) fail('master_data_unavailable')
  return value
}

function optionalInteger(value) {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || value < 0 || value > 999_999_999) fail('master_data_unavailable')
  return value
}

function bool(value) {
  if (typeof value !== 'boolean') fail('master_data_unavailable')
  return value
}

function timestamp(value) {
  const normalized = text(value, 64)
  if (!Number.isFinite(Date.parse(normalized))) fail('master_data_unavailable')
  return normalized
}

function pageNumber(value, fallback, maximum) {
  if (value === null) return fallback
  if (!/^\d+$/u.test(value)) fail('invalid_query')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) fail('invalid_query')
  return parsed
}

export function parseSourceMasterDataQuery(searchParams) {
  if (!searchParams || typeof searchParams.get !== 'function' || typeof searchParams.keys !== 'function') fail('invalid_query')
  const allowed = new Set(['storeId', 'page', 'pageSize', 'search'])
  for (const name of searchParams.keys()) if (!allowed.has(name)) fail('invalid_query')

  const storeId = searchParams.get('storeId')
  if (typeof storeId !== 'string' || !UUID.test(storeId)) fail('invalid_store')
  const searchValue = searchParams.get('search')
  const search = searchValue === null || searchValue.trim() === '' ? null : searchValue.trim()
  if (search !== null && (search.length > MAX_SEARCH_LENGTH || !SAFE_SEARCH.test(search))) fail('invalid_query')

  return Object.freeze({
    storeId: storeId.toLowerCase(),
    search,
    page: pageNumber(searchParams.get('page'), 1, MAX_PAGE),
    pageSize: pageNumber(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  })
}

export function sourceMasterDataPageCount(total, pageSize) {
  return Math.ceil(count(total) / count(pageSize))
}

function mapRows(rows, mapKey, normalize) {
  if (!Array.isArray(rows)) fail('master_data_unavailable')
  const values = new Map()
  for (const row of rows) {
    const normalized = normalize(row)
    const id = normalized[mapKey]
    if (values.has(id)) fail('master_data_unavailable')
    values.set(id, normalized)
  }
  return values
}

function normalizeCategory(row) {
  if (!record(row)) fail('master_data_unavailable')
  return Object.freeze({ source_category_key: key(row.source_category_key), source_name: text(row.source_name) })
}

function normalizeProductCode(row) {
  if (!record(row)) fail('master_data_unavailable')
  return Object.freeze({
    source_product_code_key: key(row.source_product_code_key),
    source_name: text(row.source_name),
    is_not_sold: bool(row.is_not_sold),
    is_fuel: bool(row.is_fuel),
  })
}

function normalizeTax(row) {
  if (!record(row)) fail('master_data_unavailable')
  const source_rate = text(String(row.source_rate), 64)
  if (!/^\d{1,18}(?:\.\d{1,8})?$/u.test(source_rate)) fail('master_data_unavailable')
  return Object.freeze({ source_tax_key: key(row.source_tax_key), source_name: text(row.source_name), source_rate })
}

function normalizeAgeValidation(row) {
  if (!record(row)) fail('master_data_unavailable')
  return Object.freeze({
    source_age_validation_key: key(row.source_age_validation_key),
    source_name: text(row.source_name),
    source_min_age: optionalInteger(row.source_min_age),
  })
}

function normalizeDepartment(row) {
  if (!record(row)) fail('master_data_unavailable')
  return Object.freeze({
    source_department_key: key(row.source_department_key),
    source_name: text(row.source_name),
    source_category_key: row.source_category_key === null ? null : key(row.source_category_key),
    source_product_code_key: key(row.source_product_code_key),
  })
}

function normalizeTaxLink(row) {
  if (!record(row)) fail('master_data_unavailable')
  return Object.freeze({ source_department_key: key(row.source_department_key), source_tax_key: key(row.source_tax_key) })
}

function normalizeAgeLink(row) {
  if (!record(row)) fail('master_data_unavailable')
  return Object.freeze({ source_department_key: key(row.source_department_key), source_age_validation_key: key(row.source_age_validation_key) })
}

function normalizeLatestRun(row) {
  if (!record(row) || key(row.source_system) !== COMMANDER_MASTER_DATA_SOURCE_SYSTEM) fail('master_data_unavailable')
  if (typeof row.id !== 'string' || !UUID.test(row.id)) fail('master_data_unavailable')
  if (!record(row.restrictions_summary) && row.restrictions_summary !== null) fail('master_data_unavailable')
  return Object.freeze({
    id: row.id.toLowerCase(),
    source_system: COMMANDER_MASTER_DATA_SOURCE_SYSTEM,
    collected_at: timestamp(row.collected_at),
    department_count: count(row.department_count),
    category_count: count(row.category_count),
    product_code_count: count(row.product_code_count),
    tax_definition_count: count(row.tax_definition_count),
    age_validation_count: row.age_validation_count === null ? null : count(row.age_validation_count),
    restrictions_available: bool(row.restrictions_available),
    age_validation_available: bool(row.age_validation_available),
    age_service_available: bool(row.age_service_available),
    restrictions_summary: row.restrictions_summary,
  })
}

function normalizedRestrictions(run) {
  if (!run.restrictions_available) return Object.freeze({ available: false, age_validation_count: null, blue_laws_detected: null, plu_promotions_detected: null })
  const summary = run.restrictions_summary
  if (!record(summary)) fail('master_data_unavailable')
  return Object.freeze({
    available: true,
    age_validation_count: count(summary.age_validation_count),
    blue_laws_detected: bool(summary.blue_laws_container_present),
    plu_promotions_detected: bool(summary.plu_promos_container_present),
  })
}

export function buildSourceMasterDataReview({ latestRun, categories, productCodes, departments, taxes, ageValidations, ageServiceSetting, departmentTaxLinks, departmentAgeValidationLinks, productCodeTotal }) {
  const run = normalizeLatestRun(latestRun)
  const categoryByKey = mapRows(categories, 'source_category_key', normalizeCategory)
  const productCodeByKey = mapRows(productCodes, 'source_product_code_key', normalizeProductCode)
  const taxByKey = mapRows(taxes, 'source_tax_key', normalizeTax)
  const ageValidationByKey = mapRows(ageValidations, 'source_age_validation_key', normalizeAgeValidation)
  const departmentByKey = mapRows(departments, 'source_department_key', normalizeDepartment)
  const taxLinks = (Array.isArray(departmentTaxLinks) ? departmentTaxLinks : []).map(normalizeTaxLink)
  const ageLinks = (Array.isArray(departmentAgeValidationLinks) ? departmentAgeValidationLinks : []).map(normalizeAgeLink)
  const taxByDepartment = new Map()
  const ageByDepartment = new Map()
  const taxUsage = new Map()
  const ageUsage = new Map()

  let categoryReferencesValid = true
  let productCodeReferencesValid = true
  for (const department of departmentByKey.values()) {
    if (department.source_category_key !== null && !categoryByKey.has(department.source_category_key)) categoryReferencesValid = false
    if (!productCodeByKey.has(department.source_product_code_key)) productCodeReferencesValid = false
  }

  let taxReferencesValid = true
  for (const link of taxLinks) {
    if (!departmentByKey.has(link.source_department_key) || !taxByKey.has(link.source_tax_key)) taxReferencesValid = false
    const values = taxByDepartment.get(link.source_department_key) ?? []
    values.push(link.source_tax_key)
    taxByDepartment.set(link.source_department_key, values)
    taxUsage.set(link.source_tax_key, (taxUsage.get(link.source_tax_key) ?? 0) + 1)
  }

  let ageValidationReferencesValid = true
  for (const link of ageLinks) {
    if (!departmentByKey.has(link.source_department_key) || !ageValidationByKey.has(link.source_age_validation_key)) ageValidationReferencesValid = false
    const values = ageByDepartment.get(link.source_department_key) ?? []
    values.push(link.source_age_validation_key)
    ageByDepartment.set(link.source_department_key, values)
    ageUsage.set(link.source_age_validation_key, (ageUsage.get(link.source_age_validation_key) ?? 0) + 1)
  }
  if (!run.age_validation_available && (ageValidationByKey.size !== 0 || ageLinks.length !== 0)) ageValidationReferencesValid = false

  const categoryUsage = new Map()
  for (const department of departmentByKey.values()) {
    if (department.source_category_key !== null) categoryUsage.set(department.source_category_key, (categoryUsage.get(department.source_category_key) ?? 0) + 1)
  }

  const sorted = values => [...values].sort((left, right) => left.source_name.localeCompare(right.source_name) || left.source_department_key?.localeCompare(right.source_department_key) || left.source_category_key?.localeCompare(right.source_category_key) || left.source_product_code_key?.localeCompare(right.source_product_code_key) || left.source_tax_key?.localeCompare(right.source_tax_key) || left.source_age_validation_key?.localeCompare(right.source_age_validation_key))
  const normalizedAgeService = run.age_service_available
    ? (() => {
        if (!record(ageServiceSetting) || typeof ageServiceSetting.enabled !== 'boolean') fail('master_data_unavailable')
        return Object.freeze({ available: true, enabled: ageServiceSetting.enabled })
      })()
    : Object.freeze({ available: false, enabled: null })

  return Object.freeze({
    summary: Object.freeze({
      master_data_run_id: run.id,
      source_system: run.source_system,
      last_synced_at: run.collected_at,
      department_count: run.department_count,
      category_count: run.category_count,
      product_code_count: count(productCodeTotal),
      tax_definition_count: run.tax_definition_count,
      age_validation_count: run.age_validation_count,
    }),
    relationship_health: Object.freeze({
      category_references_valid: categoryReferencesValid,
      product_code_references_valid: productCodeReferencesValid,
      tax_references_valid: taxReferencesValid,
      age_validation_references_valid: ageValidationReferencesValid,
    }),
    restrictions: normalizedRestrictions(run),
    age_service: normalizedAgeService,
    departments: sorted([...departmentByKey.values()].map(department => Object.freeze({
      source_department_key: department.source_department_key,
      source_name: department.source_name,
      category: department.source_category_key === null ? null : categoryByKey.get(department.source_category_key) ?? null,
      product_code: productCodeByKey.get(department.source_product_code_key) ?? null,
      taxes: sorted((taxByDepartment.get(department.source_department_key) ?? []).map(value => taxByKey.get(value)).filter(Boolean)),
      age_validations: sorted((ageByDepartment.get(department.source_department_key) ?? []).map(value => ageValidationByKey.get(value)).filter(Boolean)),
    }))),
    categories: sorted([...categoryByKey.values()].map(category => Object.freeze({ ...category, department_usage_count: categoryUsage.get(category.source_category_key) ?? 0 }))),
    taxes: sorted([...taxByKey.values()].map(tax => Object.freeze({ ...tax, department_usage_count: taxUsage.get(tax.source_tax_key) ?? 0 }))),
    age_validations: sorted([...ageValidationByKey.values()].map(ageValidation => Object.freeze({ ...ageValidation, department_usage_count: ageUsage.get(ageValidation.source_age_validation_key) ?? 0 }))),
  })
}

export function normalizeSourceMasterDataProductCodes(rows) {
  return [...mapRows(rows, 'source_product_code_key', normalizeProductCode).values()]
    .sort((left, right) => left.source_product_code_key.localeCompare(right.source_product_code_key))
}

export const sourceMasterDataReadContract = Object.freeze({ defaultPageSize: DEFAULT_PAGE_SIZE, maxPageSize: MAX_PAGE_SIZE, maxSearchLength: MAX_SEARCH_LENGTH })
