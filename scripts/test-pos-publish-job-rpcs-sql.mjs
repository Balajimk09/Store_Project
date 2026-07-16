import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';

const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function assertLocalDatabaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '54322' || url.pathname !== '/postgres') {
    throw new Error('POS publish RPC SQL tests may only connect to the local Supabase database.');
  }
}

const idempotencyKey = () => `local-rpc-${randomUUID()}`;
const tokenHash = (value) => createHash('sha256').update(value).digest('hex');

async function createFixtures(client) {
  const ids = Object.fromEntries(['owner', 'otherOwner', 'store', 'otherStore', 'product', 'otherProduct', 'connector', 'sameStoreOtherConnector', 'otherConnector'].map((key) => [key, randomUUID()]));
  await client.query(
    `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
     values ($1, 'authenticated', 'authenticated', $2, 'local-test-password-hash', now(), '{}'::jsonb, '{}'::jsonb),
            ($3, 'authenticated', 'authenticated', $4, 'local-test-password-hash', now(), '{}'::jsonb, '{}'::jsonb)`,
    [ids.owner, `rpc-owner-${ids.owner}@local.test`, ids.otherOwner, `rpc-other-${ids.otherOwner}@local.test`]
  );
  await client.query(`insert into public.stores (id, owner_id, store_name) values ($1, $2, 'Local RPC test store'), ($3, $4, 'Other local RPC test store')`, [ids.store, ids.owner, ids.otherStore, ids.otherOwner]);
  await client.query(
    `insert into public.products (id, store_id, owner_id, upc, name, category, brand, cost_price, selling_price, stock, reorder_level)
     values ($1, $2, $3, '0123456789012', 'Local RPC product', 'Test', 'StorePulse', 1, 1, 1, 0),
            ($4, $5, $6, '0987654321098', 'Other RPC product', 'Test', 'StorePulse', 1, 1, 1, 0)`,
    [ids.product, ids.store, ids.owner, ids.otherProduct, ids.otherStore, ids.otherOwner]
  );
  await client.query(
    `insert into public.store_pos_connectors (id, store_id, connector_name, source_system, token_hash, status, metadata)
     values ($1, $2, 'Local RPC connector', 'verifone_commander', $3, 'active', '{}'::jsonb),
            ($4, $2, 'Same-store RPC connector', 'verifone_commander', $5, 'active', '{}'::jsonb),
            ($6, $7, 'Other RPC connector', 'verifone_commander', $8, 'active', '{}'::jsonb)`,
    [
      ids.connector,
      ids.store,
      tokenHash(`fixture-${ids.connector}`),
      ids.sameStoreOtherConnector,
      tokenHash(`fixture-${ids.sameStoreOtherConnector}`),
      ids.otherConnector,
      ids.otherStore,
      tokenHash(`fixture-${ids.otherConnector}`),
    ]
  );
  return ids;
}

async function insertJob(client, ids, overrides = {}) {
  const values = { store: ids.store, product: ids.product, owner: ids.owner, connector: ids.connector, upc: '0123456789012', price: 1.25, key: idempotencyKey(), ...overrides };
  const { rows } = await client.query(
    `insert into public.pos_publish_jobs (store_id, product_id, requested_by, assigned_connector_id, operation, status, payload, requested_price, idempotency_key)
     values ($1, $2, $3, $4, 'update_price', 'pending', jsonb_build_object('price', $5::numeric), $5::numeric, $6)
     returning id`,
    [values.store, values.product, values.owner, values.connector, values.price, values.key]
  );
  return rows[0].id;
}

async function rpcClaim(client, connectorId) {
  const { rows } = await client.query('select * from public.claim_pos_publish_job($1)', [connectorId]);
  return rows[0] ?? null;
}

async function rpcReport(client, connectorId, jobId, status, options = {}) {
  const { rows } = await client.query(
    'select * from public.report_pos_publish_job_status($1, $2, $3, $4, $5, $6, $7)',
    [connectorId, jobId, status, options.upc ?? null, options.price ?? null, options.code ?? null, options.message ?? null]
  );
  return rows[0] ?? null;
}

async function cancelPendingJobs(client, connectorId) {
  await client.query("update public.pos_publish_jobs set status = 'cancelled' where assigned_connector_id = $1 and status = 'pending'", [connectorId]);
}

async function expectFailure(client, action) {
  await client.query('savepoint expected_failure');
  let failed = false;
  try { await action(); } catch { failed = true; }
  await client.query('rollback to savepoint expected_failure');
  await client.query('release savepoint expected_failure');
  assert.equal(failed, true, 'Expected database operation to fail.');
}

async function run() {
  assertLocalDatabaseUrl(LOCAL_DATABASE_URL);
  const client = new Client({ connectionString: LOCAL_DATABASE_URL, application_name: 'storepulse-pos-publish-rpc-sql-test' });
  try { await client.connect(); } catch { throw new Error('POS publish RPC SQL test failed: local Supabase is not reachable.'); }
  let passed = 0;
  let failed = 0;
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);

  let ids;
  try {
    await client.query('begin');
    ids = await createFixtures(client);

    test('anon, authenticated, and public roles cannot execute queue RPCs directly while service_role can', async () => {
      const { rows } = await client.query(`select
        has_function_privilege('anon', 'public.claim_pos_publish_job(uuid)', 'execute') as anon_claim,
        has_function_privilege('authenticated', 'public.claim_pos_publish_job(uuid)', 'execute') as auth_claim,
        has_function_privilege('authenticated', 'public.report_pos_publish_job_status(uuid,uuid,text,text,numeric,text,text)', 'execute') as auth_report,
        has_function_privilege('public', 'public.claim_pos_publish_job(uuid)', 'execute') as public_claim,
        has_function_privilege('service_role', 'public.claim_pos_publish_job(uuid)', 'execute') as service_claim,
        has_function_privilege('service_role', 'public.report_pos_publish_job_status(uuid,uuid,text,text,numeric,text,text)', 'execute') as service_report`);
      assert.deepEqual(rows[0], { anon_claim: false, auth_claim: false, auth_report: false, public_claim: false, service_claim: true, service_report: true });
    });
    test('no job returns no claim result', async () => assert.equal(await rpcClaim(client, ids.connector), null));
    test('claims the oldest pending job for the assigned connector only', async () => {
      await cancelPendingJobs(client, ids.connector);
      const first = await insertJob(client, ids); await new Promise((resolve) => setTimeout(resolve, 3)); const second = await insertJob(client, ids);
      const { rows: expectedRows } = await client.query("select id from public.pos_publish_jobs where id in ($1, $2) order by created_at asc, id asc limit 1", [first, second]);
      const claim = await rpcClaim(client, ids.connector);
      assert.equal(claim.job_id, expectedRows[0].id); assert.equal(claim.operation, 'update_price'); assert.equal(claim.price, '1.25'); assert.equal(claim.upc, '0123456789012');
      assert.equal(await rpcClaim(client, ids.otherConnector), null);
      const { rows } = await client.query("select count(*)::int as pending_count from public.pos_publish_jobs where id in ($1, $2) and status = 'pending'", [first, second]); assert.equal(rows[0].pending_count, 1);
      await cancelPendingJobs(client, ids.connector);
    });
    test('invalid product relationship, missing product, UPC, and price safely fail jobs without returning work', async () => {
      await cancelPendingJobs(client, ids.connector);

      const mismatchJobId = await insertJob(client, ids, { product: ids.otherProduct });
      assert.equal(await rpcClaim(client, ids.connector), null);
      let { rows } = await client.query('select status, audit_metadata ->> \'failure_code\' as code, audit_metadata ->> \'completion_note\' as note from public.pos_publish_jobs where id = $1', [mismatchJobId]);
      assert.deepEqual(rows[0], { status: 'failed', code: 'product_store_mismatch', note: null });

      const missingJobId = await insertJob(client, ids);
      await client.query('alter table public.pos_publish_jobs drop constraint pos_publish_jobs_product_id_fkey');
      await client.query('delete from public.products where id = $1', [ids.product]);
      assert.equal(await rpcClaim(client, ids.connector), null);
      ({ rows } = await client.query('select status, audit_metadata ->> \'failure_code\' as code from public.pos_publish_jobs where id = $1', [missingJobId]));
      assert.deepEqual(rows[0], { status: 'failed', code: 'product_store_mismatch' });
      await client.query("insert into public.products (id, store_id, owner_id, upc, name, category, brand, cost_price, selling_price, stock, reorder_level) values ($1, $2, $3, '0123456789012', 'Local RPC product', 'Test', 'StorePulse', 1, 1, 1, 0)", [ids.product, ids.store, ids.owner]);

      await client.query("update public.products set upc = 'bad-upc' where id = $1", [ids.product]);
      const jobId = await insertJob(client, ids); assert.equal(await rpcClaim(client, ids.connector), null);
      ({ rows } = await client.query('select status, audit_metadata ->> \'failure_code\' as code from public.pos_publish_jobs where id = $1', [jobId]));
      assert.deepEqual(rows[0], { status: 'failed', code: 'invalid_product_upc' });
      await client.query("update public.products set upc = '0123456789012' where id = $1", [ids.product]);

      const invalidPriceJobId = await insertJob(client, ids);
      await client.query('alter table public.pos_publish_jobs drop constraint pos_publish_jobs_requested_price_check');
      await client.query('alter table public.pos_publish_jobs drop constraint pos_publish_jobs_payload_check');
      await client.query('alter table public.pos_publish_jobs disable trigger enforce_pos_publish_job_integrity');
      await client.query('update public.pos_publish_jobs set requested_price = 0 where id = $1', [invalidPriceJobId]);
      await client.query('alter table public.pos_publish_jobs enable trigger enforce_pos_publish_job_integrity');
      assert.equal(await rpcClaim(client, ids.connector), null);
      ({ rows } = await client.query('select status, audit_metadata ->> \'failure_code\' as code from public.pos_publish_jobs where id = $1', [invalidPriceJobId]));
      assert.deepEqual(rows[0], { status: 'failed', code: 'invalid_requested_price' });
    });
    test('report RPC enforces sending, verifying, and matching completion', async () => {
      await cancelPendingJobs(client, ids.connector);
      await insertJob(client, ids);
      const claimed = await rpcClaim(client, ids.connector);
      const jobId = claimed.job_id;
      assert.equal((await rpcReport(client, ids.connector, jobId, 'sending')).status, 'sending');
      assert.equal((await rpcReport(client, ids.connector, jobId, 'verifying')).status, 'verifying');
      await expectFailure(client, () => rpcReport(client, ids.connector, jobId, 'completed', { upc: '0000000000000', price: 1.25 }));
      await expectFailure(client, () => rpcReport(client, ids.connector, jobId, 'completed', { upc: '0123456789012', price: 1.26 }));
      assert.equal((await rpcReport(client, ids.connector, jobId, 'completed', { upc: '0123456789012', price: 1.25 })).status, 'completed');
      await expectFailure(client, () => rpcReport(client, ids.connector, jobId, 'sending'));
    });
    test('report RPC prevents wrong and cross-store connectors, pending completion, unsafe failures, and unknown codes', async () => {
      await cancelPendingJobs(client, ids.connector);
      const jobId = await insertJob(client, ids);
      await expectFailure(client, () => rpcReport(client, ids.sameStoreOtherConnector, jobId, 'sending'));
      await expectFailure(client, () => rpcReport(client, ids.otherConnector, jobId, 'sending'));
      await expectFailure(client, () => rpcReport(client, ids.connector, jobId, 'completed', { upc: '0123456789012', price: 1.25 }));
      const claimed = await rpcClaim(client, ids.connector);
      await expectFailure(client, () => rpcReport(client, ids.connector, claimed.job_id, 'failed', { code: 'unknown_code', message: 'safe message' }));
      await expectFailure(client, () => rpcReport(client, ids.connector, claimed.job_id, 'failed', { code: 'internal_connector_error', message: 'token=secret' }));
      await expectFailure(client, () => rpcReport(client, ids.connector, claimed.job_id, 'failed', { code: 'internal_connector_error', message: 'service-role credential failure' }));
      await expectFailure(client, () => rpcReport(client, ids.connector, claimed.job_id, 'failed', { code: 'internal_connector_error', message: 'service-role value' }));
      assert.equal((await rpcReport(client, ids.connector, claimed.job_id, 'failed', { code: 'update_rejected', message: 'Update was rejected.' })).status, 'failed');
      await expectFailure(client, () => rpcReport(client, ids.connector, claimed.job_id, 'sending'));
    });

    for (const [name, fn] of tests) {
      try { await fn(); passed += 1; process.stdout.write(`ok - ${name}\n`); }
      catch (error) {
        failed += 1;
        process.stderr.write(`not ok - ${name}\n`);
        if (error instanceof Error) process.stderr.write(`${error.message}\n`);
      }
    }
  } finally {
    await client.query('rollback');
    await client.end();
  }

  // A separate committed fixture is required to make it visible to two independent claim transactions.
  // It is uniquely identified and explicitly removed in finally because one transaction cannot span both sessions.
  const setup = new Client({ connectionString: LOCAL_DATABASE_URL, application_name: 'storepulse-pos-publish-rpc-concurrency-setup' });
  await setup.connect();
  let concurrencyIds;
  try {
    concurrencyIds = await createFixtures(setup);
    await insertJob(setup, concurrencyIds);
    const first = new Client({ connectionString: LOCAL_DATABASE_URL, application_name: 'storepulse-pos-publish-rpc-concurrency-a' });
    const second = new Client({ connectionString: LOCAL_DATABASE_URL, application_name: 'storepulse-pos-publish-rpc-concurrency-b' });
    await Promise.all([first.connect(), second.connect()]);
    try {
      const [claimA, claimB] = await Promise.all([rpcClaim(first, concurrencyIds.connector), rpcClaim(second, concurrencyIds.connector)]);
      assert.equal([claimA, claimB].filter(Boolean).length, 1, 'two concurrent claims must not receive the same job');
      passed += 1; process.stdout.write('ok - two concurrent claims cannot receive the same job\n');
    } catch { failed += 1; process.stderr.write('not ok - two concurrent claims cannot receive the same job\n'); }
    finally { await Promise.all([first.end(), second.end()]); }
  } finally {
    if (concurrencyIds) {
      await setup.query('delete from public.pos_publish_jobs where store_id in ($1, $2)', [concurrencyIds.store, concurrencyIds.otherStore]);
      await setup.query('delete from public.products where store_id in ($1, $2)', [concurrencyIds.store, concurrencyIds.otherStore]);
      await setup.query('delete from public.store_pos_connectors where store_id in ($1, $2)', [concurrencyIds.store, concurrencyIds.otherStore]);
      await setup.query('delete from public.stores where id in ($1, $2)', [concurrencyIds.store, concurrencyIds.otherStore]);
      await setup.query('delete from auth.users where id in ($1, $2)', [concurrencyIds.owner, concurrencyIds.otherOwner]);
      const { rows } = await setup.query(`select
        (select count(*)::int from public.pos_publish_jobs where store_id in ($1, $2)) as jobs,
        (select count(*)::int from public.products where store_id in ($1, $2)) as products,
        (select count(*)::int from public.store_pos_connectors where store_id in ($1, $2)) as connectors,
        (select count(*)::int from public.stores where id in ($1, $2)) as stores,
        (select count(*)::int from auth.users where id in ($3, $4)) as users`, [concurrencyIds.store, concurrencyIds.otherStore, concurrencyIds.owner, concurrencyIds.otherOwner]);
      assert.deepEqual(rows[0], { jobs: 0, products: 0, connectors: 0, stores: 0, users: 0 }, 'concurrency fixtures must be removed');
    }
    await setup.end();
  }

  process.stdout.write(`RPC SQL tests: ${passed} passed, ${failed} failed.\n`);
  if (failed) process.exitCode = 1;
}

run().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : 'RPC SQL test failed.'}\n`); process.exitCode = 1; });
