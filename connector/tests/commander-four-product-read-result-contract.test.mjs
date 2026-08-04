import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const runnerPath = fileURLToPath(
  new URL('../maintenance/run-commander-four-product-read.ps1', import.meta.url),
)

function invokeResultContract(stdout, exitCode) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$runnerPath = '${runnerPath.replaceAll("'", "''")}'`,
    '$tokens = $null',
    '$errors = $null',
    '$ast = [System.Management.Automation.Language.Parser]::ParseFile($runnerPath, [ref]$tokens, [ref]$errors)',
    "if ($errors.Count -ne 0) { throw 'runner_parser_failed' }",
    "$matches = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'ConvertFrom-FourProductReadChildResult' }, $true))",
    "if ($matches.Count -ne 1) { throw 'result_contract_helper_not_found' }",
    'Invoke-Expression $matches[0].Extent.Text',
    '$inputValue = [Console]::In.ReadToEnd() | ConvertFrom-Json -ErrorAction Stop',
    'try {',
    '  $value = ConvertFrom-FourProductReadChildResult -Stdout ([string]$inputValue.stdout) -ExitCode ([int]$inputValue.exit_code)',
    '  [ordered]@{ ok = $true; value = $value; error = $null } | ConvertTo-Json -Compress -Depth 8',
    '} catch {',
    '  [ordered]@{ ok = $false; value = $null; error = $_.Exception.Message } | ConvertTo-Json -Compress',
    '}',
  ].join("\n")
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      input: JSON.stringify({ stdout, exit_code: exitCode }),
      windowsHide: true,
    },
  )
  return JSON.parse(output)
}

const product = {
  upc: '00000000000017',
  modifier: '000',
  description: 'Offline product',
  price: '1.00',
  department: '10',
}

test('isolated parent result contract accepts only consistent child success and safe failure results', () => {
  const success = invokeResultContract(JSON.stringify({
    ok: true,
    product,
    error_code: null,
  }), 0)
  assert.equal(success.ok, true)
  assert.deepEqual(success.value, {
    success: true,
    product,
    error_code: null,
  })

  const failure = invokeResultContract(JSON.stringify({
    ok: false,
    product: null,
    error_code: 'product_read_failed',
  }), 1)
  assert.deepEqual(failure, {
    ok: true,
    value: {
      success: false,
      product: null,
      error_code: 'product_read_failed',
    },
    error: null,
  })
})

test('isolated parent result contract rejects malformed, unknown, and exit-inconsistent child results', () => {
  const invalidCases = [
    { stdout: '{', exitCode: 1 },
    { stdout: JSON.stringify({ ok: false, product: null, error_code: 'unknown_error' }), exitCode: 1 },
    { stdout: JSON.stringify({ ok: false, product, error_code: 'product_read_failed' }), exitCode: 1 },
    { stdout: JSON.stringify({ ok: true, product, error_code: 'product_read_failed' }), exitCode: 0 },
    { stdout: JSON.stringify({ ok: false, product: null, error_code: 'product_read_failed' }), exitCode: 0 },
    { stdout: JSON.stringify({ ok: true, product, error_code: null }), exitCode: 1 },
  ]
  for (const value of invalidCases) {
    assert.deepEqual(invokeResultContract(value.stdout, value.exitCode), {
      ok: false,
      value: null,
      error: 'child_response_invalid',
    })
  }
})
