import {
  lstat as nodeLstat,
  readFile as nodeReadFile,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { TextDecoder } from 'node:util'

import { createClient } from '@supabase/supabase-js'

import {
  CATALOG_PILOT_SNAPSHOT_MAX_BYTES,
  parseCatalogPilotSnapshot,
} from '../lib/pos/catalog-pilot-snapshot.mjs'
import { importCatalogPilotSnapshot } from '../lib/pos/catalog-pilot-local-importer.mjs'

const EXPECTED_SUPABASE_URL =
  'https://kurnxpzcgcvsjmxsqjok.supabase.co'
const MAX_ENV_BYTES = 64 * 1024
const SERVICE_KEY = /^[^\s\u0000-\u001f\u007f-\u009f]{32,4096}$/
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const COMMANDER_SOURCE_SYSTEM = 'commander'
const DEFAULT_COMMANDER_SNAPSHOT_PATH =
  'C:\\ProgramData\\StorePulse\\catalog-pilot\\commander-four-product-read-snapshot.json'
const COMMANDER_SNAPSHOT_PRODUCT_KEYS = [
  'upc',
  'modifier',
  'description',
  'price',
  'department',
]

function failure(code) {
  return {
    ok: false,
    selected_products_only: true,
    preview_created: false,
    promotion_completed: false,
    safe_error_code: code,
  }
}

function moduleFilePath(moduleUrl, platform) {
  let parsed
  try {
    parsed = new URL(moduleUrl)
  } catch {
    throw new Error('runner_package_invalid')
  }
  if (parsed.protocol !== 'file:') throw new Error('runner_package_invalid')

  let pathname
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    throw new Error('runner_package_invalid')
  }

  if (platform === 'win32') {
    if (!/^\/[A-Za-z]:\//.test(pathname)) {
      throw new Error('runner_package_invalid')
    }
    return pathname.slice(1).replaceAll('/', '\\')
  }

  return pathname
}

function ordinaryFile(info, maximumBytes) {
  return Boolean(
    info?.isFile?.()
    && !info?.isSymbolicLink?.()
    && !info?.isReparsePoint?.()
    && Number.isInteger(info.size)
    && info.size >= 1
    && info.size <= maximumBytes,
  )
}

async function readBoundedUtf8(filesystem, target, maximumBytes, code) {
  let info
  try {
    info = await filesystem.lstat(target)
  } catch {
    throw Object.assign(new Error(code), { code })
  }
  if (!ordinaryFile(info, maximumBytes)) {
    throw Object.assign(new Error(code), { code })
  }

  let bytes
  try {
    bytes = await filesystem.readFile(target)
  } catch {
    throw Object.assign(new Error(code), { code })
  }
  if (!Buffer.isBuffer(bytes) || bytes.length > maximumBytes) {
    throw Object.assign(new Error(code), { code })
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw Object.assign(new Error(code), { code })
  }
}

function unquote(value) {
  if (
    value.length >= 2
    && (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    )
  ) return value.slice(1, -1)
  return value
}

export function parseFixedLocalEnvironment(text) {
  if (typeof text !== 'string' || text.length < 1) {
    throw new Error('local_environment_invalid')
  }

  const values = new Map()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!match) continue
    const [, key, rawValue] = match

    if (
      key !== 'NEXT_PUBLIC_SUPABASE_URL'
      && key !== 'SUPABASE_SERVICE_ROLE_KEY'
    ) continue
    if (values.has(key)) throw new Error('local_environment_invalid')

    values.set(key, unquote(rawValue.trim()))
  }

  const supabaseUrl = values.get('NEXT_PUBLIC_SUPABASE_URL')
  const serviceRoleKey = values.get('SUPABASE_SERVICE_ROLE_KEY')

  if (
    supabaseUrl !== EXPECTED_SUPABASE_URL
    || typeof serviceRoleKey !== 'string'
    || !SERVICE_KEY.test(serviceRoleKey)
  ) throw new Error('local_environment_invalid')

  return Object.freeze({ supabaseUrl, serviceRoleKey })
}

export function parseCatalogPilotLocalImportCli(args) {
  const exact = (
    Array.isArray(args)
    && args.length === 7
    && args[0] === '--operation'
    && args[1] === 'import_selected_products_snapshot'
    && args[2] === '--approve'
    && args[3] === 'import_selected_products_snapshot'
    && args[4] === '--supervised'
    && args[5] === '--apply-products'
    && args[6] === '--selected-products-reviewed'
  )
  return Object.freeze({ approved: exact, cliInvalid: !exact })
}

export function catalogPilotLocalImportFixedPaths(
  moduleUrl = import.meta.url,
  platform = process.platform,
) {
  const pathApi = platform === 'win32' ? path.win32 : path
  const file = moduleFilePath(moduleUrl, platform)
  const scriptsDirectory = pathApi.dirname(file)

  if (
    pathApi.basename(scriptsDirectory) !== 'scripts'
    || pathApi.basename(file)
      !== 'import-commander-selected-product-snapshot.mjs'
  ) throw new Error('runner_package_invalid')

  const repositoryRoot = pathApi.dirname(scriptsDirectory)
  return Object.freeze({
    environmentPath: pathApi.join(repositoryRoot, '.env.local'),
    snapshotPath: pathApi.join(
      repositoryRoot,
      'connector',
      'research',
      'pilot',
      'input',
      'commander-selected-products-snapshot.json',
    ),
  })
}

export async function resolveCatalogPilotImportIdentity({
  client,
  snapshot,
}) {
  const storeResponse = await client
    .from('stores')
    .select('id, owner_id')
    .eq('id', snapshot.storeId)
    .maybeSingle()

  if (
    storeResponse.error
    || !storeResponse.data
    || storeResponse.data.id !== snapshot.storeId
    || storeResponse.data.owner_id !== snapshot.ownerId
  ) throw new Error('import_identity_invalid')

  const connectorResponse = await client
    .from('store_pos_connectors')
    .select('id, store_id, source_system, source_store_number, status')
    .eq('store_id', snapshot.storeId)
    .eq('source_system', snapshot.sourceSystem)
    .eq('source_store_number', snapshot.sourceStoreNumber)
    .eq('status', 'active')
    .maybeSingle()

  const row = connectorResponse.data
  if (
    connectorResponse.error
    || !row
    || row.store_id !== snapshot.storeId
    || row.source_system !== snapshot.sourceSystem
    || row.source_store_number !== snapshot.sourceStoreNumber
    || row.status !== 'active'
  ) throw new Error('import_identity_invalid')

  return Object.freeze({
    ownerId: snapshot.ownerId,
    connector: Object.freeze({
      id: row.id,
      storeId: row.store_id,
      sourceSystem: row.source_system,
      sourceStoreNumber: row.source_store_number,
    }),
  })
}

export async function runCatalogPilotLocalImportCli({
  args = process.argv.slice(2),
  moduleUrl = import.meta.url,
  platform = process.platform,
  filesystem = {
    lstat: nodeLstat,
    readFile: nodeReadFile,
  },
  clientFactory = (url, key) => createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  identityResolver = resolveCatalogPilotImportIdentity,
  importer = importCatalogPilotSnapshot,
  stdout = process.stdout,
} = {}) {
  const parsed = parseCatalogPilotLocalImportCli(args)
  let result

  if (parsed.cliInvalid) {
    result = failure('invalid_input')
  } else {
    try {
      const fixed = catalogPilotLocalImportFixedPaths(moduleUrl, platform)
      const [environmentText, snapshotText] = await Promise.all([
        readBoundedUtf8(
          filesystem,
          fixed.environmentPath,
          MAX_ENV_BYTES,
          'local_environment_missing',
        ),
        readBoundedUtf8(
          filesystem,
          fixed.snapshotPath,
          CATALOG_PILOT_SNAPSHOT_MAX_BYTES,
          'snapshot_missing',
        ),
      ])

      const environment = parseFixedLocalEnvironment(environmentText)
      const snapshot = parseCatalogPilotSnapshot(snapshotText)
      const client = clientFactory(
        environment.supabaseUrl,
        environment.serviceRoleKey,
      )
      if (!client || typeof client.rpc !== 'function') {
        throw new Error('local_environment_invalid')
      }

      const identity = await identityResolver({ client, snapshot })
      result = await importer({
        snapshotText,
        connector: identity.connector,
        ownerId: identity.ownerId,
        client,
      })
    } catch (error) {
      const allowed = new Set([
        'local_environment_missing',
        'local_environment_invalid',
        'snapshot_missing',
        'catalog_pilot_snapshot_invalid',
        'catalog_pilot_snapshot_hash_mismatch',
        'import_identity_invalid',
        'runner_package_invalid',
      ])
      result = failure(
        allowed.has(error?.code)
          ? error.code
          : allowed.has(error?.message)
            ? error.message
            : 'import_failed',
      )
    }
  }

  stdout.write(`${JSON.stringify(result)}\n`)
  return result
}

function commanderFailure({
  dryRun = true,
  expectedCount = 4,
  storeId = null,
  validatedCount = 0,
  errorCode,
}) {
  return Object.freeze({
    ok: false,
    dry_run: dryRun,
    expected_count: expectedCount,
    validated_count: validatedCount,
    upserted_count: 0,
    store_id: storeId,
    source_system: COMMANDER_SOURCE_SYSTEM,
    error_code: errorCode,
  })
}

function commanderSuccess({ dryRun, expectedCount, storeId, validatedCount, upsertedCount }) {
  return Object.freeze({
    ok: true,
    dry_run: dryRun,
    expected_count: expectedCount,
    validated_count: validatedCount,
    upserted_count: upsertedCount,
    store_id: storeId,
    source_system: COMMANDER_SOURCE_SYSTEM,
    error_code: null,
  })
}

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exactObjectKeys(value, expected) {
  return record(value)
    && Object.keys(value).length === expected.length
    && Object.keys(value).every((key, index) => key === expected[index])
}

function boundedText(value, maximum) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f-\u009f<>]/u.test(value)
}

export function parseCommanderSnapshotImportCli(args) {
  const result = {
    snapshotPath: DEFAULT_COMMANDER_SNAPSHOT_PATH,
    storeId: null,
    expectedCount: 4,
    dryRun: true,
    invalid: false,
  }
  let modeSpecified = false
  if (!Array.isArray(args)) return Object.freeze({ ...result, invalid: true })

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--dry-run') {
      if (modeSpecified) result.invalid = true
      modeSpecified = true
      result.dryRun = true
      continue
    }
    if (argument === '--apply') {
      if (modeSpecified) result.invalid = true
      modeSpecified = true
      result.dryRun = false
      continue
    }
    if (argument === '--snapshot' || argument === '--store-id' || argument === '--expected-count') {
      const value = args[index + 1]
      if (typeof value !== 'string' || value.length === 0) {
        result.invalid = true
        continue
      }
      index += 1
      if (argument === '--snapshot') {
        if (!path.win32.isAbsolute(value)) result.invalid = true
        else result.snapshotPath = value
      } else if (argument === '--store-id') {
        if (!UUID.test(value)) result.invalid = true
        else result.storeId = value.toLowerCase()
      } else {
        const parsed = Number(value)
        if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) result.invalid = true
        else result.expectedCount = parsed
      }
      continue
    }
    result.invalid = true
  }

  if (!result.storeId) result.invalid = true
  return Object.freeze(result)
}

export function validateCommanderSnapshot(text, expectedCount) {
  let snapshot
  try {
    snapshot = JSON.parse(text)
  } catch {
    throw new Error('snapshot_invalid')
  }
  if (!exactObjectKeys(snapshot, ['products']) || !Array.isArray(snapshot.products)) {
    throw new Error('snapshot_invalid')
  }
  if (snapshot.products.length !== expectedCount) throw new Error('snapshot_count_invalid')

  const products = []
  const identities = new Set()
  for (const product of snapshot.products) {
    if (!exactObjectKeys(product, COMMANDER_SNAPSHOT_PRODUCT_KEYS)) {
      throw new Error('snapshot_invalid')
    }
    if (
      typeof product.upc !== 'string'
      || !/^[0-9]{1,32}$/.test(product.upc)
      || typeof product.modifier !== 'string'
      || !/^[0-9]{1,64}$/.test(product.modifier)
      || !boundedText(product.description, 512)
      || !/^\d{1,10}\.\d{2}$/.test(product.price)
      || !boundedText(product.department, 64)
    ) throw new Error('snapshot_invalid')

    const sourceProductKey = `${product.upc}/${product.modifier}`
    if (identities.has(sourceProductKey)) throw new Error('snapshot_identity_invalid')
    identities.add(sourceProductKey)
    products.push(Object.freeze({
      upc: product.upc,
      modifier: product.modifier,
      description: product.description,
      price: product.price,
      department: product.department,
      sourceProductKey,
    }))
  }
  return Object.freeze(products)
}

export function normalizeCommanderSnapshotRows({ storeId, products, snapshotText, now = new Date() }) {
  const observedAt = now.toISOString()
  const snapshotHash = createHash('sha256').update(snapshotText, 'utf8').digest('hex')
  return Object.freeze(products.map((product) => Object.freeze({
    store_id: storeId,
    source_system: COMMANDER_SOURCE_SYSTEM,
    source_product_key: product.sourceProductKey,
    source_upc: product.upc,
    source_modifier: product.modifier,
    source_description: product.description,
    source_price: product.price,
    source_department: product.department,
    observation_status: 'observed',
    last_snapshot_hash: snapshotHash,
    observed_at: observedAt,
  })))
}

function applyEnvironment(environment) {
  const supabaseUrl = environment?.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = environment?.SUPABASE_SERVICE_ROLE_KEY
  if (
    typeof supabaseUrl !== 'string'
    || !/^https:\/\/[^\s/]+/i.test(supabaseUrl)
    || typeof serviceRoleKey !== 'string'
    || !SERVICE_KEY.test(serviceRoleKey)
  ) throw new Error('supabase_configuration_invalid')
  return Object.freeze({ supabaseUrl, serviceRoleKey })
}

export async function runCommanderSnapshotImportCli({
  args = process.argv.slice(2),
  filesystem = { lstat: nodeLstat, readFile: nodeReadFile },
  environment = process.env,
  clientFactory = (url, key) => createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  now = () => new Date(),
  stdout = process.stdout,
} = {}) {
  const cli = parseCommanderSnapshotImportCli(args)
  let result = commanderFailure({
    dryRun: cli.dryRun,
    expectedCount: cli.expectedCount,
    storeId: cli.storeId,
    errorCode: 'invalid_input',
  })

  if (!cli.invalid) {
    try {
      const snapshotText = await readBoundedUtf8(
        filesystem,
        cli.snapshotPath,
        CATALOG_PILOT_SNAPSHOT_MAX_BYTES,
        'snapshot_missing',
      )
      const products = validateCommanderSnapshot(snapshotText, cli.expectedCount)
      const rows = normalizeCommanderSnapshotRows({
        storeId: cli.storeId,
        products,
        snapshotText,
        now: now(),
      })
      if (cli.dryRun) {
        result = commanderSuccess({
          dryRun: true,
          expectedCount: cli.expectedCount,
          storeId: cli.storeId,
          validatedCount: rows.length,
          upsertedCount: 0,
        })
      } else {
        const credentials = applyEnvironment(environment)
        const client = clientFactory(credentials.supabaseUrl, credentials.serviceRoleKey)
        if (!client || typeof client.from !== 'function') throw new Error('supabase_configuration_invalid')
        const response = await client
          .from('pos_catalog_source_observations')
          .upsert(rows, { onConflict: 'store_id,source_system,source_product_key' })
          .select('id')
        if (response?.error) throw new Error('staging_write_failed')
        if (!Array.isArray(response?.data) || response.data.length !== cli.expectedCount) {
          throw new Error('staging_response_invalid')
        }
        result = commanderSuccess({
          dryRun: false,
          expectedCount: cli.expectedCount,
          storeId: cli.storeId,
          validatedCount: rows.length,
          upsertedCount: response.data.length,
        })
      }
    } catch (error) {
      const safeCodes = new Set([
        'snapshot_missing',
        'snapshot_invalid',
        'snapshot_count_invalid',
        'snapshot_identity_invalid',
        'supabase_configuration_invalid',
        'staging_write_failed',
        'staging_response_invalid',
      ])
      result = commanderFailure({
        dryRun: cli.dryRun,
        expectedCount: cli.expectedCount,
        storeId: cli.storeId,
        errorCode: safeCodes.has(error?.message) ? error.message : 'import_failed',
      })
    }
  }

  stdout.write(`${JSON.stringify(result)}\n`)
  return result
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const run = process.argv.slice(2).includes('--operation')
    ? runCatalogPilotLocalImportCli
    : runCommanderSnapshotImportCli
  run()
    .then((result) => { process.exitCode = result.ok ? 0 : 1 })
    .catch(() => {
      process.stdout.write(`${JSON.stringify(commanderFailure({ errorCode: 'import_failed' }))}\n`)
      process.exitCode = 1
    })
}
