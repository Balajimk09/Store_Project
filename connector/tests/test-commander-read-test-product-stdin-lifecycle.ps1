[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path $PSScriptRoot 'fixtures\commander-stdin-eof-fixture.mjs'
$node = Get-Command node -ErrorAction Stop
$process = $null; $writer = $null
try {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $node.Source
    $info.Arguments = ('"{0}"' -f $fixture)
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process; $process.StartInfo = $info
    if (-not $process.Start()) { throw 'fixture_start_failed' }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $writer = New-Object System.IO.StreamWriter($process.StandardInput.BaseStream, $utf8, 1024, $true)
    $writer.Write('{"fixture":true}'); $writer.Flush(); $writer.Dispose(); $writer = $null
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd(); $stderr = $process.StandardError.ReadToEnd()
    [void]$process.WaitForExit(5000)
    if ($process.ExitCode -ne 0 -or $stderr.Length -ne 0 -or $stdout -ne '{"ok":true}') { throw 'fixture_contract_failed' }
    Write-Output 'stdin_lifecycle_fixture_passed'
}
finally { if ($null -ne $writer) { try { $writer.Dispose() } catch { } }; if ($null -ne $process) { try { if (-not $process.HasExited) { $process.Kill(); [void]$process.WaitForExit(5000) } } catch { }; $process.Dispose() } }
