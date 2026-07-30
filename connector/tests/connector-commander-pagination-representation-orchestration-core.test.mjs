import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const connector = path.resolve(testDirectory, '..')
const runnerSource = path.join(connector, 'maintenance', 'run-connector-commander-pagination-representation.ps1')
const design = path.join(connector, 'research', 'COMMANDER_PAGINATION_REPRESENTATION_DESIGN.md')
const staticTest = path.join(connector, 'tests', 'connector-commander-pagination-representation-runner-source.test.mjs')
const childSource = path.join(connector, 'research', 'commander-vplus-pagination-representation-child.mjs')
const parserSource = path.join(connector, 'research', 'commander-vplus-pagination-representation-client.mjs')
const fixtureSource = path.join(testDirectory, 'fixtures', 'commander-pagination-representation-orchestration-core')
const bindingHashes = new Map([
  [design, '25964AA1191B3F750624A4A27741E6F83F4E0E96A04CB956D6FA7E675B20E6D0'],
  [runnerSource, '35773B98484B987AB4A343ABABFD07DBE4132488E6806C66C6F460A7F730D628'],
  [staticTest, '01F843CE7A16D5B14B05444F3CD2EDDE961F9A5D46D297BC37A80C251A286FDF'],
  [childSource, 'C6EA5492EE8F982DAAC75C55BA98250E7F7641B46E58588BB099E2C63F485884'],
  [parserSource, '8DB8C8FE5E5163504072851F04DCED824C56A1B340EB556747D436599E2AA452'],
])
const publicFields = ['operation','authentication_succeeded','representation_request_attempted','representation_request_succeeded','bounded_response_received','utf8_valid','xml_parse_succeeded','response_root_valid','representation_analysis_completed','page_target_detected','of_pages_target_detected','page_representation','of_pages_representation','page_depth_bucket','of_pages_depth_bucket','page_candidate_count_bucket','of_pages_candidate_count_bucket','page_numeric_class','of_pages_numeric_class','page_conflicting_candidates','of_pages_conflicting_candidates','request_page','request_page_size','query_present','where_present','raw_response_retained','product_values_retained','write_attempted','session_disposed','error_code','failure_stage','exception_type']
const sentinels = ['FAKE_USERNAME_917','FAKE_PASSWORD_917','FAKE_SESSION_COOKIE_SENTINEL_917','203.0.113.17','FAKE_INSTALL_PATH_917','FAKE_XML_917','FAKE_UPC_917','FAKE_PRODUCT_DESCRIPTION_917','FAKE_PRICE_917','FAKE_EXCEPTION_917','FAKE_STACK_917']
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex').toUpperCase()
const ps = value => value.replaceAll("'", "''")

function replaceOnce(text, anchor, replacement) {
  const count = text.split(anchor).length - 1
  assert.equal(count, 1, `expected one substitution anchor: ${anchor}`)
  return text.replace(anchor, replacement)
}

async function readFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? readFiles(file) : [file]
  }))
  return paths.flat()
}

function execute(file) {
  return new Promise((resolve, reject) => {
    const process = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true })
    const stdout = []
    const stderr = []
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) process.kill()
    }, 15000)
    process.stdout.on('data', chunk => stdout.push(chunk))
    process.stderr.on('data', chunk => stderr.push(chunk))
    process.on('error', reject)
    process.on('close', code => {
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
    })
  })
}

async function createRuntime(mode, { existingGuard = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'storepulse-representation-core-'))
  const maintenance = path.join(directory, 'maintenance')
  const installed = path.join(directory, 'installed')
  const service = path.join(installed, 'service')
  const fixture = path.join(directory, 'fixture')
  const configPath = path.join(directory, 'config.json')
  const secretsPath = path.join(directory, 'secrets.json')
  const guardPath = path.join(directory, 'diagnostics', 'commander-pagination-representation')
  const eventsPath = path.join(fixture, 'events.log')
  const runner = path.join(maintenance, 'run-connector-commander-pagination-representation.ps1')
  const child = path.join(fixture, 'fake-child.mjs')
  try {
    await mkdir(maintenance, { recursive: true })
    await mkdir(service, { recursive: true })
    await mkdir(fixture, { recursive: true })
    await copyFile(runnerSource, runner)
    await copyFile(path.join(fixtureSource, 'fake-child.mjs'), child)
    await writeFile(path.join(fixture, 'mode.txt'), mode)
    const moduleTemplate = await readFile(path.join(fixtureSource, 'fake-auth-session.ps1'), 'utf8')
    const module = replaceOnce(moduleTemplate, '__COUNTER_PATH__', ps(eventsPath))
    for (const name of ['storepulse-machine-config.ps1', 'storepulse-machine-secrets.ps1', 'storepulse-current-shift-worker.ps1']) {
      await writeFile(path.join(service, name), module)
    }
    let source = await readFile(runner, 'utf8')
    const childHash = await sha256(child)
    const substitutions = [
      ["$installed='C:\\Program Files\\StorePulse\\Connector'", `$installed='${ps(installed)}'`],
      ["$node=Join-Path $installed 'runtime\\node\\node.exe'", `$node='${ps(process.execPath)}'`],
      ["$child=Join-Path (Split-Path $PSScriptRoot -Parent) 'research\\commander-vplus-pagination-representation-child.mjs'", `$child='${ps(child)}'`],
      ["$guard='C:\\ProgramData\\StorePulse\\diagnostics\\commander-pagination-representation'", `$guard='${ps(guardPath)}'`],
      ["$childHash='C6EA5492EE8F982DAAC75C55BA98250E7F7641B46E58588BB099E2C63F485884'", `$childHash='${childHash}'`],
      ["-Path 'C:\\ProgramData\\StorePulse\\config.json'", `-Path '${ps(configPath)}'`],
      ["-Path 'C:\\ProgramData\\StorePulse\\secrets.json'", `-Path '${ps(secretsPath)}'`],
    ]
    for (const [anchor, replacement] of substitutions) source = replaceOnce(source, anchor, replacement)
    assert.equal(source.includes('C:\\ProgramData\\StorePulse'), false, 'temporary runner retains no production ProgramData path')
    await writeFile(runner, source)
    if (existingGuard) {
      await mkdir(path.dirname(guardPath), { recursive: true })
      await writeFile(guardPath, '')
    }
    return { directory, runner, guardPath, eventsPath, child }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function withRuntime(mode, options, assertion) {
  const runtime = await createRuntime(mode, options)
  try {
    await assertion(runtime)
  } finally {
    await rm(runtime.directory, { recursive: true, force: true })
    await assert.rejects(access(runtime.directory))
  }
}

async function events(runtime) {
  try {
    return (await readFile(runtime.eventsPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

function parsePublic(result) {
  assert.equal(result.stderr.toString('utf8'), '', 'runner stderr is empty')
  const text = result.stdout.toString('utf8')
  assert.equal(text.trim(), text, 'stdout contains no leading or trailing text')
  assert.ok(Buffer.byteLength(text, 'utf8') <= 8192, 'public output stays bounded')
  const body = JSON.parse(text)
  assert.deepEqual(Object.keys(body), publicFields, 'exact ordered 32-field public contract')
  assert.equal(typeof body.operation, 'string')
  for (const field of ['authentication_succeeded','representation_request_attempted','representation_request_succeeded','bounded_response_received','utf8_valid','xml_parse_succeeded','response_root_valid','representation_analysis_completed','page_target_detected','of_pages_target_detected','page_conflicting_candidates','of_pages_conflicting_candidates','query_present','where_present','raw_response_retained','product_values_retained','write_attempted','session_disposed']) assert.equal(typeof body[field], 'boolean', `${field} is boolean`)
  for (const field of ['page_representation','of_pages_representation','page_depth_bucket','of_pages_depth_bucket','page_candidate_count_bucket','of_pages_candidate_count_bucket','page_numeric_class','of_pages_numeric_class']) assert.equal(typeof body[field], 'string', `${field} is string`)
  assert.equal(typeof body.request_page, 'number')
  assert.equal(typeof body.request_page_size, 'number')
  for (const field of ['error_code','failure_stage','exception_type']) assert.ok(body[field] === null || typeof body[field] === 'string', `${field} is null or string`)
  return { body, text }
}

async function assertNoLeaks(runtime, result) {
  const output = `${result.stdout.toString('utf8')}\n${result.stderr.toString('utf8')}\n${(await events(runtime)).join('\n')}`
  const files = await readFiles(runtime.directory)
  const artifacts = await Promise.all(files.map(file => readFile(file, 'utf8')))
  for (const sentinel of sentinels) {
    assert.equal(output.includes(sentinel), false, `sentinel absent from streams and events: ${sentinel}`)
    assert.equal(artifacts.some(content => content.includes(sentinel)), false, `sentinel absent from temporary artifacts: ${sentinel}`)
  }
}

async function assertChildStopped(runtime) {
  const childPid = (await events(runtime)).find(event => event.startsWith('child_pid='))
  if (!childPid) return
  const pid = Number(childPid.slice('child_pid='.length))
  assert.ok(Number.isInteger(pid) && pid > 0, 'fake child records a valid pid')
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'fake child no longer exists')
}

async function assertBindings() {
  for (const [file, hash] of bindingHashes) assert.equal(await sha256(file), hash, `unchanged binding hash: ${path.basename(file)}`)
  const fixtureText = `${await readFile(path.join(fixtureSource, 'fake-auth-session.ps1'), 'utf8')}\n${await readFile(path.join(fixtureSource, 'fake-child.mjs'), 'utf8')}`
  for (const prohibited of ['C:\\ProgramData\\StorePulse', 'Invoke-WebRequest', 'Invoke-RestMethod', 'Supabase', 'page-two', 'Remove-Item']) assert.equal(fixtureText.includes(prohibited), false, `fixture excludes ${prohibited}`)
}

test('normal success executes only a temporary runner copy against fake dependencies', async () => {
  await assertBindings()
  await withRuntime('valid-success', {}, async runtime => {
    const result = await execute(runtime.runner)
    const { body } = parsePublic(result)
    assert.equal(result.code, 0)
    assert.equal(body.error_code, null)
    assert.equal(body.failure_stage, null)
    assert.equal(body.exception_type, null)
    assert.equal(body.session_disposed, true)
    assert.equal(body.request_page, 1)
    assert.equal(body.request_page_size, 100)
    for (const field of ['query_present','where_present','raw_response_retained','product_values_retained','write_attempted']) assert.equal(body[field], false)
    await access(runtime.guardPath)
    const recorded = await events(runtime)
    for (const counter of ['config','secrets','connection','cookie','dispose','child_start','stdin_closed']) assert.equal(recorded.filter(event => event === counter).length, 1, `${counter} exactly once`)
    assert.equal(recorded.some(event => event.startsWith('unsafe_child_')), false)
    await assertChildStopped(runtime)
    await assertNoLeaks(runtime, result)
  })
})

test('valid ambiguous analysis is a successful diagnostic outcome', async () => {
  await withRuntime('valid-ambiguous', {}, async runtime => {
    const result = await execute(runtime.runner)
    const { body } = parsePublic(result)
    assert.equal(result.code, 0)
    assert.equal(body.error_code, null)
    assert.equal(body.failure_stage, null)
    assert.equal(body.exception_type, null)
    assert.equal(body.session_disposed, true)
    assert.equal(body.page_representation, 'ambiguous')
    assert.equal(body.of_pages_representation, 'ambiguous')
    await access(runtime.guardPath)
    const recorded = await events(runtime)
    assert.equal(recorded.filter(event => event === 'child_start').length, 1)
    assert.equal(recorded.filter(event => event === 'cookie').length, 1)
    await assertChildStopped(runtime)
    await assertNoLeaks(runtime, result)
  })
})

test('an existing temporary guard refuses before authentication or child launch', async () => {
  await withRuntime('valid-success', { existingGuard: true }, async runtime => {
    const before = await readFile(runtime.guardPath, 'utf8')
    const result = await execute(runtime.runner)
    const { body } = parsePublic(result)
    assert.equal(result.code, 1)
    assert.equal(body.error_code, 'guard_already_exists')
    assert.equal(body.failure_stage, 'guard_check')
    assert.equal(body.session_disposed, true)
    assert.equal(await readFile(runtime.guardPath, 'utf8'), before, 'existing temporary guard is unchanged')
    assert.deepEqual(await events(runtime), [], 'no fake authentication or child operation occurred')
    await assertNoLeaks(runtime, result)
    assert.equal(body.exception_type, null)
  })
})

test('bounded malformed child JSON maps safely without exposing child output', async () => {
  await withRuntime('invalid-json', {}, async runtime => {
    const result = await execute(runtime.runner)
    const { body, text } = parsePublic(result)
    assert.equal(result.code, 1)
    assert.equal(body.error_code, 'child_output_invalid')
    assert.equal(body.failure_stage, 'child_output_parse')
    assert.equal(body.session_disposed, true)
    assert.equal(text.includes('{invalid json'), false)
    await access(runtime.guardPath)
    const recorded = await events(runtime)
    assert.equal(recorded.filter(event => event === 'child_start').length, 1)
    assert.equal(recorded.filter(event => event === 'cookie').length, 1)
    assert.equal(recorded.filter(event => event === 'dispose').length, 1)
    await assertChildStopped(runtime)
    await assertNoLeaks(runtime, result)
    assert.equal(body.exception_type, null)
  })
})
