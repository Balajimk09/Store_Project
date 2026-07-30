function Add-FakeCounter {
  param([string]$Name)
  [System.IO.File]::AppendAllText('__COUNTER_PATH__', "$Name`n", [System.Text.Encoding]::UTF8)
}

function Read-StorePulseMachineConfig {
  param([string]$Path)
  Add-FakeCounter 'config'
  [pscustomobject]@{
    commander_install_path = ('FAKE' + '_INSTALL' + '_PATH_917')
    commander_ip = ('203' + '.0' + '.113' + '.17')
  }
}

function Read-StorePulseMachineSecrets {
  param([string]$Path)
  Add-FakeCounter 'secrets'
  [pscustomobject]@{
    commander_username = ('FAKE' + '_USERNAME_917')
    commander_password = ('FAKE' + '_PASSWORD_917')
  }
}

function New-StorePulseCommanderConnection {
  param($CommanderInstallPath, $CommanderIp, $Username, $Password)
  Add-FakeCounter 'connection'
  $connection = [pscustomobject]@{}
  $connection | Add-Member -MemberType ScriptMethod -Name Dispose -Value { Add-FakeCounter 'dispose' }
  $connection
}

function Get-StorePulseCommanderSessionCookie {
  param($Connection)
  Add-FakeCounter 'cookie'
  ('FAKE' + '_SESSION' + '_COOKIE' + '_SENTINEL' + '_917')
}
