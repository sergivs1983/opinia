/**
 * D1.6 — publish-jobs route contract.
 * Run: npx tsx src/__tests__/publish-jobs-contract.test.ts
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

console.log('\n=== PUBLISH JOBS ROUTE CONTRACT ===');

const route = read('src/app/api/publish-jobs/[jobId]/route.ts');

includes('uses resource gate helper', route, 'requireResourceAccessPatternB(');
includes('normalizes status with domain parser', route, 'parsePublishJobStatus(job.status) || job.status');
includes('returns locked_until', route, 'locked_until');
includes('returns processing_started_at', route, 'processing_started_at');
includes('returns published_at', route, 'published_at');
includes('keeps Pattern B 404', route, "{ error: 'not_found', message: 'Not found' }");

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
