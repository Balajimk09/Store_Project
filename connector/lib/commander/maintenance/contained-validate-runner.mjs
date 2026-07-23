import { TextDecoder } from 'node:util';

const MAX_STDOUT_BYTES = 32_768;
const MAX_STDERR_BYTES = 4_096;
const MAX_ELEMENTS = 256;
const MAX_COOKIE_ELEMENTS = 8;
const MAX_DEPTH = 15;
const MAX_PATH_LENGTH = 1_024;
const MAX_NAME_LENGTH = 128;
const MAX_NAMESPACE_LENGTH = 512;
const RESULT_KEYS = [
  'capture_succeeded',
  'cookie_element_count',
  'cookie_elements',
  'elements',
  'root',
  'safe_error_code',
];
const ELEMENT_KEYS = [
  'attribute_names',
  'child_element_names',
  'depth',
  'has_text',
  'is_direct_child_of_root',
  'local_name',
  'namespace_uri',
  'parent_local_name',
  'parent_namespace_uri',
  'path',
];
const COOKIE_ELEMENT_KEYS = [
  'depth',
  'has_text',
  'is_direct_child_of_root',
  'local_name',
  'namespace_uri',
  'parent_local_name',
  'parent_namespace_uri',
  'path',
  'sibling_element_names',
];

const CONTAINED_ERROR_CODES = new Map([
  ['capture_disabled', 'operation_not_allowed'],
  ['config_unavailable', 'invalid_commander_config'],
  ['config_invalid', 'invalid_commander_config'],
  ['secrets_unavailable', 'credentials_unavailable'],
  ['credential_unavailable', 'credentials_unavailable'],
  ['secrets_invalid', 'credentials_invalid'],
  ['path_reparse_rejected', 'runtime_reparse_point'],
  ['commander_component_untrusted', 'runtime_manifest_invalid'],
  ['com_unavailable', 'worker_not_available'],
  ['validate_failed', 'commander_connection_failed'],
  ['response_unavailable', 'commander_connection_failed'],
  ['response_too_large', 'response_too_large'],
  ['worker_output_too_large', 'response_too_large'],
  ['xml_invalid', 'response_invalid_xml'],
  ['xml_limit_exceeded', 'response_structure_limit'],
  ['metadata_unsafe', 'response_structure_limit'],
  ['containment_unavailable', 'worker_start_failed'],
  ['job_configuration_failed', 'worker_start_failed'],
  ['process_start_failed', 'worker_start_failed'],
  ['process_assignment_failed', 'worker_start_failed'],
  ['containment_verification_failed', 'worker_start_failed'],
  ['process_resume_failed', 'worker_start_failed'],
  ['worker_timeout', 'worker_timeout'],
  ['worker_stderr_detected', 'worker_output_stream_contaminated'],
  ['worker_stdout_detected_result_valid', 'worker_stdout_detected_result_valid'],
  ['worker_stdout_detected_result_invalid', 'worker_stdout_detected_result_invalid'],
  ['worker_stdout_detected_result_missing', 'worker_stdout_detected_result_missing'],
  ['worker_stderr_detected_result_valid', 'worker_stderr_detected_result_valid'],
  ['worker_stderr_detected_result_invalid', 'worker_stderr_detected_result_invalid'],
  ['worker_stderr_detected_result_missing', 'worker_stderr_detected_result_missing'],
  ['worker_streams_detected_result_valid', 'worker_streams_detected_result_valid'],
  ['worker_streams_detected_result_invalid', 'worker_streams_detected_result_invalid'],
  ['worker_streams_detected_result_missing', 'worker_streams_detected_result_missing'],
  ['worker_output_invalid', 'worker_output_invalid'],
  ['worker_contract_invalid', 'worker_output_schema_invalid'],
  ['worker_exit_failed', 'worker_output_invalid'],
  ['worker_terminated', 'worker_output_invalid'],
  ['worker_process_limit', 'worker_output_invalid'],
  ['worker_memory_or_runtime_failure', 'worker_output_invalid'],
  ['cleanup_failed', 'worker_output_invalid'],
  ['internal_capture_error', 'internal_failure'],
  ['internal_failure', 'internal_failure'],
]);

function safeFailure(safeErrorCode) {
  return {
    capture_succeeded: false,
    root: null,
    elements: [],
    cookie_elements: [],
    cookie_element_count: 0,
    safe_error_code: safeErrorCode,
  };
}

function hasExactKeys(value, expectedKeys) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
}

function isSafeMetadataString(value, maximumLength, { allowNull = false, allowEmpty = false } = {}) {
  if (value === null) return allowNull;
  return typeof value === 'string'
    && (allowEmpty || value.length > 0)
    && value.length <= maximumLength
    && !/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u.test(value);
}

function isNameList(value, maximumCount) {
  if (!Array.isArray(value) || value.length > maximumCount) return false;
  const names = new Set();
  return value.every((item) => {
    if (!isSafeMetadataString(item, MAX_NAME_LENGTH) || names.has(item)) return false;
    names.add(item);
    return true;
  });
}

function isPath(value) {
  if (!isSafeMetadataString(value, MAX_PATH_LENGTH) || !value.startsWith('/')) return false;
  const segments = value.split('/').filter(Boolean);
  return segments.length >= 1 && segments.length <= MAX_DEPTH + 1;
}

function isValidRoot(root) {
  return hasExactKeys(root, ['local_name', 'namespace_uri'])
    && isSafeMetadataString(root.local_name, MAX_NAME_LENGTH)
    && isSafeMetadataString(root.namespace_uri, MAX_NAMESPACE_LENGTH, { allowEmpty: true });
}

function isValidElement(element) {
  return hasExactKeys(element, ELEMENT_KEYS)
    && isPath(element.path)
    && Number.isInteger(element.depth) && element.depth >= 0 && element.depth <= MAX_DEPTH
    && isSafeMetadataString(element.local_name, MAX_NAME_LENGTH)
    && isSafeMetadataString(element.namespace_uri, MAX_NAMESPACE_LENGTH, { allowEmpty: true })
    && isSafeMetadataString(element.parent_local_name, MAX_NAME_LENGTH, { allowNull: true })
    && isSafeMetadataString(element.parent_namespace_uri, MAX_NAMESPACE_LENGTH, { allowNull: true, allowEmpty: true })
    && typeof element.is_direct_child_of_root === 'boolean'
    && isNameList(element.attribute_names, 16)
    && isNameList(element.child_element_names, 32)
    && typeof element.has_text === 'boolean';
}

function isValidCookieElement(element) {
  return hasExactKeys(element, COOKIE_ELEMENT_KEYS)
    && isPath(element.path)
    && Number.isInteger(element.depth) && element.depth >= 0 && element.depth <= MAX_DEPTH
    && isSafeMetadataString(element.local_name, MAX_NAME_LENGTH)
    && isSafeMetadataString(element.namespace_uri, MAX_NAMESPACE_LENGTH, { allowEmpty: true })
    && isSafeMetadataString(element.parent_local_name, MAX_NAME_LENGTH, { allowNull: true })
    && isSafeMetadataString(element.parent_namespace_uri, MAX_NAMESPACE_LENGTH, { allowNull: true, allowEmpty: true })
    && typeof element.is_direct_child_of_root === 'boolean'
    && isNameList(element.sibling_element_names, 32)
    && typeof element.has_text === 'boolean';
}

function validateResult(result) {
  if (!hasExactKeys(result, RESULT_KEYS)) return 'worker_output_schema_invalid';
  if (typeof result.capture_succeeded !== 'boolean'
    || !Number.isInteger(result.cookie_element_count)
    || !Array.isArray(result.elements)
    || !Array.isArray(result.cookie_elements)) return 'worker_output_type_invalid';
  if (result.elements.length > MAX_ELEMENTS
    || result.cookie_elements.length > MAX_COOKIE_ELEMENTS
    || result.cookie_element_count < 0
    || result.cookie_element_count > MAX_COOKIE_ELEMENTS
    || result.cookie_element_count !== result.cookie_elements.length) return 'worker_output_schema_invalid';

  const elementPaths = new Set();
  const cookiePaths = new Set();
  if (!result.elements.every((element) => isValidElement(element) && !elementPaths.has(element.path) && (elementPaths.add(element.path), true))) return 'worker_output_schema_invalid';
  if (!result.cookie_elements.every((element) => isValidCookieElement(element) && !cookiePaths.has(element.path) && (cookiePaths.add(element.path), true))) return 'worker_output_schema_invalid';

  if (result.capture_succeeded) {
    return result.safe_error_code === null && isValidRoot(result.root) ? null : 'worker_output_schema_invalid';
  }
  return result.root === null
    && result.elements.length === 0
    && result.cookie_elements.length === 0
    && result.cookie_element_count === 0
    && isSafeMetadataString(result.safe_error_code, MAX_NAME_LENGTH)
    ? null
    : 'worker_output_schema_invalid';
}

function strictUtf8(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buffer); } catch { return null; }
}

function parseSingleJsonResult(stdout) {
  if (stdout.length >= 3 && stdout[0] === 0xef && stdout[1] === 0xbb && stdout[2] === 0xbf) return { errorCode: 'worker_output_not_json' };
  const text = strictUtf8(stdout);
  if (text === null || text.charCodeAt(0) === 0xfeff) return { errorCode: 'worker_output_not_json' };
  if (text.trim().length === 0) return { errorCode: 'worker_output_empty' };
  const trimmed = text.trim();
  if (/}\s*{/.test(trimmed)) return { errorCode: 'worker_output_multiple_records' };
  let result;
  try { result = JSON.parse(text); } catch { return { errorCode: 'worker_output_stream_contaminated' }; }
  const errorCode = validateResult(result);
  return errorCode ? { errorCode } : { result };
}

function normalizeResult(result) {
  if (result.capture_succeeded) return result;
  return safeFailure(CONTAINED_ERROR_CODES.get(result.safe_error_code) ?? 'internal_failure');
}

function processResultPromise(child) {
  if (!child || typeof child !== 'object') return null;
  return child.result ? Promise.resolve(child.result) : Promise.resolve(child);
}

/** Runs the fixed contained launcher and returns only its validated six-field result. */
export async function runContainedCommanderValidate({
  launcherPath,
  powershellPath,
  spawnProcess,
  timeoutMilliseconds = 25_000,
} = {}) {
  if (typeof launcherPath !== 'string' || launcherPath.length === 0
    || typeof powershellPath !== 'string' || powershellPath.length === 0
    || typeof spawnProcess !== 'function'
    || !Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 120_000) {
    return safeFailure('worker_not_available');
  }

  let child;
  let timeoutId;
  try {
    child = spawnProcess(
      powershellPath,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcherPath, '-ExecuteContainedValidateCapture'],
      { shell: false, windowsHide: true },
    );
    const completed = processResultPromise(child);
    if (!completed) return safeFailure('worker_start_failed');
    const result = await Promise.race([
      completed,
      new Promise((resolve) => { timeoutId = setTimeout(() => resolve({ timedOut: true }), timeoutMilliseconds); }),
    ]);
    clearTimeout(timeoutId);
    if (result?.timedOut) {
      child.kill?.();
      return safeFailure('worker_timeout');
    }

    const stdout = Buffer.from(result?.stdout ?? []);
    const stderr = Buffer.from(result?.stderr ?? []);
    if (stdout.length > MAX_STDOUT_BYTES) return safeFailure('response_too_large');
    if (stderr.length > MAX_STDERR_BYTES || stderr.length > 0) return safeFailure('worker_output_stream_contaminated');
    if (result?.exitCode !== 0) return safeFailure('worker_output_invalid');
    const parsed = parseSingleJsonResult(stdout);
    return parsed.result ? normalizeResult(parsed.result) : safeFailure(parsed.errorCode);
  } catch {
    if (timeoutId) clearTimeout(timeoutId);
    return safeFailure('worker_start_failed');
  }
}
