/**
 * Google integrations contract tests.
 * Run: npx tsx src/__tests__/google-integrations-contract.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass += 1;
  else fail += 1;
}

function includes(label: string, haystack: string, needle: string) {
  assert(label, haystack.includes(needle));
}

const root = path.resolve(__dirname, '..', '..');
const read = (filePath: string) => fs.readFileSync(path.join(root, filePath), 'utf8');

const connectRoute = read('src/app/api/integrations/google/connect/route.ts');
const statusRoute = read('src/app/api/integrations/google/status/route.ts');

console.log('\n=== CONNECT ROUTE ===');

includes('POST connect exists', connectRoute, 'export async function POST(request: Request)');
assert('GET was removed from connect route', !connectRoute.includes('export async function GET('));
includes('POST connect requires strict CSRF', connectRoute, 'validateStrictCsrf(request)');
includes('POST connect enforces auth (401)', connectRoute, "error: 'unauthorized'");
includes('POST connect hides cross-tenant as 404', connectRoute, "status: 404");
includes('POST connect success payload returns URL', connectRoute, 'url: authUrl.toString()');
includes('POST connect response sets no-store header', connectRoute, "response.headers.set('Cache-Control', 'no-store');");

console.log('\n=== STATUS ROUTE ===');

includes('GET status exists', statusRoute, 'export async function GET(request: Request)');
includes('GET status validates query', statusRoute, 'validateQuery(request, GoogleStatusQuerySchema)');
includes('GET status enforces auth (401)', statusRoute, "error: 'unauthorized'");
includes('GET status hides cross-tenant as 404', statusRoute, "status: 404");
includes('GET status success includes state', statusRoute, 'state: resolveState(');
includes('GET status success includes provider', statusRoute, "provider: 'google_business'");
includes('GET status response sets no-store header', statusRoute, "response.headers.set('Cache-Control', 'no-store');");

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
