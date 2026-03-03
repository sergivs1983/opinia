/**
 * D1.6 invariants contract checks.
 * Run: npx tsx src/__tests__/publish-invariants-contract.test.ts
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

function notIncludes(label: string, haystack: string, needle: string) {
  assert(label, !haystack.includes(needle));
}

const root = path.resolve(__dirname, '..', '..');
const read = (filePath: string) => fs.readFileSync(path.join(root, filePath), 'utf8');

console.log('\n=== PUBLISH INVARIANTS CONTRACT ===');

const publishSchemaMigration = read('supabase/migrations/20260324050000_flow_d16_publish_schema_alignment.sql');
includes('FK integration_id points to integrations(id)', publishSchemaMigration, 'integration_id uuid references public.integrations(id)');

const lockTuningMigration = read('supabase/migrations/20260229000000_publish_jobs_lock_tuning.sql');
includes('lock tuning keeps 10 minute running lock window', lockTuningMigration, "interval '10 minutes'");

const workerRoute = read('src/app/api/cron/worker/google/publish/route.ts');
includes('worker claims jobs atomically via pop_publish_jobs RPC', workerRoute, ".rpc('pop_publish_jobs'");
includes('worker runs stuck-job recovery RPC', workerRoute, ".rpc('requeue_stuck_publish_jobs')");
notIncludes('worker does not claim with SELECT pending query', workerRoute, ".from('publish_jobs').select('*').eq('status', 'queued')");
includes('worker sanitizes persisted error detail', workerRoute, 'truncatePublishErrorDetail');

const tokens = read('src/lib/server/tokens.ts');
notIncludes('tokens resolver does not read legacy plaintext columns', tokens, ".select('access_token, refresh_token')");
includes('tokens resolver errors when encrypted secret is missing', tokens, 'No secret found for integration');

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
