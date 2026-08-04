import { spawn as nodeSpawn } from 'node:child_process';
import { lstat as nodeLstat, readFile as nodeReadFile } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import { readCommanderProduct } from '../commander-product-integration.mjs';
import { createCommanderOperationQueue } from '../runtime/commander-operation-queue.mjs';
import { authenticateCommanderCookie } from '../session/commander-cookie-auth-provider.mjs';
import { createCommanderSessionManager } from '../session/commander-session-manager.mjs';
import { resolveCommanderTlsTrust } from '../session/commander-tls-trust.mjs';
import {
  SELECTED_PREVIEW_MAX_ARTIFACT_BYTES,
  parseCommanderSelectedProductsArtifact,
  runCommanderSelectedProductPreview,
} from '../../catalog-sync/selected-product-preview-runner.mjs';

const PROGRAM_DATA = 'C:\\ProgramData';
const CONFIG_PATH = 'C:\\ProgramData\\StorePulse\\config.json';
const POWERSHELL_PATH =
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const COOKIE_WORKER_NAME = 'commander-auth-cookie-worker.ps1';
const SELECTION_ARTIFACT_NAME = 'commander-pilot-selected-products.json';
const MAX_CONFIG_BYTES = 64 * 1024;
const SOURCE_STORE_NUMBER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const COMMANDER_HOST = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;

const APPROVAL_KEYS = Object.freeze([
  'approved',
  'operation',
  'supervised',
  'preview_only',
  'selected_products_reviewed',
]);

function safeFailure(code, selectionCount = 0) {
  return Object.freeze({
    ok: false,
    preview_only: true,
    catalog_complete: false,
    preview_submitted: false,
    selection_count: selectionCount,
    received_product_count: 0,
    missing_selected_count: selectionCount,
    safe_error_code: code,
  });
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function moduleFilePath(moduleUrl, platform) {
  let parsed;
  try {
    parsed = new URL(moduleUrl);
  } catch {
    fail('runner_package_invalid');
  }

  if (parsed.protocol !== 'file:') fail('runner_package_invalid');

  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    fail('runner_package_invalid');
  }

  if (platform === 'win32') {
    if (!/^\/[A-Za-z]:\//.test(pathname)) fail('runner_package_invalid');
    return pathname.slice(1).replaceAll('/', '\\');
  }

  return pathname;
}

export function selectedProductPreviewPackageRootFromModuleUrl(
  moduleUrl,
  platform = process.platform,
) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  const file = moduleFilePath(moduleUrl, platform);
  const segments = file.split(pathApi.sep);
  const connectorIndex = segments.findIndex((segment) => segment === 'Connector');

  if (connectorIndex < 1) fail('runner_package_invalid');

  const relative = segments.slice(connectorIndex + 1).join('/');
  const acceptedLocations = new Set([
    'maintenance/run-commander-maintenance.mjs',
    'lib/commander/maintenance/create-selected-product-preview-dependencies.mjs',
  ]);

  if (!acceptedLocations.has(relative)) fail('runner_package_invalid');

  return segments.slice(0, connectorIndex).join(pathApi.sep)
    || pathApi.parse(file).root;
}

export function selectedProductPreviewPackagePaths(packageRoot) {
  if (typeof packageRoot !== 'string' || packageRoot.length < 3) {
    fail('runner_package_invalid');
  }

  return Object.freeze({
    cookieWorkerPath: path.win32.join(
      packageRoot,
      'CommanderDiagnostics',
      COOKIE_WORKER_NAME,
    ),
    selectionArtifactPath: path.win32.join(
      packageRoot,
      'Connector',
      'research',
      'pilot',
      SELECTION_ARTIFACT_NAME,
    ),
  });
}

async function ordinaryFile(filesystem, target, maximumBytes) {
  let info;
  try {
    info = await filesystem.lstat(target);
  } catch {
    return false;
  }

  return Boolean(
    info?.isFile?.()
    && !info?.isSymbolicLink?.()
    && !info?.isReparsePoint?.()
    && Number.isInteger(info.size)
    && info.size >= 1
    && info.size <= maximumBytes,
  );
}

async function readBoundedUtf8File(filesystem, target, maximumBytes, missingCode) {
  if (!(await ordinaryFile(filesystem, target, maximumBytes))) {
    fail(missingCode);
  }

  let bytes;
  try {
    bytes = await filesystem.readFile(target);
  } catch {
    fail(missingCode);
  }

  if (!Buffer.isBuffer(bytes)
    || bytes.length < 1
    || bytes.length > maximumBytes) {
    fail(missingCode);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(missingCode);
  }
}

function validateMachineConfig(value) {
  if (!isRecord(value)
    || typeof value.commander_ip !== 'string'
    || !COMMANDER_HOST.test(value.commander_ip)
    || typeof value.source_store_number !== 'string'
    || !SOURCE_STORE_NUMBER.test(value.source_store_number)
    || value.pos_publish_enabled !== false) {
    fail('machine_config_invalid');
  }

  const serialized = JSON.stringify(value);
  if (/(?:commander_username|commander_password|connector_token|"cookie")/i.test(
    serialized,
  )) {
    fail('machine_config_invalid');
  }

  return value;
}

function parseMachineConfig(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('machine_config_invalid');
  }

  return validateMachineConfig(value);
}

function validateApproval(input) {
  if (!isRecord(input) || !exactKeys(input, ['approval'])) {
    return 'invalid_input';
  }

  const approval = input.approval;
  if (!isRecord(approval)) return 'approval_required';
  if (approval.approved !== true) return 'approval_required';
  if (approval.operation !== 'preview_selected_products') {
    return 'approval_mismatch';
  }

  if (!exactKeys(approval, APPROVAL_KEYS)
    || approval.supervised !== true
    || approval.preview_only !== true
    || approval.selected_products_reviewed !== true) {
    return 'approval_invalid';
  }

  return null;
}

function adaptSpawn(spawnProcess) {
  return (...argumentsList) => {
    const child = spawnProcess(...argumentsList);

    if (child?.result
      || !child?.once
      || !child?.stdout
      || !child?.stderr) {
      return child;
    }

    const stdout = [];
    const stderr = [];

    const result = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode) => {
        resolve({
          exitCode,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
        });
      });
      child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    });

    return {
      result,
      kill: () => child.kill(),
    };
  };
}

function mapSetupError(error) {
  const code = error?.code;
  const allowed = new Set([
    'runner_package_invalid',
    'machine_config_missing',
    'machine_config_invalid',
    'selection_artifact_missing',
    'selection_artifact_invalid',
    'source_store_mismatch',
    'commander_trust_not_configured',
    'commander_ca_missing',
    'commander_server_certificate_missing',
    'commander_ca_hash_mismatch',
    'commander_certificate_hash_mismatch',
    'commander_certificate_invalid',
    'authentication_failed',
  ]);

  return allowed.has(code) ? code : 'internal_failure';
}

/**
 * Creates the fixed-path Commander read side of the selected-product preview
 * runner. StorePulse submission remains an injected dependency and is not
 * configured by this module.
 */
export function createSelectedProductPreviewDependencies({
  moduleUrl = import.meta.url,
  platform = process.platform,
  filesystem = {
    lstat: nodeLstat,
    readFile: nodeReadFile,
  },
  spawnProcess = nodeSpawn,
  commanderTransport,
  submitPreview,
  clock = () => new Date(),
  sessionManagerFactory = createCommanderSessionManager,
  queueFactory = createCommanderOperationQueue,
} = {}) {
  return Object.freeze({
    async executeSelectedProductPreview(input = {}) {
      const approvalError = validateApproval(input);
      if (approvalError) return safeFailure(approvalError);

      // Fail before file reads or Commander authentication until the separate,
      // reviewed StorePulse submission adapter is supplied.
      if (typeof submitPreview !== 'function') {
        return safeFailure('preview_transport_not_configured');
      }

      if (platform !== 'win32'
        || !filesystem
        || typeof filesystem.lstat !== 'function'
        || typeof filesystem.readFile !== 'function'
        || typeof spawnProcess !== 'function'
        || typeof sessionManagerFactory !== 'function'
        || typeof queueFactory !== 'function'
        || (commanderTransport !== undefined
          && typeof commanderTransport !== 'function')) {
        return safeFailure('runner_dependency_invalid');
      }

      let sessionManager;
      let selectionCount = 0;

      try {
        const packageRoot = selectedProductPreviewPackageRootFromModuleUrl(
          moduleUrl,
          platform,
        );
        const packagePaths = selectedProductPreviewPackagePaths(packageRoot);

        const configText = await readBoundedUtf8File(
          filesystem,
          CONFIG_PATH,
          MAX_CONFIG_BYTES,
          'machine_config_missing',
        );
        const selectionText = await readBoundedUtf8File(
          filesystem,
          packagePaths.selectionArtifactPath,
          SELECTED_PREVIEW_MAX_ARTIFACT_BYTES,
          'selection_artifact_missing',
        );

        const config = parseMachineConfig(configText);

        let selection;
        try {
          selection = parseCommanderSelectedProductsArtifact(selectionText);
        } catch {
          fail('selection_artifact_invalid');
        }

        selectionCount = selection.selectedProducts.length;

        if (selection.store.sourceStoreNumber !== config.source_store_number) {
          fail('source_store_mismatch');
        }

        if (!(await ordinaryFile(
          filesystem,
          POWERSHELL_PATH,
          4 * 1024 * 1024,
        ))
          || !(await ordinaryFile(
            filesystem,
            packagePaths.cookieWorkerPath,
            512 * 1024,
          ))) {
          fail('authentication_failed');
        }

        const trust = await resolveCommanderTlsTrust({
          config,
          programData: PROGRAM_DATA,
          filesystem,
        });

        sessionManager = sessionManagerFactory({
          authenticate: () => authenticateCommanderCookie({
            powershellPath: POWERSHELL_PATH,
            workerPath: packagePaths.cookieWorkerPath,
            spawnProcess: adaptSpawn(spawnProcess),
          }),
        });

        const queue = queueFactory();

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
              };

              if (commanderTransport) {
                request.transport = commanderTransport;
              }

              return readCommanderProduct(request);
            }),
          );

          if (queued?.error_code === 'commander_connection_failed') {
            return { status: 'session_failed' };
          }

          if (queued?.error_code) {
            return { status: 'readback_failed' };
          }

          return queued;
        };

        return await runCommanderSelectedProductPreview({
          selectionArtifact: selectionText,
          readSelectedProduct,
          submitPreview,
          clock,
        });
      } catch (error) {
        return safeFailure(mapSetupError(error), selectionCount);
      } finally {
        try {
          sessionManager?.shutdown?.();
        } catch {
          // The public result must remain secret-free even if cleanup fails.
        }
      }
    },
  });
}

export const SELECTED_PRODUCT_PREVIEW_FIXED_PATHS = Object.freeze({
  configPath: CONFIG_PATH,
  programData: PROGRAM_DATA,
  powershellPath: POWERSHELL_PATH,
  cookieWorkerName: COOKIE_WORKER_NAME,
  selectionArtifactName: SELECTION_ARTIFACT_NAME,
});
