import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('runner is fixed to one guarded page-two probe without write or retry paths', async () => {
  const source = await readFile(new URL('../maintenance/run-connector-commander-page2-probe.ps1', import.meta.url), 'utf8')
  for (const value of ['commander-catalog-page2-probe-v1','commander-catalog-page2-probe','FileMode]::CreateNew','request_page=2','request_page_size=100','raw_response_retained=$false','product_values_retained=$false','write_attempted=$false','Read-StorePulseMachineConfig','Get-StorePulseCommanderSessionCookie']) assert.ok(source.includes(value), value)
  for (const value of ['Invoke-WebRequest','Invoke-RestMethod','Supabase','Remove-Item','retry','page>1','page>3']) assert.equal(source.includes(value), false, value)
})
