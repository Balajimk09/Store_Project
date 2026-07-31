import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const childSource = path.join(repo, 'research', 'commander-vplus-pagination-representation-child.mjs')
const parserSource = path.join(repo, 'research', 'commander-vplus-pagination-representation-client.mjs')
const trustSource = path.join(repo, 'lib', 'commander', 'session', 'commander-tls-trust.mjs')
const naxmlSource = path.join(repo, 'lib', 'commander', 'commander-naxml-client.mjs')
const fields = ['request_succeeded', 'bounded_response_received', 'utf8_valid', 'xml_parse_succeeded', 'response_root_valid', 'representation_analysis_completed', 'page_target_detected', 'of_pages_target_detected', 'page_representation', 'of_pages_representation', 'page_depth_bucket', 'of_pages_depth_bucket', 'page_candidate_count_bucket', 'of_pages_candidate_count_bucket', 'page_numeric_class', 'of_pages_numeric_class', 'page_conflicting_candidates', 'of_pages_conflicting_candidates', 'raw_response_retained', 'product_values_retained', 'safe_error_code']
const fixedBody = '<domain:PLUSelect xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><pageSize>100</pageSize><page>1</page></domain:PLUSelect>'
const fakeCookie = 'tls-harness-session-cookie-sentinel'
const forbidden = ['tls-harness-session-cookie-sentinel', 'loopback.test', 'programdata-sentinel', 'fingerprint-sentinel', 'exception-sentinel', 'raw-xml-sentinel', 'BEGIN PRIVATE KEY']

const hash = value => createHash('sha256').update(value).digest('hex').toUpperCase()
const count = (text, value) => text.split(value).length - 1
const run = (file, args, options = {}) => new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, ...options }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })))
const pemDerHash = value => {
  const match = value.toString('utf8').match(/-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END CERTIFICATE-----/)
  assert.ok(match, 'temporary certificate must be PEM')
  return hash(Buffer.from(match[1].replace(/\s/g, ''), 'base64'))
}

async function createCertificates(directory) {
  const script = path.join(directory, 'create-certificates.ps1')
  await writeFile(script, String.raw`
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$password = ConvertTo-SecureString 'temporary-test-password' -AsPlainText -Force
$created = @()
function Export-Pem([System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate, [string]$Destination) {
  $der = "$Destination.der"
  Export-Certificate -Cert $Certificate -FilePath $der -Type CERT | Out-Null
  & certutil.exe -f -encode $der $Destination | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'certificate_encode_failed' }
  Remove-Item -LiteralPath $der -Force
}
function New-TestCa([string]$Name) {
  $certificate = New-SelfSignedCertificate -Type Custom -Subject "CN=$Name" -KeyAlgorithm RSA -KeyLength 2048 -KeyExportPolicy Exportable -KeyUsage CertSign,CRLSign,DigitalSignature -TextExtension @('2.5.29.19={critical}{text}CA=true') -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddDays(1)
  $script:created += $certificate
  return $certificate
}
function New-TestServer($Signer, [string]$Name) {
  $certificate = New-SelfSignedCertificate -Type Custom -Subject 'CN=loopback.test' -DnsName 'loopback.test' -Signer $Signer -KeyAlgorithm RSA -KeyLength 2048 -KeyExportPolicy Exportable -KeyUsage DigitalSignature,KeyEncipherment -TextExtension @('2.5.29.19={critical}{text}CA=false') -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddDays(1)
  $script:created += $certificate
  return $certificate
}
try {
  $caA = New-TestCa 'Temporary TLS Harness CA A'
  $caB = New-TestCa 'Temporary TLS Harness CA B'
  $serverA = New-TestServer $caA 'A'
  $serverB = New-TestServer $caA 'B'
  $serverC = New-TestServer $caB 'C'
  Export-Pem $caA (Join-Path $OutputDirectory 'ca-a.pem')
  Export-Pem $caB (Join-Path $OutputDirectory 'ca-b.pem')
  Export-Pem $serverA (Join-Path $OutputDirectory 'server-a.pem')
  Export-Pem $serverB (Join-Path $OutputDirectory 'server-b.pem')
  Export-Pem $serverC (Join-Path $OutputDirectory 'server-c.pem')
  Export-PfxCertificate -Cert $serverA -FilePath (Join-Path $OutputDirectory 'server-a.pfx') -Password $password | Out-Null
  Export-PfxCertificate -Cert $serverB -FilePath (Join-Path $OutputDirectory 'server-b.pfx') -Password $password | Out-Null
  Export-PfxCertificate -Cert $serverC -FilePath (Join-Path $OutputDirectory 'server-c.pfx') -Password $password | Out-Null
} finally {
  foreach ($certificate in $created) { Remove-Item -LiteralPath "Cert:\CurrentUser\My\\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue }
}
`, 'utf8')
  await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-OutputDirectory', directory])
}

async function temporaryRuntime() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'representation-child-tls-'))
  const runtime = path.join(directory, 'runtime')
  const research = path.join(runtime, 'research')
  const session = path.join(runtime, 'lib', 'commander', 'session')
  await Promise.all([mkdir(research, { recursive: true }), mkdir(session, { recursive: true })])
  const originalChild = await readFile(childSource, 'utf8')
  const configPath = path.join(directory, 'programdata-sentinel', 'StorePulse', 'config.json')
  const programData = path.join(directory, 'programdata-sentinel')
  const replacements = [
    ["const CONFIG_PATH = 'C:\\\\ProgramData\\\\StorePulse\\\\config.json'", `const CONFIG_PATH = ${JSON.stringify(configPath)}`],
    ["const PROGRAM_DATA = 'C:\\\\ProgramData'", `const PROGRAM_DATA = ${JSON.stringify(programData)}`],
    ['origin: `https://${config.commander_ip}`', 'origin: `https://${config.commander_ip}:${config.commander_test_port}`'],
  ]
  let temporaryChild = originalChild
  for (const [anchor, replacement] of replacements) {
    assert.equal(count(temporaryChild, anchor), 1, `temporary substitution anchor must occur once: ${anchor}`)
    temporaryChild = temporaryChild.replace(anchor, replacement)
  }
  await Promise.all([
    writeFile(path.join(research, 'commander-vplus-pagination-representation-child.mjs'), temporaryChild, 'utf8'),
    writeFile(path.join(research, 'commander-vplus-pagination-representation-client.mjs'), await readFile(parserSource), 'utf8'),
    writeFile(path.join(session, 'commander-tls-trust.mjs'), await readFile(trustSource), 'utf8'),
    writeFile(path.join(runtime, 'lib', 'commander', 'commander-naxml-client.mjs'), await readFile(naxmlSource), 'utf8'),
  ])
  assert.equal(hash(await readFile(childSource)), hash(originalChild), 'repository child must remain unchanged')
  return { directory, child: path.join(research, 'commander-vplus-pagination-representation-child.mjs'), configPath, programData, substitutions: replacements.map(([anchor]) => anchor) }
}

async function listen(pfxPath, onRequest) {
  const server = https.createServer({ pfx: await readFile(pfxPath), passphrase: 'temporary-test-password' }, onRequest)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server
}

async function executeChild(child, input) {
  return new Promise((resolve, reject) => {
    const childProcess = execFile(process.execPath, [child], { windowsHide: true, timeout: 20000 }, (error, stdout, stderr) => {
      if (error && error.killed) return reject(error)
      resolve({ code: error?.code ?? 0, stdout, stderr })
    })
    childProcess.stdin.end(input)
  })
}

function assertSafe(result, code) {
  assert.deepEqual(Object.keys(result), fields)
  assert.equal(result.safe_error_code, code)
  assert.equal(result.raw_response_retained, false)
  assert.equal(result.product_values_retained, false)
}

async function runCase({ serverCertificate, expectedCertificate, caFile = 'ca-a.pem', serverName = 'loopback.test', expectedCode = null }) {
  const fixture = await temporaryRuntime()
  let server
  try {
    await createCertificates(fixture.directory)
    let requests = 0
    let safeRequest
    server = await listen(path.join(fixture.directory, serverCertificate), (request, response) => {
      requests += 1
      const chunks = []
      request.on('data', chunk => chunks.push(chunk))
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        safeRequest = { method: request.method, url: request.url, bodyWithoutCookie: body.replace(/cookie=[^&\r\n]+/, 'cookie=[redacted]') }
        response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' })
        response.end('<domain:PLUs xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01" page="1" ofPages="2"/>')
      })
    })
    const port = server.address().port
    const ca = await readFile(path.join(fixture.directory, caFile))
    const expected = await readFile(path.join(fixture.directory, expectedCertificate))
    await mkdir(path.dirname(fixture.configPath), { recursive: true })
    const certs = path.join(fixture.programData, 'StorePulse', 'certificates')
    await mkdir(certs, { recursive: true })
    await Promise.all([
      writeFile(path.join(certs, 'commander-ca.pem'), ca),
      writeFile(path.join(certs, 'commander-server.pem'), expected),
      writeFile(fixture.configPath, JSON.stringify({ commander_ip: '127.0.0.1', commander_test_port: port, commander_tls_server_name: serverName, commander_tls_peer_sha256: pemDerHash(await readFile(path.join(fixture.directory, expectedCertificate))), commander_tls_ca_bundle_sha256: hash(ca) })),
    ])
    const child = await executeChild(fixture.child, JSON.stringify({ session_cookie: fakeCookie }))
    assert.equal(child.stderr, '')
    assert.ok(Buffer.byteLength(child.stdout, 'utf8') <= 8192)
    for (const sentinel of forbidden) assert.equal(child.stdout.includes(sentinel) || child.stderr.includes(sentinel), false, `sentinel leaked: ${sentinel}`)
    const output = JSON.parse(child.stdout)
    assertSafe(output, expectedCode)
    return { child, output, requests, safeRequest, substitutions: fixture.substitutions }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    await rm(fixture.directory, { recursive: true, force: true })
  }
}

test('pinned child succeeds through the real fixed trust resolver and NAXML transport', async () => {
  const outcome = await runCase({ serverCertificate: 'server-a.pfx', expectedCertificate: 'server-a.pem' })
  assert.equal(outcome.child.code, 0)
  assert.equal(outcome.requests, 1)
  assert.deepEqual(outcome.safeRequest, { method: 'POST', url: '/cgi-bin/NAXML', bodyWithoutCookie: `cmd=vPLUs&cookie=[redacted]\r\n\r\n${fixedBody}` })
  for (const key of ['request_succeeded', 'bounded_response_received', 'utf8_valid', 'xml_parse_succeeded', 'response_root_valid', 'representation_analysis_completed']) assert.equal(outcome.output[key], true)
  assert.equal(outcome.output.safe_error_code, null)
  assert.deepEqual(outcome.substitutions.length, 3)
})

test('pinned child rejects a loopback server signed by the wrong CA', async () => {
  const outcome = await runCase({ serverCertificate: 'server-c.pfx', expectedCertificate: 'server-a.pem', expectedCode: 'transport_failed' })
  assert.equal(outcome.child.code, 1)
  assert.equal(outcome.requests, 0)
  assert.equal(outcome.output.representation_analysis_completed, false)
})

test('pinned child rejects a hostname mismatch after CA validation', async () => {
  const outcome = await runCase({ serverCertificate: 'server-a.pfx', expectedCertificate: 'server-a.pem', serverName: 'wrong.loopback.test', expectedCode: 'transport_failed' })
  assert.equal(outcome.child.code, 1)
  assert.equal(outcome.requests, 0)
})

test('pinned child rejects a live raw-DER peer fingerprint mismatch after CA and hostname validation', async () => {
  const outcome = await runCase({ serverCertificate: 'server-b.pfx', expectedCertificate: 'server-a.pem', expectedCode: 'transport_failed' })
  assert.equal(outcome.child.code, 1)
  assert.equal(outcome.requests, 0)
})
