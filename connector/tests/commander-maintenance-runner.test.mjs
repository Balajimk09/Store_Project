import assert from'node:assert/strict';import{spawnSync}from'node:child_process';import path from'node:path';import test from'node:test';import{runCommanderMaintenance,runCommanderMaintenanceCli}from'../maintenance/run-commander-maintenance.mjs';const xml=Buffer.from('<root><cookie>secret-cookie</cookie></root>');
test('maintenance runner requires exact validate approval and emits only six fields',async()=>{assert.equal((await runCommanderMaintenance({operation:'x'})).safe_error_code,'operation_not_allowed');let calls=0;const r=await runCommanderMaintenance({operation:'validate_structure',approval:{approved:true,operation:'validate_structure'},configProvider:async()=>({enabled:true,runtimeDirectory:'fixture'}),credentialProvider:{},runtimeValidator:async()=>({}),transportFactory:()=>({validate:async()=>{calls++;return xml}})});assert.equal(calls,1);assert.deepEqual(Object.keys(r),['capture_succeeded','root','elements','cookie_elements','cookie_element_count','safe_error_code']);assert.equal(JSON.stringify(r).includes('secret-cookie'),false)})
test('direct CLI emits one safe JSON line with empty stderr',()=>{const r=spawnSync(process.execPath,[path.resolve('connector/maintenance/run-commander-maintenance.mjs'),'--operation','nope','--approve','nope'],{encoding:'utf8'});assert.equal(r.status,0);assert.equal(r.stderr,'');const value=JSON.parse(r.stdout);assert.deepEqual(Object.keys(value),['capture_succeeded','root','elements','cookie_elements','cookie_element_count','safe_error_code']);assert.equal(value.safe_error_code,'operation_not_allowed')})
test('CLI composition calls the injected production factory once and prints one six-field result',async()=>{let calls=0;let output='';const value=await runCommanderMaintenanceCli({args:['--operation','validate_structure','--approve','validate_structure'],dependencyFactory:()=>{calls++;return{executeContainedValidate:async()=>({capture_succeeded:false,root:null,elements:[],cookie_elements:[],cookie_element_count:0,safe_error_code:'worker_timeout'})}},stdout:{write:(text)=>{output+=text}}});assert.equal(calls,1);assert.equal(value.safe_error_code,'worker_timeout');assert.equal(output.split('\n').filter(Boolean).length,1);assert.deepEqual(Object.keys(JSON.parse(output)),['capture_succeeded','root','elements','cookie_elements','cookie_element_count','safe_error_code'])})
test('read CLI requires exactly seven ordered approved arguments and emits only the safe read contract',async()=>{let calls=0;let output='';const factory=()=>{calls++;return{executeReadTestProduct:async()=>({read_succeeded:true,authenticated:true,tls_verified:true,product_found:true,identity_matched:true,safe_fields_present:['upc','description','department','price'],safe_error_code:null})}};const value=await runCommanderMaintenanceCli({args:['--operation','read_test_product','--approve','read_test_product','--upc','000123','--controlled-test-product'],readDependencyFactory:factory,stdout:{write:text=>output+=text}});assert.equal(calls,1);assert.equal(value.read_succeeded,true);assert.deepEqual(Object.keys(JSON.parse(output)),['read_succeeded','authenticated','tls_verified','product_found','identity_matched','safe_fields_present','safe_error_code']);for(const args of [['--operation','read_test_product','--approve','read_test_product','--upc','abc','--controlled-test-product'],['--operation','read_test_product','--approve','read_test_product','--upc','000123'],['--operation','read_test_product','--upc','000123','--approve','read_test_product','--controlled-test-product'],['--operation','read_test_product','--approve','read_test_product','--upc','000123','--controlled-test-product','--extra']]){const bad=await runCommanderMaintenanceCli({args,readDependencyFactory:factory,stdout:{write:()=>{}}});assert.equal(bad.safe_error_code,'invalid_input')}})
test('write CLI requires one exact ordered controlled-product command and emits only the safe write contract', async () => {
  let executions = 0;
  let received = null;
  let output = '';

  const success = {
    write_succeeded: true,
    authenticated: true,
    tls_verified: true,
    product_found: true,
    identity_matched: true,
    expected_price_matched: true,
    write_attempted: true,
    write_accepted: true,
    readback_succeeded: true,
    readback_matched: true,
    idempotent: false,
    safe_fields_present: ['upc', 'description', 'price'],
    safe_error_code: null,
  };

  const factory = () => ({
    executeVerifyTestPriceWrite: async (input) => {
      executions += 1;
      received = input;
      return success;
    },
  });

  const validArgs = [
    '--operation',
    'verify_test_price_write',
    '--approve',
    'verify_test_price_write',
    '--upc',
    '00999999999993',
    '--modifier',
    '000',
    '--expected-current-price',
    '0.02',
    '--requested-price',
    '0.03',
    '--command-id',
    'command-1',
    '--idempotency-key',
    'idempotency-1',
    '--approval-id',
    'approval-1',
    '--approved-at',
    '2026-07-22T23:00:00.000Z',
    '--created-at',
    '2026-07-22T22:59:00.000Z',
    '--controlled-test-product',
  ];

  const value = await runCommanderMaintenanceCli({
    args: validArgs,
    writeDependencyFactory: factory,
    stdout: {
      write(text) {
        output += text;
      },
    },
  });

  assert.deepEqual(value, success);
  assert.equal(executions, 1);

  assert.deepEqual(
    Object.keys(received),
    [
      'approval',
      'command_id',
      'controlled_test_product',
      'created_at',
      'expected_current_price',
      'idempotency_key',
      'modifier',
      'requested_price',
      'upc',
    ],
  );

  assert.deepEqual(
    Object.keys(received.approval),
    [
      'approved',
      'operation',
      'approval_id',
      'approved_at',
    ],
  );

  assert.deepEqual(
    Object.keys(JSON.parse(output)),
    [
      'write_succeeded',
      'authenticated',
      'tls_verified',
      'product_found',
      'identity_matched',
      'expected_price_matched',
      'write_attempted',
      'write_accepted',
      'readback_succeeded',
      'readback_matched',
      'idempotent',
      'safe_fields_present',
      'safe_error_code',
    ],
  );

  assert.equal(
    output.split('\n').filter(Boolean).length,
    1,
  );

  assert.equal(output.includes('private-cookie'), false);
  assert.equal(output.includes('00999999999993'), false);
  assert.equal(output.includes('<domain:'), false);

  const invalidArguments = [
    validArgs.slice(0, -1),
    validArgs.map((value, index) =>
      index === 5 ? '00000000000000' : value
    ),
    validArgs.map((value, index) =>
      index === 7 ? '001' : value
    ),
    validArgs.map((value, index) =>
      index === 9 ? '2' : value
    ),
    [...validArgs, '--extra'],
  ];

  for (const args of invalidArguments) {
    const invalid = await runCommanderMaintenanceCli({
      args,
      writeDependencyFactory: factory,
      stdout: {
        write() {},
      },
    });

    assert.equal(
      invalid.safe_error_code,
      'invalid_input',
    );
  }

  assert.equal(executions, 1);
});

test('direct malformed write CLI emits one bounded write result with empty stderr', () => {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(
        'connector/maintenance/run-commander-maintenance.mjs',
      ),
      '--operation',
      'verify_test_price_write',
      '--approve',
      'verify_test_price_write',
    ],
    {
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');

  const value = JSON.parse(result.stdout);

  assert.deepEqual(
    Object.keys(value),
    [
      'write_succeeded',
      'authenticated',
      'tls_verified',
      'product_found',
      'identity_matched',
      'expected_price_matched',
      'write_attempted',
      'write_accepted',
      'readback_succeeded',
      'readback_matched',
      'idempotent',
      'safe_fields_present',
      'safe_error_code',
    ],
  );

  assert.equal(value.write_attempted, false);
  assert.equal(value.safe_error_code, 'invalid_input');
  assert.equal(
    result.stdout.split('\n').filter(Boolean).length,
    1,
  );
});
