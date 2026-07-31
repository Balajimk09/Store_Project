import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  SELECTED_PRODUCT_PREVIEW_FIXED_PATHS,
  createSelectedProductPreviewDependencies,
  selectedProductPreviewPackagePaths,
  selectedProductPreviewPackageRootFromModuleUrl,
} from '../lib/commander/maintenance/create-selected-product-preview-dependencies.mjs';

const STORE_ID = 'ec192877-0156-42ab-8fbf-31105f3e2ea3';
const OWNER_ID = 'c702332a-9299-4b1a-9583-a01302bd7b4a';
const SYNC_RUN_ID = '11111111-1111-4111-8111-111111111111';

const der = Buffer.alloc(64, 7);
const ca = Buffer.from(
  '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n',
);
const server = Buffer.from(
  `-----BEGIN CERTIFICATE-----\n${der.toString('base64')}\n-----END CERTIFICATE-----\n`,
);
const hash = (value) =>
  createHash('sha256').update(value).digest('hex').toUpperCase();

const moduleUrl =
  'file:///C:/Package/Connector/maintenance/run-commander-maintenance.mjs';
const packageRoot = 'C:\\Package';
const packagePaths = selectedProductPreviewPackagePaths(packageRoot);

const config = {
  source_store_number: 'AB123',
  commander_ip: 'commander.fixture',
  commander_tls_server_name: 'commander.fixture',
  commander_tls_peer_sha256: hash(der),
  commander_tls_ca_bundle_sha256: hash(ca),
  pos_publish_enabled: false,
};

function artifact(sourceStoreNumber = 'AB123') {
  return {
    schema_version: '1',
    mode: 'selected_products',
    store: {
      store_id: STORE_ID,
      owner_id: OWNER_ID,
      store_name: 'Balaji Stores',
      source_system: 'verifone_commander',
      source_store_number: sourceStoreNumber,
    },
    safety: {
      read_only: true,
      automatic_publishing_enabled: false,
      retain_raw_xml: false,
      retain_credentials_or_cookies: false,
      max_selected_products: 10,
    },
    products: [
      {
        upc: '00999999999993',
        modifier: '000',
        reason: 'Controlled product.',
      },
      {
        upc: '00000000000014',
        modifier: '145',
        reason: 'Modifier coverage.',
      },
    ],
  };
}

function productXml(upc, modifier, description = 'STOREPULSE TEST') {
  return `<domain:PLUs page="1" ofPages="1" xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><domain:PLU><upc>${upc}</upc><upcModifier>${modifier}</upcModifier><description>${description}</description><department>1</department><fees><fee>0</fee></fees><pcode>0</pcode><price>0.02</price><flags><domain:flag sysid="1"/></flags><taxRates><domain:taxRate sysid="1"/></taxRates><idChecks><domain:idCheck sysid="1"/></idChecks><SellUnit>1.000</SellUnit><taxableRebate><amount>0.00</amount></taxableRebate><maxQtyPerTrans>0.00</maxQtyPerTrans></domain:PLU></domain:PLUs>`;
}

function approval() {
  return {
    approval: {
      approved: true,
      operation: 'preview_selected_products',
      supervised: true,
      preview_only: true,
      selected_products_reviewed: true,
    },
  };
}

function createFixtureFilesystem({
  selectedArtifact = artifact(),
  machineConfig = config,
  omit = null,
} = {}) {
  const files = new Map([
    [
      SELECTED_PRODUCT_PREVIEW_FIXED_PATHS.configPath,
      Buffer.from(JSON.stringify(machineConfig)),
    ],
    [
      packagePaths.selectionArtifactPath,
      Buffer.from(JSON.stringify(selectedArtifact)),
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
      SELECTED_PRODUCT_PREVIEW_FIXED_PATHS.powershellPath,
      Buffer.from('powershell'),
    ],
    [
      packagePaths.cookieWorkerPath,
      Buffer.from('worker'),
    ],
  ]);

  if (omit) files.delete(omit);

  const touched = [];

  return {
    files,
    touched,
    filesystem: {
      async lstat(file) {
        touched.push(['lstat', file]);
        const value = files.get(file);
        if (!value) throw new Error('missing');

        return {
          isFile: () => true,
          isSymbolicLink: () => false,
          isReparsePoint: () => false,
          size: value.length,
        };
      },

      async readFile(file) {
        touched.push(['readFile', file]);
        const value = files.get(file);
        if (!value) throw new Error('missing');
        return value;
      },
    },
  };
}

function successBody(selectionCount, receivedProductCount) {
  return {
    ok: true,
    syncRunId: SYNC_RUN_ID,
    created: true,
    connectorName: 'StorePulse Commander',
    storeId: STORE_ID,
    mode: 'selected_products',
    catalogComplete: false,
    previewOnly: true,
    selectionCount,
    receivedProductCount,
  };
}

test('package root and package-owned paths are exact and fixed', () => {
  assert.equal(
    selectedProductPreviewPackageRootFromModuleUrl(moduleUrl, 'win32'),
    packageRoot,
  );

  assert.deepEqual(packagePaths, {
    cookieWorkerPath:
      'C:\\Package\\CommanderDiagnostics\\commander-auth-cookie-worker.ps1',
    selectionArtifactPath:
      'C:\\Package\\Connector\\research\\pilot\\commander-pilot-selected-products.json',
  });

  assert.deepEqual(SELECTED_PRODUCT_PREVIEW_FIXED_PATHS, {
    configPath: 'C:\\ProgramData\\StorePulse\\config.json',
    programData: 'C:\\ProgramData',
    powershellPath:
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    cookieWorkerName: 'commander-auth-cookie-worker.ps1',
    selectionArtifactName: 'commander-pilot-selected-products.json',
  });
});

test('fixed composition authenticates once, reads selected identities sequentially, and submits once', async () => {
  const { filesystem } = createFixtureFilesystem();
  const commands = [];
  let spawns = 0;
  let submissions = 0;

  const dependencies = createSelectedProductPreviewDependencies({
    moduleUrl,
    platform: 'win32',
    filesystem,

    spawnProcess(executable, args, options) {
      spawns += 1;
      assert.equal(
        executable,
        SELECTED_PRODUCT_PREVIEW_FIXED_PATHS.powershellPath,
      );
      assert.equal(args.at(-1), packagePaths.cookieWorkerPath);
      assert.equal(options.shell, false);

      return {
        result: Promise.resolve({
          exitCode: 0,
          stdout: Buffer.from('{"cookie":"private-cookie"}'),
          stderr: Buffer.alloc(0),
        }),
      };
    },

    commanderTransport: async ({ url, options, body }) => {
      assert.equal(
        url,
        'https://commander.fixture/cgi-bin/NAXML?',
      );
      assert.equal(options.rejectUnauthorized, true);
      assert.equal(options.servername, 'commander.fixture');
      assert.equal(body.includes('private-cookie'), true);
      assert.equal(body.startsWith('cmd=vPLUs&cookie='), true);

      const identity = body.includes('00000000000014')
        ? ['00000000000014', '145']
        : ['00999999999993', '000'];

      commands.push(identity.join('/'));

      return {
        status: 200,
        body: productXml(...identity),
      };
    },

    submitPreview: async (request) => {
      submissions += 1;
      assert.equal(
        request.endpointPath,
        '/api/connectors/catalog-pilot/preview',
      );
      assert.equal(request.method, 'POST');
      assert.match(
        request.idempotencyKey,
        /^catalog-preview:[0-9a-f]{64}$/,
      );
      assert.equal(request.body.products.length, 2);
      assert.equal(request.body.sourceStoreNumber, 'AB123');

      const serialized = JSON.stringify(request);
      assert.equal(serialized.includes('private-cookie'), false);
      assert.equal(serialized.includes('<domain:'), false);
      assert.equal(serialized.includes('_write_template'), false);

      return {
        status: 200,
        body: successBody(2, 2),
      };
    },

    clock: () => new Date('2026-07-31T15:00:00.000Z'),
  });

  assert.deepEqual(
    Object.keys(dependencies),
    ['executeSelectedProductPreview'],
  );

  const result = await dependencies.executeSelectedProductPreview(
    approval(),
  );

  assert.equal(result.ok, true);
  assert.equal(result.preview_only, true);
  assert.equal(result.catalog_complete, false);
  assert.equal(result.selection_count, 2);
  assert.equal(result.received_product_count, 2);
  assert.equal(spawns, 1);
  assert.equal(submissions, 1);
  assert.deepEqual(commands, [
    '00999999999993/000',
    '00000000000014/145',
  ]);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('private-cookie'), false);
  assert.equal(serialized.includes('00999999999993'), false);
  assert.equal(serialized.includes('<domain:'), false);
});

test('missing preview transport fails before file reads or Commander authentication', async () => {
  let fileOperations = 0;
  let spawns = 0;

  const dependencies = createSelectedProductPreviewDependencies({
    moduleUrl,
    platform: 'win32',

    filesystem: {
      async lstat() {
        fileOperations += 1;
        throw new Error('must not read');
      },
      async readFile() {
        fileOperations += 1;
        throw new Error('must not read');
      },
    },

    spawnProcess() {
      spawns += 1;
      throw new Error('must not authenticate');
    },
  });

  const result = await dependencies.executeSelectedProductPreview(
    approval(),
  );

  assert.equal(result.safe_error_code, 'preview_transport_not_configured');
  assert.equal(fileOperations, 0);
  assert.equal(spawns, 0);
});

test('source-store mismatch blocks authentication, Commander transport, and submission', async () => {
  const { filesystem } = createFixtureFilesystem({
    selectedArtifact: artifact('ZZ999'),
  });

  let spawns = 0;
  let requests = 0;
  let submissions = 0;

  const dependencies = createSelectedProductPreviewDependencies({
    moduleUrl,
    platform: 'win32',
    filesystem,

    spawnProcess() {
      spawns += 1;
      throw new Error('must not authenticate');
    },

    commanderTransport: async () => {
      requests += 1;
      throw new Error('must not request');
    },

    submitPreview: async () => {
      submissions += 1;
      throw new Error('must not submit');
    },
  });

  const result = await dependencies.executeSelectedProductPreview(
    approval(),
  );

  assert.equal(result.safe_error_code, 'source_store_mismatch');
  assert.equal(spawns, 0);
  assert.equal(requests, 0);
  assert.equal(submissions, 0);
});

test('missing fixed trust blocks authentication, Commander transport, and submission', async () => {
  const missingCa =
    'C:\\ProgramData\\StorePulse\\certificates\\commander-ca.pem';
  const { filesystem } = createFixtureFilesystem({
    omit: missingCa,
  });

  let spawns = 0;
  let requests = 0;
  let submissions = 0;

  const dependencies = createSelectedProductPreviewDependencies({
    moduleUrl,
    platform: 'win32',
    filesystem,

    spawnProcess() {
      spawns += 1;
      throw new Error('must not authenticate');
    },

    commanderTransport: async () => {
      requests += 1;
      throw new Error('must not request');
    },

    submitPreview: async () => {
      submissions += 1;
      throw new Error('must not submit');
    },
  });

  const result = await dependencies.executeSelectedProductPreview(
    approval(),
  );

  assert.equal(result.safe_error_code, 'commander_ca_missing');
  assert.equal(spawns, 0);
  assert.equal(requests, 0);
  assert.equal(submissions, 0);
});

test('caller path and origin options cannot replace fixed paths', async () => {
  const { filesystem, touched } = createFixtureFilesystem();
  let submissions = 0;

  const dependencies = createSelectedProductPreviewDependencies({
    moduleUrl,
    platform: 'win32',
    filesystem,

    configPath: 'C:\\unsafe\\config.json',
    programData: 'C:\\unsafe',
    workerPath: 'C:\\unsafe\\worker.ps1',
    selectionArtifactPath: 'C:\\unsafe\\selection.json',
    origin: 'https://unsafe.example',

    spawnProcess: () => ({
      result: Promise.resolve({
        exitCode: 0,
        stdout: Buffer.from('{"cookie":"private-cookie"}'),
        stderr: Buffer.alloc(0),
      }),
    }),

    commanderTransport: async ({ url, body }) => {
      assert.equal(
        url,
        'https://commander.fixture/cgi-bin/NAXML?',
      );

      const identity = body.includes('00000000000014')
        ? ['00000000000014', '145']
        : ['00999999999993', '000'];

      return {
        status: 200,
        body: productXml(...identity),
      };
    },

    submitPreview: async () => {
      submissions += 1;
      return {
        status: 200,
        body: successBody(2, 2),
      };
    },

    clock: () => new Date('2026-07-31T15:00:00.000Z'),
  });

  const result = await dependencies.executeSelectedProductPreview(
    approval(),
  );

  assert.equal(result.ok, true);
  assert.equal(submissions, 1);

  const touchedPaths = touched.map(([, file]) => file);
  assert.equal(
    touchedPaths.some((file) => file.startsWith('C:\\unsafe')),
    false,
  );
  assert.equal(
    touchedPaths.includes(
      SELECTED_PRODUCT_PREVIEW_FIXED_PATHS.configPath,
    ),
    true,
  );
  assert.equal(
    touchedPaths.includes(packagePaths.selectionArtifactPath),
    true,
  );
});

test('session cleanup runs after preview submission failure', async () => {
  const { filesystem } = createFixtureFilesystem();
  let shutdowns = 0;

  const dependencies = createSelectedProductPreviewDependencies({
    moduleUrl,
    platform: 'win32',
    filesystem,

    spawnProcess: () => {
      throw new Error('custom session manager should avoid spawn');
    },

    sessionManagerFactory: () => ({
      async withSession(work) {
        return work('private-cookie');
      },
      shutdown() {
        shutdowns += 1;
      },
    }),

    commanderTransport: async ({ body }) => {
      const identity = body.includes('00000000000014')
        ? ['00000000000014', '145']
        : ['00999999999993', '000'];

      return {
        status: 200,
        body: productXml(...identity),
      };
    },

    submitPreview: async () => {
      throw new Error('offline submission failure');
    },

    clock: () => new Date('2026-07-31T15:00:00.000Z'),
  });

  const result = await dependencies.executeSelectedProductPreview(
    approval(),
  );

  assert.equal(result.safe_error_code, 'preview_submission_failed');
  assert.equal(shutdowns, 1);
});

test('approval and dependency failures are safe and execute no work', async () => {
  const cases = [
    [{}, 'invalid_input'],
    [{ approval: null }, 'approval_required'],
    [{
      approval: {
        approved: false,
        operation: 'preview_selected_products',
        supervised: true,
        preview_only: true,
        selected_products_reviewed: true,
      },
    }, 'approval_required'],
    [{
      approval: {
        approved: true,
        operation: 'wrong_operation',
        supervised: true,
        preview_only: true,
        selected_products_reviewed: true,
      },
    }, 'approval_mismatch'],
    [{
      approval: {
        approved: true,
        operation: 'preview_selected_products',
        supervised: false,
        preview_only: true,
        selected_products_reviewed: true,
      },
    }, 'approval_invalid'],
  ];

  for (const [input, expectedCode] of cases) {
    let fileOperations = 0;

    const dependencies = createSelectedProductPreviewDependencies({
      moduleUrl,
      platform: 'win32',

      filesystem: {
        async lstat() {
          fileOperations += 1;
          throw new Error('must not read');
        },
        async readFile() {
          fileOperations += 1;
          throw new Error('must not read');
        },
      },

      submitPreview: async () => {
        throw new Error('must not submit');
      },
    });

    const result = await dependencies.executeSelectedProductPreview(
      input,
    );

    assert.equal(result.safe_error_code, expectedCode);
    assert.equal(fileOperations, 0);
  }
});
