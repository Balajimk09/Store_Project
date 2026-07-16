import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { Client } from 'pg';

const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function assertLocalDatabaseUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const isExpectedLocalDatabase = parsed.protocol === 'postgresql:'
    && parsed.hostname === '127.0.0.1'
    && parsed.port === '54322'
    && parsed.pathname === '/postgres'
    && parsed.username === 'postgres';

  if (!isExpectedLocalDatabase) {
    throw new Error('POS publish SQL tests may only connect to the local Supabase database.');
  }
}

function localTestError(message) {
  return new Error(`POS publish SQL test failed: ${message}`);
}

async function expectDatabaseFailure(client, action) {
  await client.query('savepoint expect_database_failure');
  let failed = false;

  try {
    await action();
  } catch {
    failed = true;
  } finally {
    await client.query('rollback to savepoint expect_database_failure');
    await client.query('release savepoint expect_database_failure');
  }

  assert.equal(failed, true, 'Expected the database operation to fail.');
}

function newIdempotencyKey() {
  return `local-publish-job-${randomUUID()}`;
}

async function createFixtures(client) {
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();
  const storeId = randomUUID();
  const otherStoreId = randomUUID();
  const productId = randomUUID();
  const otherProductId = randomUUID();
  const connectorId = randomUUID();
  const otherConnectorId = randomUUID();

  await client.query(
    `insert into auth.users (
      id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data
    ) values
      ($1, 'authenticated', 'authenticated', $2, 'local-test-password-hash', now(), '{}'::jsonb, '{}'::jsonb),
      ($3, 'authenticated', 'authenticated', $4, 'local-test-password-hash', now(), '{}'::jsonb, '{}'::jsonb)`,
    [ownerId, `queue-owner-${ownerId}@local.test`, otherOwnerId, `queue-other-${otherOwnerId}@local.test`]
  );

  await client.query(
    `insert into public.stores (id, owner_id, store_name) values
      ($1, $2, 'Local queue test store'),
      ($3, $4, 'Other local queue test store')`,
    [storeId, ownerId, otherStoreId, otherOwnerId]
  );

  await client.query(
    `insert into public.products (
      id, store_id, owner_id, upc, name, category, brand, cost_price, selling_price, stock, reorder_level, vendor
    ) values
      ($1, $2, $3, '00000000000001', 'Local queue test product', 'Test', 'StorePulse', 1, 1, 1, 0, 'Local'),
      ($4, $5, $6, '00000000000002', 'Other local queue test product', 'Test', 'StorePulse', 1, 1, 1, 0, 'Local')`,
    [productId, storeId, ownerId, otherProductId, otherStoreId, otherOwnerId]
  );

  await client.query(
    `insert into public.store_pos_connectors (
      id, store_id, connector_name, source_system, token_hash, status, metadata
    ) values
      ($1, $2, 'Local queue test connector', 'verifone', $3, 'active', '{}'::jsonb),
      ($4, $5, 'Other local queue test connector', 'verifone', $6, 'active', '{}'::jsonb)`,
    [
      connectorId,
      storeId,
      `local-fixture-hash-${connectorId}`,
      otherConnectorId,
      otherStoreId,
      `local-fixture-hash-${otherConnectorId}`,
    ]
  );

  return {
    ownerId,
    otherOwnerId,
    storeId,
    otherStoreId,
    productId,
    otherProductId,
    connectorId,
    otherConnectorId,
  };
}

async function insertPendingJob(client, fixtures, overrides = {}) {
  const values = {
    id: randomUUID(),
    storeId: fixtures.storeId,
    productId: fixtures.productId,
    requestedBy: fixtures.ownerId,
    connectorId: fixtures.connectorId,
    operation: 'update_price',
    status: 'pending',
    payload: { price: 1.25 },
    requestedPrice: 1.25,
    idempotencyKey: newIdempotencyKey(),
    ...overrides,
  };

  const { rows } = await client.query(
    `insert into public.pos_publish_jobs (
      id, store_id, product_id, requested_by, assigned_connector_id, operation, status,
      payload, requested_price, idempotency_key
    ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::numeric, $10)
    returning id`,
    [
      values.id,
      values.storeId,
      values.productId,
      values.requestedBy,
      values.connectorId,
      values.operation,
      values.status,
      JSON.stringify(values.payload),
      values.requestedPrice,
      values.idempotencyKey,
    ]
  );

  return rows[0].id;
}

async function claimJob(client, jobId, connectorId) {
  await client.query(
    `update public.pos_publish_jobs
     set status = 'claimed', claimed_by_connector_id = $2, claimed_at = now()
     where id = $1`,
    [jobId, connectorId]
  );
}

async function setAuthenticatedUser(client, userId) {
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

async function resetRole(client) {
  await client.query('reset role');
}

async function run() {
  assertLocalDatabaseUrl(LOCAL_DATABASE_URL);
  const client = new Client({
    connectionString: LOCAL_DATABASE_URL,
    application_name: 'storepulse-pos-publish-jobs-sql-test',
  });

  try {
    await client.connect();
  } catch {
    throw localTestError('local Supabase is not reachable. Start the local stack before running this test.');
  }

  let passed = 0;
  let failed = 0;
  const failures = [];

  async function sqlTest(name, action) {
    try {
      await action();
      passed += 1;
      process.stdout.write(`ok - ${name}\n`);
    } catch (error) {
      failed += 1;
      failures.push(name);
      process.stderr.write(`not ok - ${name}\n`);
      if (error instanceof Error && error.message.startsWith('POS publish SQL test failed:')) {
        process.stderr.write(`${error.message}\n`);
      }
    }
  }

  try {
    await client.query('begin');
    const fixtures = await createFixtures(client);

    await sqlTest('valid pending update_price job succeeds', async () => {
      const jobId = await insertPendingJob(client, fixtures);
      const { rows } = await client.query('select status, operation from public.pos_publish_jobs where id = $1', [jobId]);
      assert.deepEqual(rows[0], { status: 'pending', operation: 'update_price' });
    });

    await sqlTest('unsupported operation fails', () => expectDatabaseFailure(client, () => insertPendingJob(client, fixtures, { operation: 'unsupported' })));
    await sqlTest('invalid status fails', () => expectDatabaseFailure(client, () => insertPendingJob(client, fixtures, { status: 'invalid' })));
    await sqlTest('missing requested payload price fails', () => expectDatabaseFailure(client, () => insertPendingJob(client, fixtures, { payload: {} })));
    await sqlTest('extra requested payload fields fail', () => expectDatabaseFailure(client, () => insertPendingJob(client, fixtures, { payload: { price: 1.25, extra: 'nope' } })));
    await sqlTest('zero price fails', () => expectDatabaseFailure(client, () => insertPendingJob(client, fixtures, { payload: { price: 0 }, requestedPrice: 0 })));
    await sqlTest('negative price fails', () => expectDatabaseFailure(client, () => insertPendingJob(client, fixtures, { payload: { price: -1 }, requestedPrice: -1 })));
    await sqlTest('price with more than two decimal places fails', () => expectDatabaseFailure(client, () => insertPendingJob(client, fixtures, { payload: { price: 1.001 }, requestedPrice: 1.001 })));

    await sqlTest('duplicate idempotency key fails', async () => {
      const idempotencyKey = newIdempotencyKey();
      await insertPendingJob(client, fixtures, { idempotencyKey });
      await expectDatabaseFailure(client, () => insertPendingJob(client, fixtures, { idempotencyKey }));
    });

    await sqlTest('pending to claimed succeeds', async () => {
      const jobId = await insertPendingJob(client, fixtures);
      await claimJob(client, jobId, fixtures.connectorId);
      const { rows } = await client.query('select status, claimed_at from public.pos_publish_jobs where id = $1', [jobId]);
      assert.equal(rows[0].status, 'claimed');
      assert.notEqual(rows[0].claimed_at, null);
    });

    await sqlTest('claimed to sending succeeds', async () => {
      const jobId = await insertPendingJob(client, fixtures);
      await claimJob(client, jobId, fixtures.connectorId);
      await client.query("update public.pos_publish_jobs set status = 'sending' where id = $1", [jobId]);
      const { rows } = await client.query('select status from public.pos_publish_jobs where id = $1', [jobId]);
      assert.equal(rows[0].status, 'sending');
    });

    await sqlTest('sending to verifying succeeds', async () => {
      const jobId = await insertPendingJob(client, fixtures);
      await claimJob(client, jobId, fixtures.connectorId);
      await client.query("update public.pos_publish_jobs set status = 'sending' where id = $1", [jobId]);
      await client.query("update public.pos_publish_jobs set status = 'verifying' where id = $1", [jobId]);
      const { rows } = await client.query('select status from public.pos_publish_jobs where id = $1', [jobId]);
      assert.equal(rows[0].status, 'verifying');
    });

    await sqlTest('verifying to completed succeeds', async () => {
      const jobId = await insertPendingJob(client, fixtures);
      await claimJob(client, jobId, fixtures.connectorId);
      await client.query("update public.pos_publish_jobs set status = 'sending' where id = $1", [jobId]);
      await client.query("update public.pos_publish_jobs set status = 'verifying' where id = $1", [jobId]);
      await client.query("update public.pos_publish_jobs set status = 'completed', completed_at = now() where id = $1", [jobId]);
      const { rows } = await client.query('select status, completed_at from public.pos_publish_jobs where id = $1', [jobId]);
      assert.equal(rows[0].status, 'completed');
      assert.notEqual(rows[0].completed_at, null);
    });

    await sqlTest('pending to completed fails', async () => {
      const jobId = await insertPendingJob(client, fixtures);
      await expectDatabaseFailure(client, () => client.query("update public.pos_publish_jobs set status = 'completed', completed_at = now() where id = $1", [jobId]));
    });

    await sqlTest('completed business fields cannot be modified', async () => {
      const jobId = await insertPendingJob(client, fixtures);
      await claimJob(client, jobId, fixtures.connectorId);
      await client.query("update public.pos_publish_jobs set status = 'sending' where id = $1", [jobId]);
      await client.query("update public.pos_publish_jobs set status = 'verifying' where id = $1", [jobId]);
      await client.query("update public.pos_publish_jobs set status = 'completed', completed_at = now() where id = $1", [jobId]);
      await expectDatabaseFailure(client, () => client.query('update public.pos_publish_jobs set requested_price = 2 where id = $1', [jobId]));
    });

    await sqlTest('credential and command-like payload keys fail', async () => {
      for (const forbiddenKey of ['credentials', 'password', 'token', 'session', 'cookie', 'url', 'xml', 'command', 'arbitrary_data']) {
        await expectDatabaseFailure(client, () => insertPendingJob(client, fixtures, { payload: { price: 1.25, [forbiddenKey]: 'blocked' } }));
      }
    });

    await sqlTest('pending polling index exists', async () => {
      const { rows } = await client.query("select indexname from pg_indexes where schemaname = 'public' and indexname = 'pos_publish_jobs_pending_connector_idx'");
      assert.equal(rows.length, 1);
    });
    await sqlTest('store filtering index exists', async () => {
      const { rows } = await client.query("select indexname from pg_indexes where schemaname = 'public' and indexname = 'pos_publish_jobs_store_created_idx'");
      assert.equal(rows.length, 1);
    });
    await sqlTest('unique idempotency index exists', async () => {
      const { rows } = await client.query("select indexname from pg_indexes where schemaname = 'public' and indexname = 'pos_publish_jobs_idempotency_key_uidx'");
      assert.equal(rows.length, 1);
    });
    await sqlTest('RLS is enabled', async () => {
      const { rows } = await client.query("select relrowsecurity from pg_class where oid = 'public.pos_publish_jobs'::regclass");
      assert.equal(rows[0].relrowsecurity, true);
    });

    await sqlTest('authenticated store users cannot directly insert jobs', async () => {
      await setAuthenticatedUser(client, fixtures.ownerId);
      try {
        await expectDatabaseFailure(client, () => insertPendingJob(client, fixtures));
      } finally {
        await resetRole(client);
      }
    });

    const ownJobId = await insertPendingJob(client, fixtures);
    const otherJobId = await insertPendingJob(client, fixtures, {
      storeId: fixtures.otherStoreId,
      productId: fixtures.otherProductId,
      requestedBy: fixtures.otherOwnerId,
      connectorId: fixtures.otherConnectorId,
    });

    await sqlTest('store users can read jobs for their store', async () => {
      await setAuthenticatedUser(client, fixtures.ownerId);
      try {
        const { rows } = await client.query('select id from public.pos_publish_jobs where id = $1', [ownJobId]);
        assert.equal(rows.length, 1);
      } finally {
        await resetRole(client);
      }
    });

    await sqlTest('store users cannot read jobs for another store', async () => {
      await setAuthenticatedUser(client, fixtures.ownerId);
      try {
        const { rows } = await client.query('select id from public.pos_publish_jobs where id = $1', [otherJobId]);
        assert.equal(rows.length, 0);
      } finally {
        await resetRole(client);
      }
    });

    await sqlTest('connector claims require the assigned connector from the same store', async () => {
      const jobId = await insertPendingJob(client, fixtures);
      await expectDatabaseFailure(client, () => claimJob(client, jobId, fixtures.otherConnectorId));
      await expectDatabaseFailure(client, () => insertPendingJob(client, fixtures, { connectorId: fixtures.otherConnectorId }));
      await claimJob(client, jobId, fixtures.connectorId);
    });

    await sqlTest('completed_at and failed_at obey transition rules', async () => {
      const completeJobId = await insertPendingJob(client, fixtures);
      await claimJob(client, completeJobId, fixtures.connectorId);
      await client.query("update public.pos_publish_jobs set status = 'sending' where id = $1", [completeJobId]);
      await client.query("update public.pos_publish_jobs set status = 'verifying' where id = $1", [completeJobId]);
      await expectDatabaseFailure(client, () => client.query("update public.pos_publish_jobs set status = 'completed' where id = $1", [completeJobId]));
      await client.query("update public.pos_publish_jobs set status = 'completed', completed_at = now() where id = $1", [completeJobId]);

      const failedJobId = await insertPendingJob(client, fixtures);
      await claimJob(client, failedJobId, fixtures.connectorId);
      await client.query("update public.pos_publish_jobs set status = 'sending' where id = $1", [failedJobId]);
      await client.query("update public.pos_publish_jobs set status = 'verifying' where id = $1", [failedJobId]);
      await expectDatabaseFailure(client, () => client.query("update public.pos_publish_jobs set status = 'failed' where id = $1", [failedJobId]));
      await client.query("update public.pos_publish_jobs set status = 'failed', failed_at = now() where id = $1", [failedJobId]);
    });
  } finally {
    await client.query('rollback');
    await client.end();
  }

  process.stdout.write(`SQL tests: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw localTestError(`${failed} local SQL test${failed === 1 ? '' : 's'} failed: ${failures.join(', ')}`);
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : 'POS publish SQL tests failed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
