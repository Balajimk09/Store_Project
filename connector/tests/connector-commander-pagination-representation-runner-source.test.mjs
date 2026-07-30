import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const design = path.join(root, 'research', 'COMMANDER_PAGINATION_REPRESENTATION_DESIGN.md')
const runner = path.join(root, 'maintenance', 'run-connector-commander-pagination-representation.ps1')
const child = path.join(root, 'research', 'commander-vplus-pagination-representation-child.mjs')
const parser = path.join(root, 'research', 'commander-vplus-pagination-representation-client.mjs')
const designHash = '25964AA1191B3F750624A4A27741E6F83F4E0E96A04CB956D6FA7E675B20E6D0'
const runnerHash = '35773B98484B987AB4A343ABABFD07DBE4132488E6806C66C6F460A7F730D628'
const childHash = 'C6EA5492EE8F982DAAC75C55BA98250E7F7641B46E58588BB099E2C63F485884'
const parserHash = '8DB8C8FE5E5163504072851F04DCED824C56A1B340EB556747D436599E2AA452'
const publicFields = ['operation','authentication_succeeded','representation_request_attempted','representation_request_succeeded','bounded_response_received','utf8_valid','xml_parse_succeeded','response_root_valid','representation_analysis_completed','page_target_detected','of_pages_target_detected','page_representation','of_pages_representation','page_depth_bucket','of_pages_depth_bucket','page_candidate_count_bucket','of_pages_candidate_count_bucket','page_numeric_class','of_pages_numeric_class','page_conflicting_candidates','of_pages_conflicting_candidates','request_page','request_page_size','query_present','where_present','raw_response_retained','product_values_retained','write_attempted','session_disposed','error_code','failure_stage','exception_type']
const childFields = ['request_succeeded','bounded_response_received','utf8_valid','xml_parse_succeeded','response_root_valid','representation_analysis_completed','page_target_detected','of_pages_target_detected','page_representation','of_pages_representation','page_depth_bucket','of_pages_depth_bucket','page_candidate_count_bucket','of_pages_candidate_count_bucket','page_numeric_class','of_pages_numeric_class','page_conflicting_candidates','of_pages_conflicting_candidates','raw_response_retained','product_values_retained','safe_error_code']
const childCodes = ['invalid_input','invalid_origin','ca_file_invalid','transport_failed','timeout','response_too_large','http_rejected','invalid_utf8','xml_invalid','xml_unsafe','structure_limit_exceeded','response_root_invalid','representation_analysis_failed','result_too_large','unexpected_failure']
const runnerMappings = [['preflight_failed','preflight'],['guard_already_exists','guard_check'],['guard_create_failed','guard_create'],['authentication_failed','authentication'],['session_cookie_failed','session_cookie'],['child_start_failed','child_start'],['child_stdin_failed','child_stdin'],['child_timeout','child_wait'],['child_stdout_overflow','child_stdout'],['child_stderr_overflow','child_stderr'],['child_output_missing','child_output_parse'],['child_output_invalid','child_output_parse'],['child_contract_invalid','child_contract_validate'],['child_process_failed','child_process'],['public_result_too_large','public_result_serialize'],['cleanup_failed','cleanup'],['unexpected_failure','runner']]
const childMappings = [['invalid_input','child_contract_validate'],['invalid_origin','child_contract_validate'],['ca_file_invalid','child_contract_validate'],['transport_failed','transport'],['timeout','transport'],['http_rejected','transport'],['response_too_large','response_receive'],['invalid_utf8','utf8_validate'],['xml_invalid','xml_parse'],['xml_unsafe','xml_parse'],['response_root_invalid','response_root_validate'],['structure_limit_exceeded','representation_analyze'],['representation_analysis_failed','representation_analyze'],['result_too_large','child_output_serialize'],['unexpected_failure','child_process']]
const errors = new Set([...childCodes, ...runnerMappings.map(([code]) => code)])
const stages = new Set([null, ...runnerMappings.map(([, stage]) => stage), ...childMappings.map(([, stage]) => stage)])
const exceptionTypes = new Set([null, 'runner_exception', 'cleanup_exception'])
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex').toUpperCase()
const literal = text => text === '$null' ? null : /^'([^']*)'$/.exec(text)?.[1]
const pair = (code, stage) => `${code}/${stage}`
const commandOffset = (facts, name) => facts.commandFacts.find(fact => fact.name === name)?.start
const memberOffset = (facts, member, receiver) => facts.memberFacts.find(fact => fact.member === member && (!receiver || fact.receiver === receiver))?.start

const ast = () => new Promise((resolve, reject) => {
  const script = `$path=${JSON.stringify(runner)};$t=$null;$e=$null;$a=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$t,[ref]$e);if($e.Count){exit 2};$f=@($a.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ieq 'Result'},$true));$g=@($a.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ieq 'Claim-Guard'},$true));$v=@($a.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ieq 'Validate-Child'},$true));$h=@($f[0].FindAll({param($n)$n -is [System.Management.Automation.Language.HashtableAst]},$true));$keys=@($h[0].KeyValuePairs|%{$_.Item1.Value});$values=@($h[0].KeyValuePairs|%{$_.Item2.Extent.Text});$guardMembers=@($g[0].FindAll({param($n)$n -is [System.Management.Automation.Language.MemberExpressionAst]},$true)|%{$_.Member.Value});$cmds=@($a.FindAll({param($n)$n -is [System.Management.Automation.Language.CommandAst]},$true));$assignments=@($a.FindAll({param($n)$n -is [System.Management.Automation.Language.AssignmentStatementAst]},$true));$childFieldAssignments=@($assignments|?{$_.Left.Extent.Text -eq '$childFields'});$childCodeAssignments=@($assignments|?{$_.Left.Extent.Text -eq '$childCodes'});$payloadTables=@($a.FindAll({param($n)$n -is [System.Management.Automation.Language.HashtableAst] -and @($n.KeyValuePairs|%{$_.Item1.Value}) -contains 'session_cookie'},$true));$mapTables=@($a.FindAll({param($n)$n -is [System.Management.Automation.Language.HashtableAst] -and @($n.KeyValuePairs|%{$_.Item1.Value}) -contains 'invalid_input'},$true));$members=@($a.FindAll({param($n)$n -is [System.Management.Automation.Language.MemberExpressionAst]},$true));$tries=@($a.FindAll({param($n)$n -is [System.Management.Automation.Language.TryStatementAst]},$true));$expressions=@($v[0].FindAll({param($n)$n -is [System.Management.Automation.Language.BinaryExpressionAst]},$true)|%{$_.Extent.Text});$types=@($a.FindAll({param($n)$n -is [System.Management.Automation.Language.TypeExpressionAst]},$true));$params=@();if($a.ParamBlock){$params=@($a.ParamBlock.Parameters|%{$_.Name.VariablePath.UserPath})};$tryFacts=@();foreach($item in $tries){$catchThrows=@();foreach($catch in $item.CatchClauses){$catchThrows+=@($catch.Body.Statements|%{$_.Extent.Text})};$bodyCommands=@($item.Body.FindAll({param($n)$n -is [System.Management.Automation.Language.CommandAst]},$true)|%{$_.GetCommandName()});$tryFacts+=[pscustomobject]@{start=$item.Extent.StartOffset;bodyStart=$item.Body.Extent.StartOffset;bodyEnd=$item.Body.Extent.EndOffset;finallyStart=if($item.Finally){$item.Finally.Extent.StartOffset}else{-1};finallyEnd=if($item.Finally){$item.Finally.Extent.EndOffset}else{-1};catchThrows=$catchThrows;commands=$bodyCommands}};[pscustomobject]@{functions=$f.Count;hashtables=$h.Count;keys=$keys;values=$values;guardFunctions=$g.Count;guardMembers=$guardMembers;validateFunctions=$v.Count;childFieldAssignmentCount=$childFieldAssignments.Count;childFields=@($childFieldAssignments[0].Right.FindAll({param($n)$n -is [System.Management.Automation.Language.StringConstantExpressionAst]},$true)|%{$_.Value});childCodes=@($childCodeAssignments[0].Right.FindAll({param($n)$n -is [System.Management.Automation.Language.StringConstantExpressionAst]},$true)|%{$_.Value});payloadTables=$payloadTables.Count;payloadKeys=@($payloadTables[0].KeyValuePairs|%{$_.Item1.Value});mapTables=$mapTables.Count;mapPairs=@($mapTables[0].KeyValuePairs|%{[pscustomobject]@{code=$_.Item1.Value;stage=([string]$_.Item2.Extent.Text).Trim("'")}});commands=@($cmds|%{$_.GetCommandName()});commandFacts=@($cmds|%{[pscustomobject]@{name=$_.GetCommandName();start=$_.Extent.StartOffset;elements=@($_.CommandElements|%{$_.Extent.Text})}});assignmentFacts=@($assignments|%{[pscustomobject]@{left=$_.Left.Extent.Text;right=$_.Right.Extent.Text;start=$_.Extent.StartOffset}});memberFacts=@($members|%{[pscustomobject]@{member=$_.Member.Value;receiver=$_.Expression.Extent.Text;start=$_.Extent.StartOffset}});tryFacts=$tryFacts;validateExpressions=$expressions;types=@($types|%{$_.TypeName.FullName});strings=@($a.FindAll({param($n)$n -is [System.Management.Automation.Language.StringConstantExpressionAst]},$true)|%{$_.Value});parameters=$params;throws=@($a.FindAll({param($n)$n -is [System.Management.Automation.Language.ThrowStatementAst]},$true)|%{$_.Pipeline.Extent.Text});exits=@($a.FindAll({param($n)$n -is [System.Management.Automation.Language.ExitStatementAst]},$true)|%{$_.Pipeline.Extent.Text})}|ConvertTo-Json -Compress -Depth 6`
  execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve(JSON.parse(stdout)))
})

const directPairs = facts => {
  const pairs = []
  for (let index = 0; index < facts.assignmentFacts.length; index += 1) {
    const assignment = facts.assignmentFacts[index]
    const code = assignment.left === '$code' ? literal(assignment.right) : undefined
    if (!code) continue
    const stage = facts.assignmentFacts.slice(index + 1, index + 4).find(next => next.left === '$stage')
    const value = stage && literal(stage.right)
    if (value) pairs.push(pair(code, value))
  }
  return pairs
}

test('uses parser-only AST extraction for immutable identities, ordered contracts, and prohibited commands', async () => {
  const facts = await ast()
  assert.equal(await sha256(design), designHash)
  assert.equal(await sha256(runner), runnerHash)
  assert.equal(await sha256(child), childHash)
  assert.equal(await sha256(parser), parserHash)
  assert.equal(facts.functions, 1)
  assert.equal(facts.hashtables, 1)
  assert.deepEqual(facts.keys, publicFields)
  assert.equal(facts.childFieldAssignmentCount, 1)
  assert.deepEqual(facts.childFields, childFields)
  assert.deepEqual(facts.childCodes, childCodes)
  assert.equal(facts.payloadTables, 1)
  assert.deepEqual(facts.payloadKeys, ['session_cookie'])
  for (const prohibited of ['Invoke-WebRequest','Invoke-RestMethod','Remove-Item','Move-Item','Rename-Item','curl','wget']) assert.equal(facts.commands.includes(prohibited), false)
  assert.equal(facts.commands.filter(command => command === 'Read-StorePulseMachineConfig').length, 1)
  assert.equal(facts.commands.filter(command => command === 'Read-StorePulseMachineSecrets').length, 1)
  assert.equal(facts.commands.filter(command => command === 'New-StorePulseCommanderConnection').length, 1)
  assert.equal(facts.commands.filter(command => command === 'Get-StorePulseCommanderSessionCookie').length, 1)
})

test('proves preflight, fixed paths, guard claim, and protected authentication sequencing', async () => {
  const facts = await ast()
  const source = await readFile(runner, 'utf8')
  const node = facts.commandFacts.find(fact => fact.name === 'Join-Path' && fact.elements.includes("'runtime\\node\\node.exe'"))?.start
  const childCheck = facts.commandFacts.find(fact => fact.name === 'Test-Path' && fact.elements.includes('$child'))?.start
  const childHashCheck = commandOffset(facts, 'Get-FileHash')
  const moduleCheck = facts.commandFacts.find(fact => fact.name === 'Test-Path' && fact.elements.includes('$m'))?.start
  const moduleLoad = facts.commandFacts.find(fact => fact.name === null && fact.elements.length === 1 && fact.elements[0] === '$m')?.start
  const functionCheck = commandOffset(facts, 'Get-Command')
  const processStartInfo = source.indexOf('$si=[Diagnostics.ProcessStartInfo]::new()')
  const guardClaim = commandOffset(facts, 'Claim-Guard')
  const configRead = commandOffset(facts, 'Read-StorePulseMachineConfig')
  const secretsRead = commandOffset(facts, 'Read-StorePulseMachineSecrets')
  const connection = commandOffset(facts, 'New-StorePulseCommanderConnection')
  const cookie = commandOffset(facts, 'Get-StorePulseCommanderSessionCookie')
  assert.ok([node, childCheck, childHashCheck, moduleCheck, moduleLoad, functionCheck, processStartInfo, guardClaim, configRead, secretsRead, connection, cookie].every(Number.isInteger))
  assert.ok(node < childCheck && childCheck < childHashCheck && childHashCheck < moduleCheck && moduleCheck < moduleLoad && moduleLoad < functionCheck && functionCheck < processStartInfo && processStartInfo < guardClaim && guardClaim < configRead && configRead < secretsRead && secretsRead < connection && connection < cookie)
  assert.equal(facts.guardFunctions, 1)
  for (const member of ['CreateDirectory','CreateNew','Write','None','Flush','Dispose']) assert.ok(facts.guardMembers.includes(member))
  for (const fixed of ['C:\\ProgramData\\StorePulse\\config.json','C:\\ProgramData\\StorePulse\\secrets.json','C:\\ProgramData\\StorePulse\\diagnostics\\commander-pagination-representation','C6EA5492EE8F982DAAC75C55BA98250E7F7641B46E58588BB099E2C63F485884']) assert.ok(facts.strings.includes(fixed))
  assert.deepEqual(facts.parameters, [])
  assert.equal(facts.strings.some(value => value.startsWith('env:')), false)
})

test('uses only design-approved public literals and provides every runner-owned mapping', async () => {
  const facts = await ast()
  const setFailurePairs = facts.commandFacts.filter(fact => fact.name === 'Set-Failure').map(fact => [literal(fact.elements[1]), literal(fact.elements[2]), literal(fact.elements[3])])
  const actualErrors = new Set([...childCodes, ...setFailurePairs.map(([code]) => code).filter(Boolean), ...facts.assignmentFacts.filter(fact => fact.left === '$code').map(fact => literal(fact.right)).filter(Boolean)])
  const actualStages = new Set([...facts.mapPairs.map(item => item.stage), ...setFailurePairs.map(([, stage]) => stage).filter(Boolean), ...facts.assignmentFacts.filter(fact => fact.left === '$stage').map(fact => literal(fact.right)).filter(Boolean)])
  const actualTypes = new Set([null, ...setFailurePairs.map(([, , type]) => type).filter(Boolean), ...facts.assignmentFacts.filter(fact => fact.left === '$exceptionType').map(fact => literal(fact.right))])
  for (const code of actualErrors) assert.ok(errors.has(code), `unapproved public error_code: ${code}`)
  for (const stage of actualStages) assert.ok(stages.has(stage), `unapproved public failure_stage: ${stage}`)
  for (const type of actualTypes) assert.ok(exceptionTypes.has(type), `unapproved exception_type: ${type}`)
  const actualPairs = new Set([...setFailurePairs.filter(([code, stage]) => code && stage).map(([code, stage]) => pair(code, stage)), ...directPairs(facts)])
  const missing = runnerMappings.filter(([code, stage]) => !actualPairs.has(pair(code, stage))).map(([code, stage]) => pair(code, stage))
  assert.deepEqual(missing, [], `missing runner-owned mappings: ${missing.join(', ')}`)
  const dynamicChildMapping = facts.commandFacts.find(fact => fact.name === 'Set-Failure' && fact.elements[1] === '$r.safe_error_code' && fact.elements[2] === '$map[$r.safe_error_code]')
  assert.ok(dynamicChildMapping, 'validated child code maps only through the fixed stage table')
})

test('proves complete child-safe-error mapping and child-contract success invariants', async () => {
  const facts = await ast()
  assert.equal(facts.mapTables, 1)
  assert.deepEqual(facts.mapPairs.map(item => [item.code, item.stage]), childMappings)
  assert.ok(facts.validateExpressions.some(expression => expression.includes('$exit') && expression.includes('$r.safe_error_code')), 'exit/result consistency validation')
  assert.ok(facts.validateExpressions.some(expression => expression.includes('representation_analysis_completed') && expression.includes('safe_error_code')), 'analysis=false with null safe error is rejected')
})

test('proves stream bounds and the design precedence before parsing or generic process fallback', async () => {
  const facts = await ast()
  const validate = commandOffset(facts, 'Validate-Child')
  const timeoutKill = memberOffset(facts, 'Kill', '$process')
  const stdoutBytes = facts.memberFacts.filter(fact => fact.member === 'GetByteCount').map(fact => fact.start)
  const readStdout = memberOffset(facts, 'ReadToEndAsync', '$process.StandardOutput')
  const readStderr = memberOffset(facts, 'ReadToEndAsync', '$process.StandardError')
  const stdinWrite = memberOffset(facts, 'Write', '$process.StandardInput')
  const stdinClose = memberOffset(facts, 'Close', '$process.StandardInput')
  const processStart = memberOffset(facts, 'Start', '$process')
  assert.ok(processStart < stdinWrite && stdinWrite < stdinClose && stdinClose < readStdout && readStdout < validate && readStderr < validate)
  assert.equal(facts.memberFacts.filter(fact => fact.member === 'Start' && fact.receiver === '$process').length, 1)
  assert.equal(stdoutBytes.length, 3)
  const childByteCounts = stdoutBytes.filter(start => start < validate)
  assert.equal(childByteCounts.length, 2)
  assert.ok(timeoutKill < Math.min(...childByteCounts) && Math.max(...childByteCounts) < validate)
  const jsonParseCandidates = facts.tryFacts.filter(fact => fact.commands.filter(command => command === 'ConvertFrom-Json').length === 1 && !fact.commands.includes('Validate-Child'))
  const contractCandidates = facts.tryFacts.filter(fact => fact.commands.filter(command => command === 'Validate-Child').length === 1 && !fact.commands.includes('ConvertFrom-Json'))
  assert.equal(jsonParseCandidates.length, 1, `expected one ConvertFrom-Json-only try/catch candidate, found ${jsonParseCandidates.length}`)
  assert.equal(contractCandidates.length, 1, `expected one Validate-Child-only try/catch candidate, found ${contractCandidates.length}`)
  const [jsonParseTry] = jsonParseCandidates
  const [contractTry] = contractCandidates
  assert.ok(jsonParseTry.catchThrows.includes("throw 'child_output_invalid'"), `invalid JSON parse catch must throw child_output_invalid; actual catch statements: ${jsonParseTry.catchThrows.join(', ')}`)
  assert.equal(jsonParseTry.catchThrows.some(statement => statement.includes('child_contract_invalid')), false)
  assert.ok(contractTry.catchThrows.includes("throw 'child_contract_invalid'"), `contract-validation catch must throw child_contract_invalid; actual catch statements: ${contractTry.catchThrows.join(', ')}`)
  assert.equal(contractTry.catchThrows.some(statement => statement.includes('child_output_invalid')), false)
  assert.ok(jsonParseTry.start < contractTry.start, 'ConvertFrom-Json try/catch precedes Validate-Child try/catch')
  assert.notEqual(jsonParseTry.start, contractTry.start, 'parse and contract boundaries are distinct AST nodes')
})

test('requires exact boolean validation for both retained-data child fields', async () => {
  const facts = await ast()
  assert.ok(facts.validateExpressions.some(expression => expression.includes('raw_response_retained') && expression.includes('-isnot [bool]')), 'raw_response_retained must have an explicit boolean validation')
  assert.ok(facts.validateExpressions.some(expression => expression.includes('product_values_retained') && expression.includes('-isnot [bool]')), 'product_values_retained must have an explicit boolean validation')
})

test('proves cleanup, unexpected-failure, serialization, and exit behavior are structurally normalized', async () => {
  const facts = await ast()
  const processDispose = memberOffset(facts, 'Dispose', '$process')
  const protectedProcessDispose = facts.tryFacts.some(fact => fact.bodyStart <= processDispose && processDispose < fact.bodyEnd)
  assert.ok(protectedProcessDispose, 'child process disposal is protected by a cleanup try/catch')
  assert.ok(facts.memberFacts.some(fact => fact.member === 'FinalReleaseComObject'))
  assert.ok(facts.commandFacts.some(fact => fact.name === 'Set-Failure' && fact.elements[1] === "'unexpected_failure'" && fact.elements[2] === "'runner'" && fact.elements[3] === "'runner_exception'"))
  assert.ok(facts.assignmentFacts.some(fact => fact.left === '$code' && fact.right === "'cleanup_failed'"))
  assert.ok(facts.assignmentFacts.some(fact => fact.left === '$code' && fact.right === "'public_result_too_large'"))
  assert.equal(facts.exits.length, 1)
  assert.ok(facts.exits[0].includes('$analysis') && facts.exits[0].includes('$disposed'))
  assert.equal(facts.values.some(value => value.includes('$out') || value.includes('$err')), false, 'raw child streams are not public result values')
})
