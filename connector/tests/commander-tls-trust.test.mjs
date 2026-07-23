import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { resolveCommanderTlsTrust, validateCommanderTlsConfig } from '../lib/commander/session/commander-tls-trust.mjs';
import { createVerifiedCommanderAgent } from '../lib/commander/commander-naxml-client.mjs';

const ca = Buffer.from('-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n');
const der = Buffer.alloc(64, 7);
const server = Buffer.from(`-----BEGIN CERTIFICATE-----\n${der.toString('base64')}\n-----END CERTIFICATE-----\n`);
const hash = value => createHash('sha256').update(value).digest('hex').toUpperCase();
const config = { commander_tls_server_name: 'commander.example', commander_tls_peer_sha256: hash(der), commander_tls_ca_bundle_sha256: hash(ca) };
const programData = 'C:\\ProgramData';
const files = new Map([
  ['C:\\ProgramData\\StorePulse\\certificates\\commander-ca.pem', ca],
  ['C:\\ProgramData\\StorePulse\\certificates\\commander-server.pem', server],
]);
const filesystem = { async lstat(file) { const data = files.get(file); if (!data) throw new Error('missing'); return { isFile: () => true, isSymbolicLink: () => false, isReparsePoint: () => false, size: data.length }; }, async readFile(file) { return files.get(file); } };

test('fixed trust resolver validates only fixed ProgramData certificate files and configured hashes', async () => {
  const trust = await resolveCommanderTlsTrust({ config, programData, filesystem });
  assert.equal(trust.serverName, 'commander.example'); assert.equal(trust.peerSha256, hash(der)); assert.equal(trust.caBundle.equals(ca), true);
  await assert.rejects(() => resolveCommanderTlsTrust({ config: { ...config, commander_tls_ca_bundle_sha256: '0'.repeat(64) }, programData, filesystem }), error => error.code === 'commander_ca_hash_mismatch');
  await assert.rejects(() => resolveCommanderTlsTrust({ config: { ...config, commander_tls_peer_sha256: '0'.repeat(64) }, programData, filesystem }), error => error.code === 'commander_certificate_hash_mismatch');
  assert.throws(() => validateCommanderTlsConfig({ ...config, commander_tls_server_name: 'bad host' }), error => error.code === 'commander_trust_not_configured');
});

test('trust resolver rejects missing, reparse, directory, oversized, and malformed certificate inputs', async () => {
  await assert.rejects(() => resolveCommanderTlsTrust({ config, programData, filesystem: { ...filesystem, async lstat() { throw new Error('missing'); } } }), error => error.code === 'commander_ca_missing');
  for (const detail of [{ isFile: () => false, isSymbolicLink: () => false, isReparsePoint: () => false, size: 1 }, { isFile: () => true, isSymbolicLink: () => true, isReparsePoint: () => false, size: 1 }, { isFile: () => true, isSymbolicLink: () => false, isReparsePoint: () => false, size: 200000 }]) {
    await assert.rejects(() => resolveCommanderTlsTrust({ config, programData, filesystem: { async lstat() { return detail; }, readFile: filesystem.readFile } }), error => error.code === 'commander_certificate_invalid');
  }
});

test('verified TLS agent preserves rejectUnauthorized, hostname verification, and peer pinning', () => {
  const agent = createVerifiedCommanderAgent({ caBundle: ca, serverName: 'commander.example', peerSha256: hash(der) });
  const options = agent.options;
  assert.equal(options.rejectUnauthorized, true); assert.equal(options.allowPartialTrustChain, true); assert.equal(typeof options.checkServerIdentity, 'function');
  assert.equal(options.checkServerIdentity('ignored', { raw: der, subjectaltname: 'DNS:commander.example' }), undefined);
  assert.ok(options.checkServerIdentity('ignored', { raw: Buffer.from('wrong'), subjectaltname: 'DNS:commander.example' }));
  assert.ok(options.checkServerIdentity('ignored', {})); agent.destroy();
});
