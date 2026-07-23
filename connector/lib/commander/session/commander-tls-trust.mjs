import { createHash } from 'node:crypto';
import { lstat as nodeLstat, readFile as nodeReadFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_CERTIFICATE_BYTES = 128 * 1024;
const HEX = /^[A-F0-9]{64}$/;
const DNS = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const fixedPaths = (programData) => ({
  caBundlePath: path.win32.join(programData, 'StorePulse', 'certificates', 'commander-ca.pem'),
  serverCertificatePath: path.win32.join(programData, 'StorePulse', 'certificates', 'commander-server.pem'),
});

export function validateCommanderTlsConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('commander_trust_not_configured');
  const serverName = value.commander_tls_server_name;
  const peerSha256 = String(value.commander_tls_peer_sha256 ?? '').toUpperCase();
  const caBundleSha256 = String(value.commander_tls_ca_bundle_sha256 ?? '').toUpperCase();
  if (typeof serverName !== 'string' || !(DNS.test(serverName) || IPV4.test(serverName)) || !HEX.test(peerSha256) || !HEX.test(caBundleSha256)) fail('commander_trust_not_configured');
  return Object.freeze({ serverName, peerSha256, caBundleSha256 });
}

async function regularFile(filesystem, file, missingCode) {
  let info;
  try { info = await filesystem.lstat(file); } catch { fail(missingCode); }
  if (!info?.isFile?.() || info?.isSymbolicLink?.() || info?.isReparsePoint?.()) fail('commander_certificate_invalid');
  if (!Number.isInteger(info.size) || info.size < 1 || info.size > MAX_CERTIFICATE_BYTES) fail('commander_certificate_invalid');
}

function isPem(buffer) {
  const value = buffer.toString('utf8');
  return !value.includes('\uFFFD') && /^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/m.test(value);
}

function certificateDer(buffer) {
  const text = buffer.toString('utf8');
  const matches = [...text.matchAll(/-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END CERTIFICATE-----/g)];
  if (matches.length !== 1) fail('commander_certificate_invalid');
  const der = Buffer.from(matches[0][1].replace(/\s/g, ''), 'base64');
  if (der.length < 32) fail('commander_certificate_invalid');
  return der;
}

/** Resolves only fixed ProgramData trust files and returns in-memory TLS material. */
export async function resolveCommanderTlsTrust({
  config,
  programData = process.env.ProgramData,
  filesystem = { lstat: nodeLstat, readFile: nodeReadFile },
} = {}) {
  const validated = validateCommanderTlsConfig(config);
  if (typeof programData !== 'string' || !/^[A-Za-z]:\\/.test(programData) || programData.includes('..')) fail('commander_trust_not_configured');
  const paths = fixedPaths(programData);
  await regularFile(filesystem, paths.caBundlePath, 'commander_ca_missing');
  await regularFile(filesystem, paths.serverCertificatePath, 'commander_server_certificate_missing');
  let caBundle; let serverCertificate;
  try { [caBundle, serverCertificate] = await Promise.all([filesystem.readFile(paths.caBundlePath), filesystem.readFile(paths.serverCertificatePath)]); } catch { fail('commander_certificate_invalid'); }
  if (!Buffer.isBuffer(caBundle) || !Buffer.isBuffer(serverCertificate) || !isPem(caBundle) || !isPem(serverCertificate)) fail('commander_certificate_invalid');
  const caBundleSha256 = createHash('sha256').update(caBundle).digest('hex').toUpperCase();
  const peerSha256 = createHash('sha256').update(certificateDer(serverCertificate)).digest('hex').toUpperCase();
  if (caBundleSha256 !== validated.caBundleSha256) fail('commander_ca_hash_mismatch');
  if (peerSha256 !== validated.peerSha256) fail('commander_certificate_hash_mismatch');
  return Object.freeze({ caBundle, serverName: validated.serverName, peerSha256 });
}

export const COMMANDER_TLS_FIXED_PATHS = fixedPaths;
