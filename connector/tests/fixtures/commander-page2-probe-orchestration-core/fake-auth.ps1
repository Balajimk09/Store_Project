function Read-StorePulseMachineConfig{param($Path)[pscustomobject]@{commander_install_path='fake';commander_ip='203.0.113.1'}}
function Read-StorePulseMachineSecrets{param($Path)[pscustomobject]@{commander_username='fake';commander_password='fake'}}
function New-StorePulseCommanderConnection{param($CommanderInstallPath,$CommanderIp,$Username,$Password)$x=[pscustomobject]@{};$x|Add-Member ScriptMethod Dispose {}; $x}
function Get-StorePulseCommanderSessionCookie{param($Connection)('fake'+'_cookie')}
