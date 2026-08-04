import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { resolveCommanderTlsTrust, validateCommanderTlsConfig } from '../lib/commander/session/commander-tls-trust.mjs';
import { createVerifiedCommanderAgent } from '../lib/commander/commander-naxml-client.mjs';

const ca = Buffer.from('-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n');
const der = Buffer.alloc(64, 7);
const hash = value => createHash('sha256').update(value).digest('hex').toUpperCase();
const config = { commander_tls_server_name: 'commander.example', commander_tls_peer_sha256: hash(der), commander_tls_ca_bundle_sha256: hash(ca) };
const programData = 'C:\\ProgramData';
const caPath = 'C:\\ProgramData\\StorePulse\\certificates\\commander-ca.pem';

function fixedFilesystem({ caBundle = ca, detail } = {}) {
  const lstatCalls = [];
  const readCalls = [];
  const fileDetail = detail ?? { isFile: () => true, isSymbolicLink: () => false, isReparsePoint: () => false, size: caBundle.length };
  return {
    lstatCalls,
    readCalls,
    async lstat(file) { lstatCalls.push(file); if (file !== caPath) throw new Error('unexpected path'); return fileDetail; },
    async readFile(file) { readCalls.push(file); if (file !== caPath) throw new Error('unexpected path'); return caBundle; },
  };
}

test('fixed trust resolver requires only commander-ca.pem and returns configured live peer pin', async () => {
  const filesystem = fixedFilesystem();
  const trust = await resolveCommanderTlsTrust({ config, programData, filesystem });
  assert.equal(trust.serverName, 'commander.example'); assert.equal(trust.peerSha256, config.commander_tls_peer_sha256); assert.equal(trust.caBundle.equals(ca), true);
  assert.deepEqual(filesystem.lstatCalls, [caPath]); assert.deepEqual(filesystem.readCalls, [caPath]);
  await assert.rejects(() => resolveCommanderTlsTrust({ config: { ...config, commander_tls_ca_bundle_sha256: '0'.repeat(64) }, programData, filesystem }), error => error.code === 'commander_ca_hash_mismatch');
  const changedPeer = '0'.repeat(64);
  const changedTrust = await resolveCommanderTlsTrust({ config: { ...config, commander_tls_peer_sha256: changedPeer }, programData, filesystem: fixedFilesystem() });
  assert.equal(changedTrust.peerSha256, changedPeer);
  assert.throws(() => validateCommanderTlsConfig({ ...config, commander_tls_server_name: 'bad host' }), error => error.code === 'commander_trust_not_configured');
});

test('trust resolver rejects missing, reparse, directory, oversized, and malformed CA inputs', async () => {
  await assert.rejects(() => resolveCommanderTlsTrust({ config, programData, filesystem: { ...fixedFilesystem(), async lstat() { throw new Error('missing'); } } }), error => error.code === 'commander_ca_missing');
  for (const detail of [{ isFile: () => false, isSymbolicLink: () => false, isReparsePoint: () => false, size: 1 }, { isFile: () => true, isSymbolicLink: () => true, isReparsePoint: () => false, size: 1 }, { isFile: () => true, isSymbolicLink: () => false, isReparsePoint: () => false, size: 200000 }]) {
    await assert.rejects(() => resolveCommanderTlsTrust({ config, programData, filesystem: fixedFilesystem({ detail }) }), error => error.code === 'commander_certificate_invalid');
  }
  for (const caBundle of [Buffer.from('not PEM'), Buffer.alloc(0)]) {
    await assert.rejects(() => resolveCommanderTlsTrust({ config, programData, filesystem: fixedFilesystem({ caBundle }) }), error => error.code === 'commander_certificate_invalid');
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
