/**
 * Request ID observability checks.
 * Run: npx tsx src/__tests__/request-id-observability.test.ts
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

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const middleware = read('src/middleware.ts');
const generateRoute = read('src/app/api/reviews/[reviewId]/generate/route.ts');

console.log('\n=== REQUEST ID HEADERS ===');
assert(
  'Middleware propagates/generates request id for /api',
  middleware.includes("request.headers.get('x-request-id')?.trim() || createRequestId()")
);
assert(
  'Middleware sets x-request-id header on API response',
  middleware.includes("response.headers.set('x-request-id', requestId);")
);

console.log('\n=== ERROR PATHS INCLUDE REQUEST ID ===');
assert(
  'Generate validation errors are wrapped with x-request-id',
  generateRoute.includes('if (err) return withResponseRequestId(err);')
);
assert(
  'Generate internal error includes request_id in response body',
  generateRoute.includes("request_id: requestId")
);
assert(
  'Generate internal error response is wrapped with x-request-id',
  generateRoute.includes('return withResponseRequestId(')
);

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
