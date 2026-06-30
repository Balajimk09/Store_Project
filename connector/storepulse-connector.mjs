#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPPORTED_EXTENSIONS = new Set(['.html', '.htm', '.xml', '.csv', '.xlsx', '.xls', '.zip']);
const DEFAULT_POLL_SECONDS = 60;
const STABILITY_WAIT_MS = 3000;
const REQUEST_TIMEOUT_MS = 120000;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(scriptDir, '.env');
const statePath = path.join(scriptDir, '.upload-state.json');

let shuttingDown = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadLocalEnvFile() {
  if (!existsSync(envPath)) return;

  const text = await readFile(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function stripTrailingSlash(value) {
  return value.replace(/[\\/]+$/, '');
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requiredConfigValue(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    return null;
  }
  return value;
}

async function loadConfig() {
  await loadLocalEnvFile();

  const apiUrl = requiredConfigValue('STOREPULSE_API_URL');
  const token = requiredConfigValue('STOREPULSE_CONNECTOR_TOKEN');
  const watchFolder = requiredConfigValue('STOREPULSE_WATCH_FOLDER');

  if (!apiUrl || !token || !watchFolder) {
    console.error('Connector configuration is incomplete. Fix connector/.env or exported environment variables and try again.');
    process.exit(1);
  }

  return {
    apiUrl: stripTrailingSlash(apiUrl),
    token,
    watchFolder,
    archiveFolder: String(process.env.STOREPULSE_ARCHIVE_FOLDER || '').trim() || null,
    pollSeconds: parsePositiveInteger(process.env.STOREPULSE_POLL_SECONDS, DEFAULT_POLL_SECONDS),
    dryRun: parseBoolean(process.env.STOREPULSE_DRY_RUN, false),
    once: parseBoolean(process.env.STOREPULSE_ONCE, false),
  };
}

async function readState() {
  try {
    const text = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.uploaded && typeof parsed.uploaded === 'object') {
      return parsed;
    }
  } catch {
    // Local state is best effort only. If missing or corrupted, the server remains authoritative.
  }

  return { version: 1, uploaded: {} };
}

async function writeState(state) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function fileExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

async function listCandidateFiles(watchFolder) {
  let entries;
  try {
    entries = await readdir(watchFolder, { withFileTypes: true });
  } catch (error) {
    console.error(`Could not read watch folder: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(watchFolder, entry.name))
    .filter((filePath) => SUPPORTED_EXTENSIONS.has(fileExtension(filePath)));
}

async function stableFileStats(filePath) {
  try {
    const first = await stat(filePath);
    await sleep(STABILITY_WAIT_MS);
    const second = await stat(filePath);

    if (first.size !== second.size || first.mtimeMs !== second.mtimeMs) {
      return null;
    }

    return second;
  } catch {
    return null;
  }
}

async function hashFile(filePath) {
  const buffer = await readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

function timestampForFileName() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function archiveFile(filePath, archiveFolder) {
  await mkdir(archiveFolder, { recursive: true });

  const parsed = path.parse(filePath);
  let destination = path.join(archiveFolder, parsed.base);

  if (existsSync(destination)) {
    destination = path.join(archiveFolder, `${parsed.name}-${timestampForFileName()}${parsed.ext}`);
  }

  await rename(filePath, destination);
  console.log(`Archived ${parsed.base} to ${destination}`);
}

function appendFileToFormData(formData, buffer, fileName) {
  const fileCtor = globalThis.File;
  if (typeof fileCtor === 'function') {
    const file = new fileCtor([buffer], fileName, { type: 'application/octet-stream' });
    formData.append('files', file);
    return;
  }

  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  formData.append('files', blob, fileName);
}

function shouldRecordLocalState(results) {
  if (!Array.isArray(results)) return false;
  if (results.length === 0) return true;
  return results.every((result) => ['success', 'skipped', 'duplicate'].includes(String(result?.status || '')));
}

function logServerResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    console.log('Server accepted the upload with no file results.');
    return;
  }

  for (const result of results) {
    const fileName = String(result?.fileName || 'Unknown file');
    const status = String(result?.status || 'unknown');
    const rowsInserted = result?.rowsInserted === null || result?.rowsInserted === undefined
      ? 'n/a'
      : String(result.rowsInserted);
    const message = result?.message ? ` - ${result.message}` : '';
    console.log(`Result: ${fileName} | ${status} | rows: ${rowsInserted}${message}`);
  }
}

async function uploadFile(config, filePath, fileHash) {
  const fileName = path.basename(filePath);
  const buffer = await readFile(filePath);
  const formData = new FormData();
  appendFileToFormData(formData, buffer, fileName);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.apiUrl}/api/connectors/pos-import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
      body: formData,
      signal: controller.signal,
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (response.status === 401) {
      console.error('Connector token was rejected. Check that the token is correct and the connector is active in StorePulse.');
      return { uploaded: false };
    }

    if (!response.ok || !body?.ok) {
      console.error(`Upload failed for ${fileName}: server returned HTTP ${response.status}.`);
      return { uploaded: false };
    }

    console.log(`Uploaded ${fileName} (${fileHash})`);
    logServerResults(body.results);
    return { uploaded: shouldRecordLocalState(body.results) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Upload failed for ${fileName}: ${message}`);
    return { uploaded: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function processFile(config, state, filePath) {
  const fileName = path.basename(filePath);
  const stableStats = await stableFileStats(filePath);

  if (!stableStats) {
    console.log(`Skipping ${fileName}: file is still changing or cannot be read.`);
    return;
  }

  const fileHash = await hashFile(filePath);
  if (state.uploaded[fileHash]) {
    console.log(`Skipping ${fileName}: already uploaded locally.`);
    return;
  }

  if (config.dryRun) {
    console.log(`Dry run: would upload ${fileName} (${stableStats.size} bytes).`);
    return;
  }

  const result = await uploadFile(config, filePath, fileHash);
  if (!result.uploaded) return;

  state.uploaded[fileHash] = {
    fileName,
    uploadedAt: new Date().toISOString(),
  };
  await writeState(state);

  if (config.archiveFolder) {
    try {
      await archiveFile(filePath, config.archiveFolder);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Uploaded ${fileName}, but could not archive it: ${message}`);
    }
  }
}

async function pollOnce(config, state) {
  const files = await listCandidateFiles(config.watchFolder);
  if (files.length === 0) {
    console.log('No supported report files found.');
    return;
  }

  for (const filePath of files) {
    if (shuttingDown) break;
    await processFile(config, state, filePath);
  }
}

function installShutdownHandler() {
  process.on('SIGINT', () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nStorePulse connector shutting down...');
  });
}

async function main() {
  const config = await loadConfig();
  const state = await readState();
  installShutdownHandler();

  console.log('StorePulse POS connector started.');
  console.log(`Watch folder: ${config.watchFolder}`);
  console.log(`API URL: ${config.apiUrl}`);
  console.log(`Poll interval: ${config.pollSeconds} seconds`);
  console.log(`Dry run: ${config.dryRun ? 'true' : 'false'}`);
  console.log(`Run once: ${config.once ? 'true' : 'false'}`);
  console.log(`Archive folder: ${config.archiveFolder || '(not configured)'}`);

  if (config.once) {
    await pollOnce(config, state);
    console.log('StorePulse connector completed one scan and stopped.');
    return;
  }

  while (!shuttingDown) {
    await pollOnce(config, state);
    if (shuttingDown) break;
    await sleep(config.pollSeconds * 1000);
  }

  console.log('StorePulse connector stopped.');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`StorePulse connector stopped after an unexpected error: ${message}`);
  process.exit(1);
});
