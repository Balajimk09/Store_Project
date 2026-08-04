const COMMANDER_SOURCE_SYSTEM = 'commander'
const MAX_OBSERVATIONS = 100

const OBSERVATION_SELECT = [
  'id',
  'source_product_key',
  'source_upc',
  'source_modifier',
  'source_description',
  'source_price',
  'source_department',
  'observation_status',
  'observed_at',
  'updated_at',
].join(', ')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PRICE_PATTERN = /^(0|[1-9][0-9]{0,9})(?:\.([0-9]{1,2}))?$/
const STATUS_VALUES = new Set(['observed', 'reviewed', 'imported', 'rejected'])

export class CommanderObservationReviewError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function fail(code) {
  throw new CommanderObservationReviewError(code)
}

function boundedText(value, maxLength) {
  if (typeof value !== 'string') fail('observations_unavailable')
  const text = value.trim()
  if (!text || text.length > maxLength) fail('observations_unavailable')
  return text
}

function normalizedPrice(value) {
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string') fail('observations_unavailable')

  const match = PRICE_PATTERN.exec(text.trim())
  if (!match) fail('observations_unavailable')
  return `${match[1]}.${(match[2] || '').padEnd(2, '0')}`
}

function timestamp(value) {
  const text = boundedText(value, 64)
  if (!Number.isFinite(Date.parse(text))) fail('observations_unavailable')
  return text
}

export function normalizeCommanderObservation(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail('observations_unavailable')

  const id = boundedText(row.id, 64)
  if (!UUID_PATTERN.test(id)) fail('observations_unavailable')

  const upc = boundedText(row.source_upc, 32)
  const modifier = boundedText(row.source_modifier, 64)
  if (!/^[0-9]+$/.test(upc) || !/^[0-9]+$/.test(modifier)) fail('observations_unavailable')

  const sourceProductKey = boundedText(row.source_product_key, 256)
  if (sourceProductKey !== `${upc}/${modifier}`) fail('observations_unavailable')

  const status = boundedText(row.observation_status, 32)
  if (!STATUS_VALUES.has(status)) fail('observations_unavailable')

  return Object.freeze({
    id,
    source_product_key: sourceProductKey,
    upc,
    modifier,
    description: boundedText(row.source_description, 512),
    price: normalizedPrice(row.source_price),
    department: boundedText(row.source_department, 64),
    status,
    observed_at: timestamp(row.observed_at),
    updated_at: timestamp(row.updated_at),
  })
}

export async function listCommanderObservationReview({ client, userId, storeId } = {}) {
  if (!client || typeof client.from !== 'function') fail('observations_unavailable')
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) fail('unauthorized')
  if (typeof storeId !== 'string' || !UUID_PATTERN.test(storeId)) fail('invalid_store')

  const { data: store, error: storeError } = await client
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', userId)
    .maybeSingle()

  if (storeError) fail('observations_unavailable')
  if (!store) fail('forbidden')

  const { data, error } = await client
    .from('pos_catalog_source_observations')
    .select(OBSERVATION_SELECT)
    .eq('store_id', storeId)
    .eq('source_system', COMMANDER_SOURCE_SYSTEM)
    .order('observed_at', { ascending: false })
    .order('source_product_key', { ascending: true })
    .limit(MAX_OBSERVATIONS)

  if (error || !Array.isArray(data)) fail('observations_unavailable')

  return Object.freeze(data.map(normalizeCommanderObservation))
}

export const commanderObservationReviewContract = Object.freeze({
  sourceSystem: COMMANDER_SOURCE_SYSTEM,
  limit: MAX_OBSERVATIONS,
  select: OBSERVATION_SELECT,
})
