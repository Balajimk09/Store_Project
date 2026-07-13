#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const SUPPORTED_EXTENSIONS = new Set(['.html', '.htm', '.xml', '.csv', '.xlsx', '.xls', '.zip', '.gz']);
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

function newSummary() {
  const startedAt = new Date().toISOString();
  return {
    scanned: 0,
    eligible: 0,
    uploaded: 0,
    skipped_duplicate: 0,
    skipped_unstable: 0,
    failed: 0,
    started_at: startedAt,
    completed_at: null,
  };
}

function parseArgs(argv) {
  const result = { once: false, summaryPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--once') {
      result.once = true;
    } else if (arg === '--summary-path') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--summary-path requires a path value.');
      }
      result.summaryPath = value;
      index += 1;
    } else {
      throw new Error(`Unknown connector argument: ${arg}`);
    }
  }
  return result;
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
  const args = parseArgs(process.argv.slice(2));

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
    once: args.once || parseBoolean(process.env.STOREPULSE_ONCE, false),
    summaryPath: args.summaryPath || String(process.env.STOREPULSE_SUMMARY_PATH || '').trim() || null,
    statePath: String(process.env.STOREPULSE_STATE_PATH || '').trim() || statePath,
    stabilityWaitMs: parsePositiveInteger(process.env.STOREPULSE_STABILITY_WAIT_MS, STABILITY_WAIT_MS),
  };
}

async function readState(config) {
  try {
    const text = await readFile(config.statePath, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.uploaded && typeof parsed.uploaded === 'object') {
      return parsed;
    }
  } catch {
    // Local state is best effort only. If missing or corrupted, the server remains authoritative.
  }

  return { version: 1, uploaded: {} };
}

async function writeState(config, state) {
  await mkdir(path.dirname(config.statePath), { recursive: true });
  await writeFile(config.statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function writeSummary(summary, summaryPath) {
  if (!summaryPath) return;
  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function fileExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

async function listCandidateFiles(watchFolder) {
  const files = [];

  async function walk(folderPath) {
    let entries;
    try {
      entries = await readdir(folderPath, { withFileTypes: true });
    } catch (error) {
      console.error(`Could not read folder ${folderPath}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (SUPPORTED_EXTENSIONS.has(fileExtension(entryPath))) {
        files.push(entryPath);
      }
    }
  }

  try {
    const rootStats = await stat(watchFolder);
    if (!rootStats.isDirectory()) {
      console.error(`Watch folder is not a directory: ${watchFolder}`);
      return [];
    }
  } catch (error) {
    console.error(`Could not read watch folder: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }

  await walk(watchFolder);
  return files;
}

async function stableFileStats(filePath, stabilityWaitMs = STABILITY_WAIT_MS) {
  try {
    const first = await stat(filePath);
    await sleep(stabilityWaitMs);
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
  let fileName = path.basename(filePath);
  let buffer = await readFile(filePath);
  if (fileExtension(filePath) === '.gz') {
    buffer = gunzipSync(buffer);
    fileName = fileName.slice(0, -'.gz'.length);
  }
  const formData = new FormData();
  appendFileToFormData(formData, buffer, fileName);

  const testUploadResult = String(process.env.STOREPULSE_CONNECTOR_TEST_UPLOAD_RESULT || '').trim().toLowerCase();
  if (testUploadResult === 'success') {
    console.log(`Uploaded ${fileName} (${fileHash})`);
    return { uploaded: true };
  }
  if (testUploadResult === 'failure') {
    console.error(`Upload failed for ${fileName}: synthetic test failure.`);
    return { uploaded: false };
  }

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

async function processFile(config, state, filePath, summary) {
  const fileName = path.basename(filePath);
  const stableStats = await stableFileStats(filePath, config.stabilityWaitMs);

  if (!stableStats) {
    console.log(`Skipping ${fileName}: file is still changing or cannot be read.`);
    summary.skipped_unstable += 1;
    return { status: 'skipped_unstable' };
  }
  summary.eligible += 1;

  const fileHash = await hashFile(filePath);
  if (state.uploaded[fileHash]) {
    console.log(`Skipping ${fileName}: already uploaded locally.`);
    summary.skipped_duplicate += 1;
    return { status: 'skipped_duplicate' };
  }

  if (config.dryRun) {
    console.log(`Dry run: would upload ${fileName} (${stableStats.size} bytes).`);
    return { status: 'dry_run' };
  }

  const result = await uploadFile(config, filePath, fileHash);
  if (!result.uploaded) {
    summary.failed += 1;
    return { status: 'failed' };
  }

  state.uploaded[fileHash] = {
    fileName,
    uploadedAt: new Date().toISOString(),
  };
  await writeState(config, state);

  if (config.archiveFolder) {
    try {
      await archiveFile(filePath, config.archiveFolder);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Uploaded ${fileName}, but could not archive it: ${message}`);
    }
  }
  summary.uploaded += 1;
  return { status: 'uploaded' };
}

async function pollOnce(config, state, summary) {
  const files = await listCandidateFiles(config.watchFolder);
  summary.scanned += files.length;
  if (files.length === 0) {
    console.log('No supported report files found.');
    return;
  }

  for (const filePath of files) {
    if (shuttingDown) break;
    await processFile(config, state, filePath, summary);
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
  const state = await readState(config);
  const summary = newSummary();
  installShutdownHandler();

  console.log('StorePulse POS connector started.');
  console.log(`Watch folder: ${config.watchFolder}`);
  console.log(`Recursive scan enabled — watching all subfolders under: ${config.watchFolder}`);
  console.log(`API URL: ${config.apiUrl}`);
  console.log(`Poll interval: ${config.pollSeconds} seconds`);
  console.log(`Dry run: ${config.dryRun ? 'true' : 'false'}`);
  console.log(`Run once: ${config.once ? 'true' : 'false'}`);
  console.log(`Archive folder: ${config.archiveFolder || '(not configured)'}`);

  if (config.once) {
    await pollOnce(config, state, summary);
    summary.completed_at = new Date().toISOString();
    await writeSummary(summary, config.summaryPath);
    console.log(`One-shot summary: scanned=${summary.scanned} eligible=${summary.eligible} uploaded=${summary.uploaded} skipped_duplicate=${summary.skipped_duplicate} skipped_unstable=${summary.skipped_unstable} failed=${summary.failed}`);
    console.log('StorePulse connector completed one scan and stopped.');
    if (summary.failed > 0) {
      process.exit(1);
    }
    return;
  }

  while (!shuttingDown) {
    await pollOnce(config, state, summary);
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
