import { spawn as nodeSpawn } from 'node:child_process';
import {
  lstat as nodeLstat,
  readFile as nodeReadFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  createIdempotencyStore,
} from '../commander-product-integration.mjs';

import {
  defaultTransport,
} from '../commander-naxml-client.mjs';

import {
  createCommanderOperationQueue,
} from '../runtime/commander-operation-queue.mjs';

import {
  authenticateCommanderCookie,
} from '../session/commander-cookie-auth-provider.mjs';

import {
  createCommanderSessionManager,
} from '../session/commander-session-manager.mjs';

import {
  resolveCommanderTlsTrust,
} from '../session/commander-tls-trust.mjs';

import {
  commanderMaintenancePackageRootFromModuleUrl,
} from './create-commander-maintenance-dependencies.mjs';

import {
  runVerifyTestPriceWrite,
} from './verify-test-price-write.mjs';

const PROGRAM_DATA = 'C:\\ProgramData';
const CONFIG_PATH = 'C:\\ProgramData\\StorePulse\\config.json';
const POWERSHELL_PATH =
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const COOKIE_WORKER = 'commander-auth-cookie-worker.ps1';

const TRUST_CODES = new Set([
  'commander_trust_not_configured',
  'commander_ca_missing',
  'commander_server_certificate_missing',
  'commander_ca_hash_mismatch',
  'commander_certificate_hash_mismatch',
  'commander_certificate_invalid',
]);

function safe(code) {
  return Object.freeze({
    write_succeeded: false,
    authenticated: false,
    tls_verified: false,
    product_found: false,
    identity_matched: false,
    expected_price_matched: false,
    write_attempted: false,
    write_accepted: false,
    readback_succeeded: false,
    readback_matched: false,
    idempotent: false,
    safe_fields_present: Object.freeze([]),
    safe_error_code: code,
  });
}

function validCommanderHost(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(value)
  );
}

function adaptSpawn(spawnProcess) {
  return (...args) => {
    const child = spawnProcess(...args);

    if (
      child?.result ||
      !child?.once ||
      !child?.stdout ||
      !child?.stderr
    ) {
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

      child.stdout.on('data', (chunk) => {
        stdout.push(Buffer.from(chunk));
      });

      child.stderr.on('data', (chunk) => {
        stderr.push(Buffer.from(chunk));
      });
    });

    return {
      result,
      kill: () => child.kill(),
    };
  };
}

async function ordinaryFile(filesystem, target) {
  try {
    const info = await filesystem.lstat(target);

    return (
      info?.isFile?.() &&
      !info?.isSymbolicLink?.() &&
      !info?.isReparsePoint?.()
    );
  } catch {
    return false;
  }
}

async function loadFixedConfig(filesystem) {
  if (!(await ordinaryFile(filesystem, CONFIG_PATH))) {
    const error = new Error('commander_trust_not_configured');
    error.code = error.message;
    throw error;
  }

  let value;

  try {
    value = JSON.parse(
      (await filesystem.readFile(CONFIG_PATH, 'utf8')).toString(),
    );
  } catch {
    const error = new Error('commander_trust_not_configured');
    error.code = error.message;
    throw error;
  }

  if (
    !value ||
    Array.isArray(value) ||
    !validCommanderHost(value.commander_ip)
  ) {
    const error = new Error('commander_trust_not_configured');
    error.code = error.message;
    throw error;
  }

  return value;
}

/**
 * Creates the guarded controlled-test price workflow using only standard,
 * fixed machine paths. No caller may provide a Commander origin, certificate
 * path, credential path, worker path, or session cookie.
 */
export function createVerifyTestPriceWriteDependencies({
  moduleUrl = import.meta.url,
  platform = process.platform,
  filesystem = {
    lstat: nodeLstat,
    readFile: nodeReadFile,
  },
  spawnProcess = nodeSpawn,
  transport = defaultTransport,
} = {}) {
  const queue = createCommanderOperationQueue();
  const idempotencyStore = createIdempotencyStore();

  return Object.freeze({
    async executeVerifyTestPriceWrite(input) {
      if (
        platform !== 'win32' ||
        !filesystem ||
        typeof filesystem.lstat !== 'function' ||
        typeof filesystem.readFile !== 'function' ||
        typeof spawnProcess !== 'function' ||
        typeof transport !== 'function'
      ) {
        return safe('internal_failure');
      }

      let sessionManager;

      try {
        const root = commanderMaintenancePackageRootFromModuleUrl(
          moduleUrl,
          platform,
        );

        const workerPath = path.win32.join(
          root,
          'CommanderDiagnostics',
          COOKIE_WORKER,
        );

        if (
          !(await ordinaryFile(filesystem, workerPath)) ||
          !(await ordinaryFile(filesystem, POWERSHELL_PATH))
        ) {
          return safe('authentication_failed');
        }

        const config = await loadFixedConfig(filesystem);

        const trust = await resolveCommanderTlsTrust({
          config,
          programData: PROGRAM_DATA,
          filesystem,
        });

        sessionManager = createCommanderSessionManager({
          authenticate: () =>
            authenticateCommanderCookie({
              powershellPath: POWERSHELL_PATH,
              workerPath,
              spawnProcess: adaptSpawn(spawnProcess),
            }),
        });

        return await runVerifyTestPriceWrite({
          input,
          queue,
          sessionManager,
          trust,
          origin: `https://${config.commander_ip}`,
          transport,
          idempotencyStore,
        });
      } catch (error) {
        const code = error?.code;

        return safe(
          TRUST_CODES.has(code)
            ? code
            : 'internal_failure',
        );
      } finally {
        sessionManager?.shutdown();
      }
    },
  });
}

export const VERIFY_TEST_PRICE_WRITE_FIXED_PATHS = Object.freeze({
  configPath: CONFIG_PATH,
  programData: PROGRAM_DATA,
  powershellPath: POWERSHELL_PATH,
  cookieWorkerName: COOKIE_WORKER,
});