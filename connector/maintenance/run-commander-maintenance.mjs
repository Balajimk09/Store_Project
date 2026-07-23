import { emptyValidateStructureResult } from '../lib/commander/diagnostics/validate-structure-diagnostic.mjs';
import { runCommanderDiagnostic } from '../lib/commander/diagnostics/run-commander-diagnostic.mjs';
import { createCommanderMaintenanceDependencies } from '../lib/commander/maintenance/create-commander-maintenance-dependencies.mjs';
import { createReadTestProductDependencies } from '../lib/commander/maintenance/create-read-test-product-dependencies.mjs';
import { createVerifyTestPriceWriteDependencies } from '../lib/commander/maintenance/create-verify-test-price-write-dependencies.mjs';
import { pathToFileURL } from 'node:url';

const emptyReadTestProductResult = (code) => ({ read_succeeded: false, authenticated: false, tls_verified: false, product_found: false, identity_matched: false, safe_fields_present: [], safe_error_code: code });
const emptyVerifyTestPriceWriteResult = (code) => ({
  write_succeeded: false,
  authenticated: false,
  tls_verified: false,
  product_found: false,
  identity_matched: false,
  expected_price_matched: false,
  write_attempted: false,
  write_accepted: false,
  readback_succeeded: false,
  readback_matched: false,
  idempotent: false,
  safe_fields_present: [],
  safe_error_code: code,
});

export async function runCommanderMaintenance(input = {}) {
  if (input.operation === 'read_test_product') {
    if (input.cli_invalid) return emptyReadTestProductResult('invalid_input');
    if (!input.approval?.approved) return emptyReadTestProductResult('approval_required');
    if (input.approval.operation !== 'read_test_product') return emptyReadTestProductResult('approval_mismatch');
    if (typeof input.executeReadTestProduct !== 'function') return emptyReadTestProductResult('internal_failure');
    try { return await input.executeReadTestProduct(input); } catch { return emptyReadTestProductResult('internal_failure'); }
  }
  if (input.operation === 'verify_test_price_write') {
    if (input.cli_invalid) return emptyVerifyTestPriceWriteResult('invalid_input');
    if (!input.approval?.approved) return emptyVerifyTestPriceWriteResult('approval_required');
    if (input.approval.operation !== 'verify_test_price_write') return emptyVerifyTestPriceWriteResult('approval_mismatch');
    if (typeof input.executeVerifyTestPriceWrite !== 'function') return emptyVerifyTestPriceWriteResult('internal_failure');

    const payload = {
      approval: input.approval,
      command_id: input.command_id,
      controlled_test_product: input.controlled_test_product,
      created_at: input.created_at,
      expected_current_price: input.expected_current_price,
      idempotency_key: input.idempotency_key,
      modifier: input.modifier,
      requested_price: input.requested_price,
      upc: input.upc,
    };

    try {
      return await input.executeVerifyTestPriceWrite(payload);
    } catch {
      return emptyVerifyTestPriceWriteResult('internal_failure');
    }
  }
  if (input.operation !== 'validate_structure') return emptyValidateStructureResult('operation_not_allowed');
  if (!input.approval?.approved) return emptyValidateStructureResult('approval_required');
  if (input.approval.operation !== 'validate_structure') return emptyValidateStructureResult('approval_mismatch');
  if (typeof input.executeContainedValidate === 'function') {
    try { return await input.executeContainedValidate(); } catch { return emptyValidateStructureResult('internal_failure'); }
  }
  return runCommanderDiagnostic(input);
}

function parseCli(args) {
  if (args[0] !== '--operation') return null;
  if (args[1] === 'validate_structure') {
    if (args.length !== 4 || args[2] !== '--approve') return { operation: 'validate_structure', approval: { approved: false, operation: '' } };
    return { operation: 'validate_structure', approval: { approved: true, operation: args[3] } };
  }
  if (args[1] === 'read_test_product') {
    const exact = args.length === 7 && args[2] === '--approve' && args[3] === 'read_test_product' && args[4] === '--upc' && /^\d{1,32}$/.test(args[5] || '') && args[6] === '--controlled-test-product';
    return { operation: 'read_test_product', approval: { approved: args[2] === '--approve', operation: args[3] || '' }, upc: args[5], controlled_test_product: args[6] === '--controlled-test-product', cli_invalid: !exact };
  }
  if (args[1] === 'verify_test_price_write') {
    const money = /^(?:0|[1-9]\d{0,5})\.\d{2}$/;
    const token = /^[A-Za-z0-9._:-]{1,128}$/;

    const exact = (
      args.length === 23
      && args[2] === '--approve'
      && args[3] === 'verify_test_price_write'
      && args[4] === '--upc'
      && args[5] === '00999999999993'
      && args[6] === '--modifier'
      && args[7] === '000'
      && args[8] === '--expected-current-price'
      && money.test(args[9] || '')
      && args[10] === '--requested-price'
      && money.test(args[11] || '')
      && args[12] === '--command-id'
      && token.test(args[13] || '')
      && args[14] === '--idempotency-key'
      && token.test(args[15] || '')
      && args[16] === '--approval-id'
      && token.test(args[17] || '')
      && args[18] === '--approved-at'
      && typeof args[19] === 'string'
      && args[20] === '--created-at'
      && typeof args[21] === 'string'
      && args[22] === '--controlled-test-product'
    );

    return {
      operation: 'verify_test_price_write',
      approval: {
        approved: args[2] === '--approve',
        operation: args[3] || '',
        approval_id: args[17],
        approved_at: args[19],
      },
      command_id: args[13],
      controlled_test_product: args[22] === '--controlled-test-product',
      created_at: args[21],
      expected_current_price: args[9],
      idempotency_key: args[15],
      modifier: args[7],
      requested_price: args[11],
      upc: args[5],
      cli_invalid: !exact,
    };
  }
  return { operation: args[1] || '' };
}

export async function runCommanderMaintenanceCli({
  args = process.argv.slice(2),
  dependencyFactory = createCommanderMaintenanceDependencies,
  readDependencyFactory = createReadTestProductDependencies,
  writeDependencyFactory = createVerifyTestPriceWriteDependencies,
  stdout = process.stdout,
} = {}) {
  const input = parseCli(args) || { operation: '', approval: { approved: false, operation: '' } };
  let result;
  try {
    let selectedFactory = dependencyFactory;

    if (input.operation === 'read_test_product') {
      selectedFactory = readDependencyFactory;
    } else if (input.operation === 'verify_test_price_write') {
      selectedFactory = writeDependencyFactory;
    }

    const dependencies = selectedFactory({
      moduleUrl: import.meta.url,
    });
    result = await runCommanderMaintenance({ ...input, ...dependencies });
  } catch {
    result = input.operation === 'read_test_product'
      ? emptyReadTestProductResult('internal_failure')
      : input.operation === 'verify_test_price_write'
        ? emptyVerifyTestPriceWriteResult('internal_failure')
        : emptyValidateStructureResult('internal_failure');
  }
  stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommanderMaintenanceCli().catch(() => {
    process.stdout.write(`${JSON.stringify(emptyValidateStructureResult('internal_failure'))}\n`);
  }).finally(() => { process.exitCode = 0; });
}
