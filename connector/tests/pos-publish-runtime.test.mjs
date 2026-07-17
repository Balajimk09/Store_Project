import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  POS_PUBLISH_CHILD_ERROR_CODES,
  POS_PUBLISH_CHILD_OUTCOMES,
  POS_PUBLISH_CHILD_RESULT_KEYS,
  POS_PUBLISH_CHILD_STATES,
  POS_PUBLISH_PARENT_ERROR_CODES,
  createPosPublishRuntime,
  derivePosPublishEndpoints,
  loadStorePulseOriginPolicy,
  loadPosPublishResultContract,
  runPosPublishLoop,
  toSafePosPublishChildResult,
  validatePosPublishPollSeconds,
} from '../lib/pos-publish-runtime.mjs'

const TOKEN = 'test-connector-token-0123456789abcdef'
const ORIGIN = 'https://kurnxpzcgcvsjmxsqjok.supabase.co'
const CLAIM_URL = `${ORIGIN}/functions/v1/claim-pos-publish-job`
const REPORT_URL = `${ORIGIN}/functions/v1/report-pos-publish-job-status`
const INGEST_URL = `${ORIGIN}/functions/v1/ingest-pos-transactions`
const HEARTBEAT_URL = `${ORIGIN}/functions/v1/report-pos-connector-heartbeat`

test('publishing defaults to disabled without API or Commander calls', async () => {
  let calls = 0
  const runtime = createPosPublishRuntime({
    apiClientFactory: () => { calls += 1; throw new Error('must not create client') },
    commanderAdapter: { updatePrice() {}, readProduct() {} },
  })
  assert.deepEqual(await runtime.processOne(), { outcome: 'disabled', state: 'disabled' })
  assert.equal(calls, 0)
})

test('publishing endpoints derive only from a trusted exact source endpoint', () => {
  assert.deepEqual(derivePosPublishEndpoints({ trustedSourceEndpointUrl: INGEST_URL }), {
    baseUrl: ORIGIN, claimEndpointUrl: CLAIM_URL, reportEndpointUrl: REPORT_URL,
  })
  assert.deepEqual(derivePosPublishEndpoints({ trustedSourceEndpointUrl: HEARTBEAT_URL }), {
    baseUrl: ORIGIN, claimEndpointUrl: CLAIM_URL, reportEndpointUrl: REPORT_URL,
  })
  for (const value of [
    'https://attacker.example/functions/v1/ingest-pos-transactions', 'https://attacker.example/functions/v1/report-pos-connector-heartbeat',
    'https://kurnxpzcgcvsjmxsqjok.supabase.co.attacker.example/functions/v1/ingest-pos-transactions',
    'https://attacker-kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/ingest-pos-transactions',
    `${ORIGIN}:443/functions/v1/ingest-pos-transactions`, `${ORIGIN}:443/functions/v1/report-pos-connector-heartbeat`, `${ORIGIN}:444/functions/v1/ingest-pos-transactions`, `http://${ORIGIN.slice('https://'.length)}/functions/v1/ingest-pos-transactions`,
    `https://user@${ORIGIN.slice('https://'.length)}/functions/v1/ingest-pos-transactions`, `${INGEST_URL}?x=1`, `${INGEST_URL}#fragment`, `${ORIGIN}/functions/v1//ingest-pos-transactions`,
    `${ORIGIN}/functions/v1\\ingest-pos-transactions`, `${ORIGIN}/functions/v1/%2fingest-pos-transactions`, `${ORIGIN}/functions/v1/%5cingest-pos-transactions`, `${ORIGIN}/functions/v1/%2e%2e/ingest-pos-transactions`, `${ORIGIN}/functions/v1/%zz`,
    `${ORIGIN}/FUNCTIONS/v1/ingest-pos-transactions`, `${ORIGIN}/functions/V1/ingest-pos-transactions`, `${ORIGIN}/functions/v1/INGEST-POS-TRANSACTIONS`, `${ORIGIN}/functions/v1/InGeSt-PoS-tRaNsAcTiOnS`,
    `${ORIGIN}/FUNCTIONS/v1/report-pos-connector-heartbeat`, `${ORIGIN}/functions/V1/report-pos-connector-heartbeat`, `${ORIGIN}/functions/v1/REPORT-POS-CONNECTOR-HEARTBEAT`, `${ORIGIN}/functions/v1/RePoRt-PoS-cOnNeCtOr-HeArTbEaT`,
    'https://attacker.example/functions/v1/claim-pos-publish-job',
    'https://[::1/functions/v1/ingest-pos-transactions', 'https://::1/functions/v1/ingest-pos-transactions',
  ]) assert.throws(() => derivePosPublishEndpoints({ trustedSourceEndpointUrl: value }), /invalid_endpoint/)
  assert.throws(() => derivePosPublishEndpoints({ trustedSourceEndpointUrl: INGEST_URL, claimEndpointUrl: 'https://attacker.example/functions/v1/claim-pos-publish-job', reportEndpointUrl: 'https://attacker.example/functions/v1/report-pos-publish-job-status' }), /invalid_endpoint/)
  assert.throws(() => derivePosPublishEndpoints({ trustedSourceEndpointUrl: INGEST_URL, claimEndpointUrl: `${ORIGIN}:443/functions/v1/claim-pos-publish-job` }), /invalid_endpoint/)
  assert.throws(() => derivePosPublishEndpoints({ trustedSourceEndpointUrl: INGEST_URL, reportEndpointUrl: `${ORIGIN}:443/functions/v1/report-pos-publish-job-status` }), /invalid_endpoint/)
  assert.throws(() => derivePosPublishEndpoints({ trustedSourceEndpointUrl: INGEST_URL, claimEndpointUrl: `${ORIGIN}:444/functions/v1/claim-pos-publish-job` }), /invalid_endpoint/)
  let clientCreated = 0
  const runtime = createPosPublishRuntime({
    enabled: true, pollSeconds: 60, trustedSourceEndpointUrl: INGEST_URL,
    claimEndpointUrl: 'https://attacker.example/functions/v1/claim-pos-publish-job',
    reportEndpointUrl: 'https://attacker.example/functions/v1/report-pos-publish-job-status',
    connectorToken: TOKEN, commanderAdapter: { updatePrice() {}, readProduct() {} },
    apiClientFactory: () => { clientCreated += 1; return {} },
  })
  assert.equal(clientCreated, 0)
  return runtime.processOne().then((result) => assert.equal(result.outcome, 'configuration_error'))
})

test('origin policy fixtures fail closed and cannot replace the installed runtime policy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storepulse-origin-policy-'))
  try {
    const valid = { version: 1, allowed_https_origins: [ORIGIN] }
    const invalidPolicies = [
      '{',
      JSON.stringify({ ...valid, extra: true }),
      JSON.stringify({ allowed_https_origins: [ORIGIN] }),
      JSON.stringify({ version: 1 }),
      JSON.stringify({ ...valid, version: 0 }),
      JSON.stringify({ ...valid, version: 2 }),
      JSON.stringify({ ...valid, version: '1' }),
      JSON.stringify({ ...valid, version: null }),
      JSON.stringify({ ...valid, allowed_https_origins: [] }),
      JSON.stringify({ ...valid, allowed_https_origins: null }),
      JSON.stringify({ ...valid, allowed_https_origins: ORIGIN }),
      JSON.stringify({ ...valid, allowed_https_origins: [''] }),
      JSON.stringify({ ...valid, allowed_https_origins: ['   '] }),
      JSON.stringify({ ...valid, allowed_https_origins: [1] }),
      JSON.stringify({ ...valid, allowed_https_origins: [`${ORIGIN}/path`] }),
      JSON.stringify({ ...valid, allowed_https_origins: [`${ORIGIN}/`] }),
      JSON.stringify({ ...valid, allowed_https_origins: [`${ORIGIN}?x=1`] }),
      JSON.stringify({ ...valid, allowed_https_origins: [`${ORIGIN}#fragment`] }),
      JSON.stringify({ ...valid, allowed_https_origins: [`https://user@${ORIGIN.slice('https://'.length)}`] }),
      JSON.stringify({ ...valid, allowed_https_origins: [`http://${ORIGIN.slice('https://'.length)}`] }),
      JSON.stringify({ ...valid, allowed_https_origins: ['https://*.supabase.co'] }),
      JSON.stringify({ ...valid, allowed_https_origins: ['https://kurnxpzcgcvsjmxsqjok%2esupabase.co'] }),
      JSON.stringify({ ...valid, allowed_https_origins: [`${ORIGIN}:443`] }),
      JSON.stringify({ ...valid, allowed_https_origins: [`${ORIGIN}:444`] }),
      JSON.stringify({ ...valid, allowed_https_origins: [ORIGIN, ORIGIN] }),
    ]
    for (const value of invalidPolicies) {
      const path = join(dir, `${Math.random()}.json`)
      writeFileSync(path, value)
      assert.throws(() => loadStorePulseOriginPolicy(path), /invalid_origin_policy/)
    }
    assert.throws(() => loadStorePulseOriginPolicy(join(dir, 'missing.json')), /invalid_origin_policy/)
    let clientCalls = 0
    const runtime = createPosPublishRuntime({
      enabled: true, pollSeconds: 60, trustedSourceEndpointUrl: 'https://attacker.example/functions/v1/ingest-pos-transactions', connectorToken: TOKEN,
      commanderAdapter: { updatePrice() {}, readProduct() {} }, allowedOrigins: ['https://attacker.example'], originPolicyPath: join(dir, 'ignored.json'),
      apiClientFactory: () => { clientCalls += 1; return {} },
    })
    assert.equal((await runtime.processOne()).outcome, 'configuration_error')
    assert.equal(clientCalls, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('exact-origin rejection occurs before API, token, claim, or Commander work', async () => {
  for (const trustedSourceEndpointUrl of [
    `${ORIGIN}:443/functions/v1/ingest-pos-transactions`,
    `${ORIGIN}:443/functions/v1/report-pos-connector-heartbeat`,
    `${ORIGIN}:444/functions/v1/ingest-pos-transactions`,
    `${ORIGIN}:444/functions/v1/report-pos-connector-heartbeat`,
    'HTTPS://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/ingest-pos-transactions',
    'HTTPS://kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/report-pos-connector-heartbeat',
    'https://KURNXPZCGCVSJMXSQJOK.supabase.co/functions/v1/ingest-pos-transactions',
    'https://KURNXPZCGCVSJMXSQJOK.supabase.co/functions/v1/report-pos-connector-heartbeat',
    'https://Kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/ingest-pos-transactions',
    'https://attacker.example/functions/v1/ingest-pos-transactions',
    'https://attacker.example/functions/v1/report-pos-connector-heartbeat',
    'https://kurnxpzcgcvsjmxsqjok.supabase.co.attacker.example/functions/v1/ingest-pos-transactions',
    'https://attacker-kurnxpzcgcvsjmxsqjok.supabase.co/functions/v1/ingest-pos-transactions',
    `${ORIGIN}/FUNCTIONS/v1/ingest-pos-transactions`,
    `${ORIGIN}/functions/V1/ingest-pos-transactions`,
    `${ORIGIN}/functions/v1/INGEST-POS-TRANSACTIONS`,
    `${ORIGIN}/functions/v1/InGeSt-PoS-tRaNsAcTiOnS`,
    `${ORIGIN}/FUNCTIONS/v1/report-pos-connector-heartbeat`,
    `${ORIGIN}/functions/V1/report-pos-connector-heartbeat`,
    `${ORIGIN}/functions/v1/REPORT-POS-CONNECTOR-HEARTBEAT`,
    `${ORIGIN}/functions/v1/RePoRt-PoS-cOnNeCtOr-HeArTbEaT`,
  ]) {
    let apiClientCreated = 0
    let claimCalls = 0
    let commanderCalls = 0
    const runtime = createPosPublishRuntime({
      enabled: true,
      pollSeconds: 60,
      trustedSourceEndpointUrl,
      connectorToken: TOKEN,
      commanderAdapter: {
        async updatePrice() { commanderCalls += 1 },
        async readProduct() { commanderCalls += 1 },
      },
      apiClientFactory: () => {
        apiClientCreated += 1
        assert.fail('API client must not be created on policy rejection')
        return { async claim() { claimCalls += 1 } }
      },
    })
    assert.equal((await runtime.processOne()).outcome, 'configuration_error')
    assert.equal(apiClientCreated, 0)
    assert.equal(claimCalls, 0)
    assert.equal(commanderCalls, 0)
  }
})

test('poll interval validation rejects invalid and unreasonable values', () => {
  assert.equal(validatePosPublishPollSeconds(60), 60)
  for (const value of [0, -1, 29, 3601, 1.5, '60']) assert.throws(() => validatePosPublishPollSeconds(value), /invalid_poll_seconds/)
})

test('missing Commander adapter fails closed before claim work', async () => {
  let clientCreated = 0
  const runtime = createPosPublishRuntime({
    enabled: true, pollSeconds: 60, trustedSourceEndpointUrl: INGEST_URL, connectorToken: TOKEN,
    apiClientFactory: () => { clientCreated += 1; return {} },
  })
  assert.deepEqual(await runtime.processOne(), { outcome: 'configuration_error', state: 'configuration_error', last_error_code: 'commander_adapter_unavailable' })
  assert.equal(clientCreated, 0)
})

test('one job is processed per iteration and concurrent calls do not overlap', async () => {
  let processCalls = 0
  let release
  const wait = new Promise((resolve) => { release = resolve })
  const runtime = createPosPublishRuntime({
    enabled: true, pollSeconds: 60, trustedSourceEndpointUrl: INGEST_URL, connectorToken: TOKEN,
    commanderAdapter: { async updatePrice() {}, async readProduct() { return { upc: '00012345678901', price: '1.00' } } },
    apiClientFactory: () => ({}),
    workerFactory: () => ({ async processOne() { processCalls += 1; await wait; return { outcome: 'idle' } } }),
  })
  const first = runtime.processOne()
  assert.deepEqual(await runtime.processOne(), { outcome: 'busy', state: 'busy' })
  release()
  assert.deepEqual(await first, { outcome: 'idle', state: 'idle' })
  assert.equal(processCalls, 1)
})

test('idle and API failures sleep and do not stop the runtime loop', async () => {
  const outcomes = [{ outcome: 'idle', state: 'idle' }, { outcome: 'status_report_failed', state: 'status_report_failed' }]
  const sleeps = []
  const controller = new AbortController()
  const result = await runPosPublishLoop({
    runtime: { pollSeconds: 60, async processOne() { return outcomes.shift() } },
    signal: controller.signal,
    sleep: async (seconds) => { sleeps.push(seconds); if (sleeps.length === 2) controller.abort() },
  })
  assert.deepEqual(result.map((entry) => entry.outcome), ['idle', 'status_report_failed'])
  assert.deepEqual(sleeps, [60, 60])
})

test('runtime logs only allowlisted fields and logger failures are contained', async () => {
  const token = 'must-not-appear-connector-token-0123456789'
  const logs = []
  const runtime = createPosPublishRuntime({
    enabled: true, pollSeconds: 60, trustedSourceEndpointUrl: INGEST_URL, connectorToken: token,
    commanderAdapter: { updatePrice() {}, readProduct() {} },
    apiClientFactory: () => ({}),
    workerFactory: ({ logger }) => ({ async processOne() { logger({ event: 'test', token, upc: '00012345678901' }); return { outcome: 'completed', job_id: '11111111-1111-4111-8111-111111111111' } } }),
    logger: (entry) => { logs.push(entry); throw new Error(token) },
  })
  const result = await runtime.processOne()
  assert.equal(result.outcome, 'completed')
  assert.equal(JSON.stringify(logs).includes(token), false)
  assert.equal(JSON.stringify(logs).includes('00012345678901'), false)
})

test('stdin-only child configuration never reflects the connector token and fails closed before networking', async () => {
  const token = 'stdin-only-connector-token-0123456789abcdef'
  const child = spawn(process.execPath, ['connector/lib/pos-publish-runtime-entry.mjs'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.stdin.end(JSON.stringify({
    connector_token: token,
    trusted_source_endpoint_url: INGEST_URL,
    poll_seconds: 60,
    worker_version: 'offline-test.1',
  }))
  const exitCode = await new Promise((resolve) => child.once('exit', resolve))
  assert.equal(exitCode, 0)
  assert.deepEqual(JSON.parse(stdout), {
    outcome: 'configuration_error', state: 'configuration_error', last_job_id: null, last_error_code: 'commander_adapter_unavailable',
  })
  assert.equal(`${stdout}${stderr}`.includes(token), false)
})

test('child result contract has one exact allowlisted schema', () => {
  assert.deepEqual(POS_PUBLISH_CHILD_RESULT_KEYS, ['outcome', 'state', 'last_job_id', 'last_error_code'])
  assert.equal(POS_PUBLISH_CHILD_OUTCOMES.has('completed'), true)
  assert.equal(POS_PUBLISH_CHILD_STATES.has('error'), true)
  assert.equal(POS_PUBLISH_CHILD_ERROR_CODES.has('commander_adapter_unavailable'), true)
  assert.equal(POS_PUBLISH_PARENT_ERROR_CODES.has('pos_publish_child_timeout'), true)
  assert.deepEqual(toSafePosPublishChildResult({
    outcome: 'completed', state: 'completed', job_id: '11111111-1111-4111-8111-111111111111',
  }), {
    outcome: 'completed', state: 'completed', last_job_id: '11111111-1111-4111-8111-111111111111', last_error_code: null,
  })
})

test('shared result contract accepts every documented runtime value and fails closed when malformed', () => {
  for (const outcome of POS_PUBLISH_CHILD_OUTCOMES) {
    const state = outcome === 'internal_error' ? 'error' : outcome
    assert.deepEqual(toSafePosPublishChildResult({ outcome, state }), {
      outcome, state, last_job_id: null, last_error_code: null,
    })
  }
  for (const state of POS_PUBLISH_CHILD_STATES) assert.equal(POS_PUBLISH_CHILD_STATES.has(state), true)
  for (const code of POS_PUBLISH_CHILD_ERROR_CODES) assert.equal(POS_PUBLISH_CHILD_ERROR_CODES.has(code), true)
  for (const code of POS_PUBLISH_PARENT_ERROR_CODES) assert.equal(POS_PUBLISH_PARENT_ERROR_CODES.has(code), true)
  const dir = mkdtempSync(join(tmpdir(), 'storepulse-pos-publish-contract-'))
  try {
    const valid = {
      properties: ['outcome', 'state', 'last_job_id', 'last_error_code'],
      outcomes: ['disabled'], states: ['disabled'], error_codes: ['internal_connector_error'], parent_error_codes: ['pos_publish_runtime_failed'],
    }
    const invalidContracts = [
      '{',
      JSON.stringify({ ...valid, extra: [] }),
      JSON.stringify({ properties: valid.properties, outcomes: valid.outcomes, states: valid.states, error_codes: valid.error_codes }),
      JSON.stringify({ ...valid, properties: ['outcome', 'outcome', 'last_job_id', 'last_error_code'] }),
      JSON.stringify({ ...valid, outcomes: ['disabled', 'disabled'] }),
      JSON.stringify({ ...valid, states: ['disabled', 'disabled'] }),
      JSON.stringify({ ...valid, error_codes: ['internal_connector_error', 'internal_connector_error'] }),
      JSON.stringify({ ...valid, parent_error_codes: ['pos_publish_runtime_failed', 'pos_publish_runtime_failed'] }),
      JSON.stringify({ ...valid, outcomes: [''] }),
      JSON.stringify({ ...valid, states: [1] }),
    ]
    for (const [index, text] of invalidContracts.entries()) {
      const malformed = join(dir, `invalid-${index}.json`)
      writeFileSync(malformed, text, 'utf8')
      assert.throws(() => loadPosPublishResultContract(malformed), /invalid_result_contract/)
    }
    assert.throws(() => loadPosPublishResultContract(join(dir, 'missing.json')), /invalid_result_contract/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('child result contract converts invalid values to a fixed safe error', () => {
  for (const result of [
    { outcome: '00012345678901', state: 'completed' },
    { outcome: 'completed', state: 'unknown' },
    { outcome: 'completed', state: 'completed', job_id: 'not-a-uuid' },
    { outcome: 'completed', state: 'completed', failure_code: 'https://example.invalid/token' },
  ]) {
    assert.deepEqual(toSafePosPublishChildResult(result), {
      outcome: 'internal_error', state: 'error', last_job_id: null, last_error_code: 'internal_connector_error',
    })
  }
})
