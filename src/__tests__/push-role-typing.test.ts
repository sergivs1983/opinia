/**
 * Push role typing tests.
 * Run: npx tsx src/__tests__/push-role-typing.test.ts
 */

import { parsePushAccessRole } from '../app/api/push/_shared';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

function run() {
  console.log('\n=== PUSH ROLE PARSER ===');

  assert('owner => owner', parsePushAccessRole('owner') === 'owner');
  assert('admin => admin', parsePushAccessRole('admin') === 'admin');
  assert('manager => manager', parsePushAccessRole('manager') === 'manager');
  assert('staff => staff', parsePushAccessRole('staff') === 'staff');
  assert('responder => staff', parsePushAccessRole('responder') === 'staff');
  assert('null => null', parsePushAccessRole(null) === null);
  assert('unknown => null', parsePushAccessRole('unknown') === null);

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run();

