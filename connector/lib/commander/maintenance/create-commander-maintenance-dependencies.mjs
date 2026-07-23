import { spawn as nodeSpawn } from 'node:child_process';
import { lstat as nodeLstat } from 'node:fs/promises';
import path from 'node:path';
import { runContainedCommanderValidate } from './contained-validate-runner.mjs';

const LAUNCHER_NAME = 'commander-validate-contained-launcher.ps1';
const POWERSHELL_PARTS = ['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'];

function safeFailure(code) {
  return {
    capture_succeeded: false,
    root: null,
    elements: [],
    cookie_elements: [],
    cookie_element_count: 0,
    safe_error_code: code,
  };
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function moduleFilePath(moduleUrl, platform) {
  let parsed;
  try { parsed = new URL(moduleUrl); } catch { fail('worker_not_available'); }
  if (parsed.protocol !== 'file:') fail('worker_not_available');
  const pathname = decodeURIComponent(parsed.pathname);
  if (platform === 'win32') {
    if (!/^\/[A-Za-z]:\//.test(pathname)) fail('worker_not_available');
    return pathname.slice(1).replaceAll('/', '\\');
  }
  return pathname;
}

function packageRootFromModuleUrl(moduleUrl, platform) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  const file = moduleFilePath(moduleUrl, platform);
  const segments = file.split(pathApi.sep);
  const connectorIndex = segments.findIndex((segment) => segment === 'Connector');
  if (connectorIndex < 1 || segments.slice(connectorIndex + 1).some((segment) => !segment)) fail('worker_not_available');
  const relative = segments.slice(connectorIndex + 1).join('/');
  const acceptedLocations = new Set([
    'maintenance/run-commander-maintenance.mjs',
    'lib/commander/maintenance/create-commander-maintenance-dependencies.mjs',
    'lib/commander/maintenance/create-read-test-product-dependencies.mjs',
  ]);
  if (!acceptedLocations.has(relative)) fail('worker_not_available');
  return segments.slice(0, connectorIndex).join(pathApi.sep) || pathApi.parse(file).root;
}

function validSystemRoot(value) {
  return typeof value === 'string'
    && value.length > 3
    && value.length <= 240
    && /^[A-Za-z]:\\/.test(value)
    && !value.includes('/')
    && !value.split('\\').includes('..')
    && !/[<>"|?*\u0000-\u001f]/.test(value);
}

async function ordinaryFile(filesystem, target) {
  try {
    const info = await filesystem.lstat(target);
    return Boolean(
      info?.isFile?.()
      && !info?.isSymbolicLink?.()
      && !info?.isReparsePoint?.(),
    );
  } catch {
    return false;
  }
}

function adaptSpawn(spawnProcess) {
  return (...argumentsList) => {
    const child = spawnProcess(...argumentsList);
    if (child?.result || !child?.once || !child?.stdout || !child?.stderr) return child;

    const stdout = [];
    const stderr = [];
    const result = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode) => resolve({
        exitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      }));
      child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    });
    return { result, kill: () => child.kill() };
  };
}

/**
 * Resolves only the package-owned launcher and fixed Windows PowerShell host.
 * The contained launcher owns configuration, DPAPI, SMTCommon, and Commander.
 */
export function createCommanderMaintenanceDependencies({
  moduleUrl = import.meta.url,
  platform = process.platform,
  environment = process.env,
  filesystem = { lstat: nodeLstat },
  spawnProcess = nodeSpawn,
} = {}) {
  const executeContainedValidate = async () => {
    if (platform !== 'win32' || !filesystem || typeof filesystem.lstat !== 'function' || typeof spawnProcess !== 'function') {
      return safeFailure('worker_not_available');
    }
    try {
      const pathApi = path.win32;
      const packageRoot = packageRootFromModuleUrl(moduleUrl, platform);
      const launcherPath = pathApi.join(packageRoot, 'CommanderDiagnostics', LAUNCHER_NAME);
      const systemRoot = environment?.SystemRoot;
      if (!validSystemRoot(systemRoot)
        || !(await ordinaryFile(filesystem, launcherPath))) return safeFailure('worker_not_available');

      const powershellPath = pathApi.join(systemRoot, ...POWERSHELL_PARTS);
      if (!(await ordinaryFile(filesystem, powershellPath))) return safeFailure('worker_not_available');

      return runContainedCommanderValidate({
        launcherPath,
        powershellPath,
        spawnProcess: adaptSpawn(spawnProcess),
      });
    } catch {
      return safeFailure('worker_not_available');
    }
  };

  // These preserve the existing injected diagnostic dependency shape. Production
  // execution uses executeContainedValidate above and never calls these stubs.
  return Object.freeze({
    configProvider: async () => ({ enabled: true }),
    credentialProvider: Object.freeze({}),
    runtimeValidator: async () => ({}),
    transportFactory: () => ({
      validate: async () => { fail('worker_not_available'); },
    }),
    executeContainedValidate,
  });
}

export const commanderMaintenancePackageRootFromModuleUrl = packageRootFromModuleUrl;
