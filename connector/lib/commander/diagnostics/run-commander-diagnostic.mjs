import { emptyValidateStructureResult, parseValidateStructure } from './validate-structure-diagnostic.mjs'
import { getCommanderOperation } from './commander-operation-registry.mjs'

let active = false
const SAFE_CODES = new Set(['commander_disabled', 'invalid_commander_config', 'credentials_unavailable', 'credentials_invalid', 'runtime_manifest_missing', 'runtime_manifest_invalid', 'runtime_hash_mismatch', 'runtime_reparse_point', 'runtime_path_invalid', 'worker_not_available', 'worker_start_failed', 'worker_timeout', 'worker_output_invalid', 'response_too_large', 'response_invalid_encoding', 'response_invalid_xml', 'response_structure_limit', 'commander_connection_failed', 'approval_required', 'approval_mismatch', 'operation_not_allowed', 'diagnostic_already_running', 'internal_failure'])

export async function runCommanderDiagnostic({ operation, approval, configProvider, credentialProvider, runtimeValidator, transportFactory }) {
  if (active) return emptyValidateStructureResult('diagnostic_already_running')
  active = true
  try {
    const registered = getCommanderOperation(operation)
    if (!approval?.approved) return emptyValidateStructureResult('approval_required')
    if (approval.operation !== registered.operation) return emptyValidateStructureResult('approval_mismatch')
    const config = await configProvider()
    if (!config?.enabled) return emptyValidateStructureResult('commander_disabled')
    const runtime = await runtimeValidator(config.runtimeDirectory)
    const transport = transportFactory({ config, runtime, credentialProvider })
    return parseValidateStructure(await transport.validate())
  } catch (error) {
    return emptyValidateStructureResult(SAFE_CODES.has(error?.code) ? error.code : 'internal_failure')
  } finally { active = false }
}
