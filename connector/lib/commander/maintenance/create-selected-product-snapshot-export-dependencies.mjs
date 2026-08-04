import { randomUUID } from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'
import {
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  readFile as nodeReadFile,
  rename as nodeRename,
  unlink as nodeUnlink,
  writeFile as nodeWriteFile,
} from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'

import { runCommanderSelectedProductSnapshotExport } from '../../catalog-sync/selected-product-snapshot-exporter.mjs'
import { readCommanderVpluProduct } from '../commander-vplu-read-client.mjs'
import { createCommanderOperationQueue } from '../runtime/commander-operation-queue.mjs'
import { authenticateCommanderCookie } from '../session/commander-cookie-auth-provider.mjs'
import { createCommanderSessionManager } from '../session/commander-session-manager.mjs'
import { resolveCommanderTlsTrust } from '../session/commander-tls-trust.mjs'
import {
  SELECTED_PREVIEW_MAX_ARTIFACT_BYTES,
} from '../../catalog-sync/selected-product-preview-runner.mjs'
import {
  CATALOG_PILOT_SNAPSHOT_MAX_BYTES,
} from '../../../../lib/pos/catalog-pilot-snapshot.mjs'

const PROGRAM_DATA = 'C:\\ProgramData'
const CONFIG_PATH = 'C:\\ProgramData\\StorePulse\\config.json'
const OUTBOX_PATH =
  'C:\\ProgramData\\StorePulse\\catalog-pilot\\outbox'
const POWERSHELL_PATH =
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const COOKIE_WORKER_NAME = 'commander-auth-cookie-worker.ps1'
const SELECTION_ARTIFACT_NAME = 'commander-pilot-selected-products.json'
const MAX_CONFIG_BYTES = 64 * 1024
const SOURCE_STORE_NUMBER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const COMMANDER_HOST = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/
const SHA256 = /^[0-9a-f]{64}$/

function fail(code) {
  const error = new Error(code)
  error.code = code
  throw error
}

function safeFailure(code, selectionCount = 0) {
  return Object.freeze({
    ok: false,
    read_only: true,
    snapshot_written: false,
    selection_count: selectionCount,
    received_product_count: 0,
    safe_error_code: code,
  })
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function moduleFilePath(moduleUrl, platform) {
  let parsed
  try {
    parsed = new URL(moduleUrl)
  } catch {
    fail('runner_package_invalid')
  }
  if (parsed.protocol !== 'file:') fail('runner_package_invalid')

  let pathname
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    fail('runner_package_invalid')
  }

  if (platform === 'win32') {
    if (!/^\/[A-Za-z]:\//.test(pathname)) fail('runner_package_invalid')
    return pathname.slice(1).replaceAll('/', '\\')
  }

  return pathname
}

export function selectedProductSnapshotPackageContextFromModuleUrl(
  moduleUrl,
  platform = process.platform,
) {
  const pathApi = platform === 'win32' ? path.win32 : path
  const file = moduleFilePath(moduleUrl, platform)
  const segments = file.split(pathApi.sep)
  const connectorIndex = segments.findIndex(
    (segment) => segment === 'Connector' || segment === 'connector',
  )
  if (connectorIndex < 1) fail('runner_package_invalid')

  const relative = segments.slice(connectorIndex + 1).join('/')
  const accepted = new Set([
    'maintenance/run-selected-product-snapshot-export.mjs',
    'lib/commander/maintenance/create-selected-product-snapshot-export-dependencies.mjs',
  ])
  if (!accepted.has(relative)) fail('runner_package_invalid')

  return Object.freeze({
    packageRoot:
      segments.slice(0, connectorIndex).join(pathApi.sep)
      || pathApi.parse(file).root,
    connectorDirectory: segments[connectorIndex],
  })
}

export function selectedProductSnapshotPackagePaths(context) {
  if (
    !isRecord(context)
    || typeof context.packageRoot !== 'string'
    || context.packageRoot.length < 3
    || !['Connector', 'connector'].includes(context.connectorDirectory)
  ) fail('runner_package_invalid')

  return Object.freeze({
    cookieWorkerPath: path.win32.join(
      context.packageRoot,
      'CommanderDiagnostics',
      COOKIE_WORKER_NAME,
    ),
    selectionArtifactPath: path.win32.join(
      context.packageRoot,
      context.connectorDirectory,
      'research',
      'pilot',
      SELECTION_ARTIFACT_NAME,
    ),
  })
}

function ordinaryFileInfo(info, maximumBytes) {
  return Boolean(
    info?.isFile?.()
    && !info?.isSymbolicLink?.()
    && !info?.isReparsePoint?.()
    && Number.isInteger(info.size)
    && info.size >= 1
    && info.size <= maximumBytes,
  )
}

async function readBoundedUtf8File(
  filesystem,
  target,
  maximumBytes,
  missingCode,
) {
  let info
  try {
    info = await filesystem.lstat(target)
  } catch {
    fail(missingCode)
  }
  if (!ordinaryFileInfo(info, maximumBytes)) fail(missingCode)

  let bytes
  try {
    bytes = await filesystem.readFile(target)
  } catch {
    fail(missingCode)
  }
  if (
    !Buffer.isBuffer(bytes)
    || bytes.length < 1
    || bytes.length > maximumBytes
  ) fail(missingCode)

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    fail(missingCode)
  }
}

export function validateSelectedProductSnapshotMachineConfig(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    fail('machine_config_invalid')
  }

  const hasPublishFlag = (
    isRecord(value)
    && Object.hasOwn(value, 'pos_publish_enabled')
  )

  const publishFlag = hasPublishFlag
    ? value.pos_publish_enabled
    : false

  if (
    !isRecord(value)
    || typeof value.commander_ip !== 'string'
    || !COMMANDER_HOST.test(value.commander_ip)
    || typeof value.source_store_number !== 'string'
    || !SOURCE_STORE_NUMBER.test(value.source_store_number)
    || (hasPublishFlag && typeof publishFlag !== 'boolean')
    || publishFlag !== false
    || /(?:commander_username|commander_password|connector_token|"cookie")/i.test(
      JSON.stringify(value),
    )
  ) fail('machine_config_invalid')

  return Object.freeze({
    ...value,
    pos_publish_enabled: false,
  })
}

function adaptSpawn(spawnProcess) {
  return (...args) => {
    const child = spawnProcess(...args)
    if (child?.result || !child?.once || !child?.stdout || !child?.stderr) {
      return child
    }

    const stdout = []
    const stderr = []
    const result = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (exitCode) => {
        resolve({
          exitCode,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
        })
      })
      child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
      child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    })

    return { result, kill: () => child.kill() }
  }
}

async function requireOrdinaryDirectory(filesystem, target) {
  let info
  try {
    info = await filesystem.lstat(target)
  } catch {
    fail('snapshot_outbox_invalid')
  }

  if (
    !info?.isDirectory?.()
    || info?.isSymbolicLink?.()
    || info?.isReparsePoint?.()
  ) fail('snapshot_outbox_invalid')
}

export async function writeFixedSelectedProductSnapshot({
  contents,
  snapshotHash,
  filesystem = {
    lstat: nodeLstat,
    mkdir: nodeMkdir,
    readFile: nodeReadFile,
    rename: nodeRename,
    unlink: nodeUnlink,
    writeFile: nodeWriteFile,
  },
  randomId = randomUUID,
} = {}) {
  const byteLength = typeof contents === 'string'
    ? Buffer.byteLength(contents, 'utf8')
    : -1

  if (
    byteLength < 1
    || byteLength > CATALOG_PILOT_SNAPSHOT_MAX_BYTES
    || typeof snapshotHash !== 'string'
    || !SHA256.test(snapshotHash)
    || !filesystem
    || typeof filesystem.lstat !== 'function'
    || typeof filesystem.mkdir !== 'function'
    || typeof filesystem.readFile !== 'function'
    || typeof filesystem.rename !== 'function'
    || typeof filesystem.unlink !== 'function'
    || typeof filesystem.writeFile !== 'function'
    || typeof randomId !== 'function'
  ) fail('snapshot_write_failed')

  try {
    await filesystem.mkdir(OUTBOX_PATH, { recursive: true })
  } catch {
    fail('snapshot_outbox_invalid')
  }

  for (const directory of [
    'C:\\ProgramData\\StorePulse',
    'C:\\ProgramData\\StorePulse\\catalog-pilot',
    OUTBOX_PATH,
  ]) {
    await requireOrdinaryDirectory(filesystem, directory)
  }

  const finalPath = path.win32.join(
    OUTBOX_PATH,
    `commander-selected-products-snapshot-${snapshotHash}.json`,
  )

  try {
    const existingInfo = await filesystem.lstat(finalPath)
    if (!ordinaryFileInfo(existingInfo, CATALOG_PILOT_SNAPSHOT_MAX_BYTES)) {
      fail('snapshot_write_failed')
    }

    const existing = await filesystem.readFile(finalPath)
    if (!Buffer.isBuffer(existing) || existing.toString('utf8') !== contents) {
      fail('snapshot_write_failed')
    }

    return Object.freeze({ written: true, location: finalPath })
  } catch (error) {
    if (error?.code !== 'ENOENT') fail('snapshot_write_failed')
  }

  const nonce = randomId()
  if (
    typeof nonce !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(nonce)
  ) fail('snapshot_write_failed')

  const temporaryPath = path.win32.join(
    OUTBOX_PATH,
    `.snapshot-${snapshotHash}-${nonce}.tmp`,
  )

  try {
    await filesystem.writeFile(
      temporaryPath,
      Buffer.from(contents, 'utf8'),
      { flag: 'wx' },
    )
    const info = await filesystem.lstat(temporaryPath)
    if (!ordinaryFileInfo(info, CATALOG_PILOT_SNAPSHOT_MAX_BYTES)) {
      fail('snapshot_write_failed')
    }
    await filesystem.rename(temporaryPath, finalPath)
  } catch {
    try {
      await filesystem.unlink(temporaryPath)
    } catch {
      // Best-effort cleanup only.
    }
    fail('snapshot_write_failed')
  }

  return Object.freeze({ written: true, location: finalPath })
}

function mapSetupError(error) {
  const allowed = new Set([
    'runner_package_invalid',
    'machine_config_missing',
    'machine_config_invalid',
    'selection_artifact_missing',
    'source_store_mismatch',
    'authentication_failed',
    'commander_trust_not_configured',
    'commander_ca_missing',
    'commander_server_certificate_missing',
    'commander_ca_hash_mismatch',
    'commander_certificate_hash_mismatch',
    'commander_certificate_invalid',
    'snapshot_outbox_invalid',
    'snapshot_write_failed',
  ])
  return allowed.has(error?.code) ? error.code : 'internal_failure'
}

export function createSelectedProductSnapshotExportDependencies({
  moduleUrl = import.meta.url,
  platform = process.platform,
  filesystem = {
    lstat: nodeLstat,
    mkdir: nodeMkdir,
    readFile: nodeReadFile,
    rename: nodeRename,
    unlink: nodeUnlink,
    writeFile: nodeWriteFile,
  },
  spawnProcess = nodeSpawn,
  commanderTransport,
  clock = () => new Date(),
  randomId = randomUUID,
  sessionManagerFactory = createCommanderSessionManager,
  queueFactory = createCommanderOperationQueue,
} = {}) {
  return Object.freeze({
    async executeSelectedProductSnapshotExport(input = {}) {
      if (
        platform !== 'win32'
        || !filesystem
        || typeof filesystem.lstat !== 'function'
        || typeof filesystem.readFile !== 'function'
        || typeof spawnProcess !== 'function'
        || typeof sessionManagerFactory !== 'function'
        || typeof queueFactory !== 'function'
        || (
          commanderTransport !== undefined
          && typeof commanderTransport !== 'function'
        )
      ) return safeFailure('runner_dependency_invalid')

      let sessionManager
      let selectionCount = 0

      try {
        const context =
          selectedProductSnapshotPackageContextFromModuleUrl(
            moduleUrl,
            platform,
          )
        const packagePaths = selectedProductSnapshotPackagePaths(context)

        const configText = await readBoundedUtf8File(
          filesystem,
          CONFIG_PATH,
          MAX_CONFIG_BYTES,
          'machine_config_missing',
        )
        const selectionText = await readBoundedUtf8File(
          filesystem,
          packagePaths.selectionArtifactPath,
          SELECTED_PREVIEW_MAX_ARTIFACT_BYTES,
          'selection_artifact_missing',
        )

        const config = validateSelectedProductSnapshotMachineConfig(configText)
        let selectionJson
        try {
          selectionJson = JSON.parse(selectionText)
        } catch {
          fail('selection_artifact_missing')
        }

        selectionCount = Array.isArray(selectionJson?.products)
          ? selectionJson.products.length
          : 0

        if (
          selectionJson?.store?.source_store_number
          !== config.source_store_number
        ) fail('source_store_mismatch')

        for (const target of [
          POWERSHELL_PATH,
          packagePaths.cookieWorkerPath,
        ]) {
          let info
          try {
            info = await filesystem.lstat(target)
          } catch {
            fail('authentication_failed')
          }
          if (!ordinaryFileInfo(
            info,
            target === POWERSHELL_PATH
              ? 4 * 1024 * 1024
              : 512 * 1024,
          )) fail('authentication_failed')
        }

        const trust = await resolveCommanderTlsTrust({
          config,
          programData: PROGRAM_DATA,
          filesystem,
        })

        sessionManager = sessionManagerFactory({
          authenticate: () => authenticateCommanderCookie({
            powershellPath: POWERSHELL_PATH,
            workerPath: packagePaths.cookieWorkerPath,
            spawnProcess: adaptSpawn(spawnProcess),
          }),
        })

        const queue = queueFactory()
        const readSelectedProduct = async ({ upc, modifier }) => {
          const queued = await queue.enqueue(
            { operationType: 'read_product_catalog' },
            async () => sessionManager.withSession(async (cookie) => {
              const request = {
                origin: `https://${config.commander_ip}`,
                trust,
                sessionCookie: cookie,
                upc,
                modifier,
              }
              if (commanderTransport) request.transport = commanderTransport
              return readCommanderVpluProduct(request)
            }),
          )

          if (queued?.error_code === 'commander_connection_failed') {
            return { status: 'session_failed' }
          }
          if (queued?.error_code) return { status: 'readback_failed' }
          return queued
        }

        return await runCommanderSelectedProductSnapshotExport({
          approval: input.approval,
          selectionArtifact: selectionText,
          readSelectedProduct,
          writeSnapshot: ({ contents, snapshotHash }) =>
            writeFixedSelectedProductSnapshot({
              contents,
              snapshotHash,
              filesystem,
              randomId,
            }),
          clock,
        })
      } catch (error) {
        return safeFailure(mapSetupError(error), selectionCount)
      } finally {
        try {
          sessionManager?.shutdown?.()
        } catch {
          // Public result remains secret-free.
        }
      }
    },
  })
}

export const SELECTED_PRODUCT_SNAPSHOT_FIXED_PATHS = Object.freeze({
  configPath: CONFIG_PATH,
  outboxPath: OUTBOX_PATH,
  powershellPath: POWERSHELL_PATH,
  cookieWorkerName: COOKIE_WORKER_NAME,
  selectionArtifactName: SELECTION_ARTIFACT_NAME,
})
