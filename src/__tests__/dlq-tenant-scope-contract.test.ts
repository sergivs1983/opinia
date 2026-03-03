/**
 * D1.6 — DLQ tenant scope contract.
 * Run: npx tsx src/__tests__/dlq-tenant-scope-contract.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

function includes(label: string, haystack: string, needle: string) {
  assert(label, haystack.includes(needle));
}

const root = path.resolve(__dirname, '..', '..');
const read = (filePath: string) => fs.readFileSync(path.join(root, filePath), 'utf8');

console.log('\n=== DLQ TENANT SCOPE CONTRACT ===');

const route = read('src/app/api/dlq/route.ts');

includes('derive access org id', route, 'const accessOrgId = access.membership.orgId');
includes('GET query scoped by org_id', route, ".eq('org_id', accessOrgId)");
includes('POST retry scoped by org_id', route, ".eq('org_id', accessOrgId)");
includes('POST resolve scoped by org_id', route, ".eq('org_id', accessOrgId)");

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
