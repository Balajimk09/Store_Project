import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  CONTROLLED_TEST_PRODUCT,
} from '../lib/commander/maintenance/verify-test-price-write.mjs';

import {
  createVerifyTestPriceWriteDependencies,
  VERIFY_TEST_PRICE_WRITE_FIXED_PATHS,
} from '../lib/commander/maintenance/create-verify-test-price-write-dependencies.mjs';

const der = Buffer.alloc(64, 9);

const ca = Buffer.from(
  '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n',
);

const server = Buffer.from(
  `-----BEGIN CERTIFICATE-----\n${der.toString('base64')}\n-----END CERTIFICATE-----\n`,
);

const hash = (value) =>
  createHash('sha256')
    .update(value)
    .digest('hex')
    .toUpperCase();

const moduleUrl =
  'file:///C:/Package/Connector/maintenance/run-commander-maintenance.mjs';

const worker =
  'C:\\Package\\CommanderDiagnostics\\commander-auth-cookie-worker.ps1';

const config = {
  commander_ip: 'commander.fixture',
  commander_tls_server_name: 'commander.fixture',
  commander_tls_peer_sha256: hash(der),
  commander_tls_ca_bundle_sha256: hash(ca),
};

function productXml(price = '0.02') {
  return `<domain:PLUs page="1" ofPages="1" xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><domain:PLU><upc>${CONTROLLED_TEST_PRODUCT.upc}</upc><upcModifier>${CONTROLLED_TEST_PRODUCT.modifier}</upcModifier><description>${CONTROLLED_TEST_PRODUCT.description}</description><department>1</department><fees><fee>0</fee></fees><pcode>0</pcode><price>${price}</price><flags><domain:flag sysid="1"/></flags><taxRates><domain:taxRate sysid="1"/></taxRates><idChecks><domain:idCheck sysid="1"/></idChecks><SellUnit>1.000</SellUnit><taxableRebate><amount>0.00</amount></taxableRebate><maxQtyPerTrans>0.00</maxQtyPerTrans></domain:PLU></domain:PLUs>`;
}

function makeInput(overrides = {}) {
  const base = {
    approval: {
      approved: true,
      operation: 'verify_test_price_write',
      approval_id: 'approval-1',
      approved_at: '2026-07-22T23:00:00.000Z',
    },
    command_id: 'command-1',
    controlled_test_product: true,
    created_at: '2026-07-22T22:59:00.000Z',
    expected_current_price: '0.02',
    idempotency_key: 'idempotency-1',
    modifier: CONTROLLED_TEST_PRODUCT.modifier,
    requested_price: '0.03',
    upc: CONTROLLED_TEST_PRODUCT.upc,
  };

  return {
    ...base,
    ...overrides,
    approval: {
      ...base.approval,
      ...(overrides.approval || {}),
    },
  };
}

function createFixtureFilesystem() {
  const files = new Map([
    [
      VERIFY_TEST_PRICE_WRITE_FIXED_PATHS.configPath,
      Buffer.from(JSON.stringify(config)),
    ],
    [
      'C:\\ProgramData\\StorePulse\\certificates\\commander-ca.pem',
      ca,
    ],
    [
      'C:\\ProgramData\\StorePulse\\certificates\\commander-server.pem',
      server,
    ],
    [
      VERIFY_TEST_PRICE_WRITE_FIXED_PATHS.powershellPath,
      Buffer.from('powershell'),
    ],
    [
      worker,
      Buffer.from('worker'),
    ],
  ]);

  return {
    files,

    filesystem: {
      async lstat(file) {
        const value = files.get(file);

        if (!value) {
          throw new Error('missing');
        }

        return {
          isFile: () => true,
          isSymbolicLink: () => false,
          isReparsePoint: () => false,
          size: value.length,
        };
      },

      async readFile(file) {
        const value = files.get(file);

        if (!value) {
          throw new Error('missing');
        }

        return value;
      },
    },
  };
}

test('fixed production composition authenticates once and sends one vPLUs, uPLUs, vPLUs sequence', async () => {
  const { filesystem } = createFixtureFilesystem();

  let spawns = 0;
  let currentPrice = '0.02';
  const commands = [];

  const dependencies = createVerifyTestPriceWriteDependencies({
    moduleUrl,
    platform: 'win32',
    filesystem,

    spawnProcess: (executable, args, options) => {
      spawns += 1;

      assert.equal(
        executable,
        VERIFY_TEST_PRICE_WRITE_FIXED_PATHS.powershellPath,
      );

      assert.equal(args.at(-1), worker);
      assert.equal(options.shell, false);

      return {
        result: Promise.resolve({
          exitCode: 0,
          stdout: Buffer.from('{"cookie":"private-cookie"}'),
          stderr: Buffer.alloc(0),
        }),
      };
    },

    transport: async ({ url, options, body }) => {
      assert.equal(
        url,
        'https://commander.fixture/cgi-bin/NAXML?',
      );

      assert.equal(options.rejectUnauthorized, true);
      assert.equal(options.servername, 'commander.fixture');
      assert.equal(body.includes('private-cookie'), true);

      if (body.startsWith('cmd=vPLUs&cookie=')) {
        commands.push('vPLUs');

        return {
          status: 200,
          body: productXml(currentPrice),
        };
      }

      assert.equal(body.startsWith('cmd=uPLUs&cookie='), true);
      assert.match(body, /<price>0\.03<\/price>/);

      commands.push('uPLUs');
      currentPrice = '0.03';

      return {
        status: 200,
        body: '<VFI:Response xmlns:VFI="urn:vfi-sapphire:np.domain.2001-07-01"/>',
      };
    },
  });

  const result = await dependencies.executeVerifyTestPriceWrite(
    makeInput(),
  );

  assert.equal(result.write_succeeded, true);
  assert.equal(result.readback_matched, true);
  assert.equal(result.idempotent, false);
  assert.equal(spawns, 1);

  assert.deepEqual(
    commands,
    ['vPLUs', 'uPLUs', 'vPLUs'],
  );

  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('private-cookie'), false);
  assert.equal(
    serialized.includes(CONTROLLED_TEST_PRODUCT.upc),
    false,
  );
  assert.equal(serialized.includes('<domain:'), false);
});

test('fixed paths cannot be replaced and missing trust prevents authentication and transport', async () => {
  const { filesystem } = createFixtureFilesystem();

  let spawns = 0;
  let requests = 0;

  const missingTrustFilesystem = {
    ...filesystem,

    async lstat(file) {
      if (
        file ===
        'C:\\ProgramData\\StorePulse\\certificates\\commander-ca.pem'
      ) {
        throw new Error('missing');
      }

      return filesystem.lstat(file);
    },
  };

  const dependencies = createVerifyTestPriceWriteDependencies({
    moduleUrl,
    platform: 'win32',
    filesystem: missingTrustFilesystem,

    spawnProcess: () => {
      spawns += 1;
      throw new Error('authentication must not run');
    },

    transport: async () => {
      requests += 1;
      throw new Error('transport must not run');
    },

    configPath: 'C:\\unsafe\\config.json',
    programData: 'C:\\unsafe',
    workerPath: 'C:\\unsafe\\worker.ps1',
    origin: 'https://unsafe.example',
  });

  const result =
    await dependencies.executeVerifyTestPriceWrite(
      makeInput(),
    );

  assert.equal(result.safe_error_code, 'commander_ca_missing');
  assert.equal(spawns, 0);
  assert.equal(requests, 0);
});

test('dependency-owned idempotency store prevents repeated authentication and transport', async () => {
  const { filesystem } = createFixtureFilesystem();

  let spawns = 0;
  let requests = 0;

  const dependencies = createVerifyTestPriceWriteDependencies({
    moduleUrl,
    platform: 'win32',
    filesystem,

    spawnProcess: () => {
      spawns += 1;

      return {
        result: Promise.resolve({
          exitCode: 0,
          stdout: Buffer.from('{"cookie":"private-cookie"}'),
          stderr: Buffer.alloc(0),
        }),
      };
    },

    transport: async ({ body }) => {
      requests += 1;

      assert.equal(
        body.startsWith('cmd=vPLUs&cookie='),
        true,
      );

      return {
        status: 200,
        body: productXml('0.02'),
      };
    },
  });

  const input = makeInput({
    requested_price: '0.02',
  });

  const first =
    await dependencies.executeVerifyTestPriceWrite(input);

  const replay =
    await dependencies.executeVerifyTestPriceWrite(input);

  assert.equal(first.write_succeeded, true);
  assert.equal(first.idempotent, true);
  assert.deepEqual(replay, first);
  assert.equal(spawns, 1);
  assert.equal(requests, 1);
});

test('factory exposes only the guarded execution method and uses real transport by default', () => {
  const { filesystem } = createFixtureFilesystem();

  const dependencies = createVerifyTestPriceWriteDependencies({
    moduleUrl,
    platform: 'win32',
    filesystem,

    spawnProcess: () => {
      throw new Error(
        'authentication must not run during composition check',
      );
    },
  });

  assert.deepEqual(
    Object.keys(dependencies),
    ['executeVerifyTestPriceWrite'],
  );

  assert.equal(
    typeof dependencies.executeVerifyTestPriceWrite,
    'function',
  );
});