function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function sameText(left, right) {
  return text(left).toLocaleLowerCase() === text(right).toLocaleLowerCase()
}

function mappedRows(rows, entityType) {
  return Array.isArray(rows)
    ? rows.filter((row) => record(row) && row.entity_type === entityType && row.status === 'mapped')
    : []
}

/**
 * Resolves current, unambiguous Commander department mappings to their
 * canonical StorePulse department names for Commander-linked edits.
 */
export function resolveMappedCommanderDepartments({ sourceDepartments, mappings, canonicalTargets }) {
  const canonicalDepartments = record(canonicalTargets) && Array.isArray(canonicalTargets.departments)
    ? canonicalTargets.departments
    : []
  const currentSourceKeys = new Set()
  for (const department of Array.isArray(sourceDepartments) ? sourceDepartments : []) {
    const sourceKey = record(department) ? text(department.source_department_key) : ''
    if (!/^\d{1,16}$/.test(sourceKey) || currentSourceKeys.has(sourceKey)) return []
    currentSourceKeys.add(sourceKey)
  }

  const canonicalById = new Map()
  for (const department of canonicalDepartments) {
    const id = record(department) ? text(department.id) : ''
    const name = record(department) ? text(department.name) : ''
    if (!id || !name || canonicalById.has(id)) return []
    canonicalById.set(id, name)
  }

  const sourceKeysByCanonicalId = new Map()
  for (const mapping of mappedRows(mappings, 'department')) {
    const sourceKey = text(mapping.source_key)
    const canonicalId = text(mapping.canonical_department_id)
    if (
      text(mapping.source_context_key)
      || !currentSourceKeys.has(sourceKey)
      || !canonicalById.has(canonicalId)
    ) continue
    const sourceKeys = sourceKeysByCanonicalId.get(canonicalId) ?? new Set()
    sourceKeys.add(sourceKey)
    sourceKeysByCanonicalId.set(canonicalId, sourceKeys)
  }

  const candidates = []
  for (const [canonicalId, sourceKeys] of sourceKeysByCanonicalId) {
    if (sourceKeys.size !== 1) continue
    candidates.push(Object.freeze({
      id: canonicalId,
      name: canonicalById.get(canonicalId),
      sourceDepartmentKey: [...sourceKeys][0],
    }))
  }
  const candidatesByName = new Map()
  for (const candidate of candidates) {
    const key = candidate.name.toLocaleLowerCase()
    const matches = candidatesByName.get(key) ?? []
    matches.push(candidate)
    candidatesByName.set(key, matches)
  }
  return Object.freeze(
    [...candidatesByName.values()]
      .filter((matches) => matches.length === 1)
      .map(([candidate]) => candidate)
      .sort((left, right) => left.name.localeCompare(right.name)),
  )
}

export function resolveMappedCommanderDepartmentName(sourceDepartmentKey, departmentOptions) {
  const sourceKey = text(sourceDepartmentKey)
  const matches = (Array.isArray(departmentOptions) ? departmentOptions : []).filter((option) => (
    record(option)
    && text(option.sourceDepartmentKey) === sourceKey
    && text(option.name)
  ))
  return matches.length === 1 ? text(matches[0].name) : ''
}

export function isMappedCommanderDepartmentSelectionValid(department, departmentOptions) {
  const selected = text(department)
  return Boolean(selected) && (Array.isArray(departmentOptions) ? departmentOptions : []).some((option) => (
    record(option) && sameText(option.name, selected)
  ))
}

/**
 * Resolves only categories that the current Commander department relationship
 * maps to canonical StorePulse categories for the selected department.
 */
export function resolveMappedCategoriesForDepartment({ departmentName, sourceDepartments, mappings, canonicalTargets }) {
  const selectedDepartmentName = text(departmentName)
  const canonicalDepartments = record(canonicalTargets) && Array.isArray(canonicalTargets.departments)
    ? canonicalTargets.departments
    : []
  const canonicalCategories = record(canonicalTargets) && Array.isArray(canonicalTargets.categories)
    ? canonicalTargets.categories
    : []

  const matchingCanonicalDepartments = canonicalDepartments.filter((department) => (
    record(department)
    && text(department.id)
    && sameText(department.name, selectedDepartmentName)
  ))
  if (!selectedDepartmentName || matchingCanonicalDepartments.length !== 1) return []

  const canonicalDepartment = matchingCanonicalDepartments[0]
  const sourceDepartmentByKey = new Map()
  for (const department of Array.isArray(sourceDepartments) ? sourceDepartments : []) {
    if (!record(department)) continue
    const key = text(department.source_department_key)
    if (!key || sourceDepartmentByKey.has(key)) return []
    sourceDepartmentByKey.set(key, department)
  }

  const categoryOptions = new Map()
  for (const departmentMapping of mappedRows(mappings, 'department')) {
    if (text(departmentMapping.source_context_key) || text(departmentMapping.canonical_department_id) !== text(canonicalDepartment.id)) continue

    const sourceDepartmentKey = text(departmentMapping.source_key)
    const sourceDepartment = sourceDepartmentByKey.get(sourceDepartmentKey)
    const sourceCategory = record(sourceDepartment) && record(sourceDepartment.category)
      ? sourceDepartment.category
      : null
    const sourceCategoryKey = sourceCategory ? text(sourceCategory.source_category_key) : ''
    if (!sourceCategoryKey) continue

    const matchingCategoryMappings = mappedRows(mappings, 'category').filter((categoryMapping) => (
      text(categoryMapping.source_key) === sourceCategoryKey
      && text(categoryMapping.source_context_key) === sourceDepartmentKey
    ))
    if (matchingCategoryMappings.length !== 1) continue

    const categoryId = text(matchingCategoryMappings[0].canonical_category_id)
    const canonicalCategory = canonicalCategories.find((category) => (
      record(category)
      && text(category.id) === categoryId
      && text(category.department_id) === text(canonicalDepartment.id)
      && text(category.name)
    ))
    if (!canonicalCategory) continue
    categoryOptions.set(categoryId, Object.freeze({ id: categoryId, name: text(canonicalCategory.name) }))
  }

  return Object.freeze([...categoryOptions.values()].sort((left, right) => left.name.localeCompare(right.name)))
}

export function resolveMappedCategorySelection(currentCategory, categoryOptions) {
  const options = Array.isArray(categoryOptions) ? categoryOptions : []
  if (options.length === 1) return options[0].name
  const current = text(currentCategory)
  return isMappedCategorySelectionValid(current, options) ? current : ''
}

export function isMappedCategorySelectionValid(category, categoryOptions) {
  const selected = text(category)
  return Boolean(selected) && Array.isArray(categoryOptions) && categoryOptions.some((option) => (
    record(option) && text(option.name) === selected
  ))
}
