/**
 * Wave 1 security gate contract tests (priority routes)
 * Run: npx tsx src/__tests__/gate-priority-wave1-contract.test.ts
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

function gateBeforeFirstQuery(label: string, content: string, handlerAnchor: string = 'export async function POST') {
  const handlerIdx = content.indexOf(handlerAnchor);
  const slice = handlerIdx >= 0 ? content.slice(handlerIdx) : content;
  const gateIdx = slice.indexOf('requireBizAccessPatternB(request');
  const firstQueryIdx = slice.indexOf(".from('");
  assert(label, gateIdx >= 0 && firstQueryIdx >= 0 && gateIdx < firstQueryIdx);
}

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

function run() {
  const render = read('src/app/api/content-studio/render/route.ts');
  gateBeforeFirstQuery('render: gate before first DB query', render);
  includes('render: suggestion scoped by guarded biz', render, ".eq('business_id', guardedBizId)");

  const intelGenerate = read('src/app/api/content-intel/generate/route.ts');
  gateBeforeFirstQuery('content-intel/generate: gate before first DB query', intelGenerate);
  includes('content-intel/generate: reviews scoped by access.bizId', intelGenerate, ".eq('biz_id', access.bizId)");

  const reviewGenerate = read('src/app/api/reviews/[reviewId]/generate/route.ts');
  gateBeforeFirstQuery('reviews/[reviewId]/generate: gate attempt before first DB query', reviewGenerate);
  includes('reviews/[reviewId]/generate: review lookup scoped by guarded biz', reviewGenerate, ".eq('biz_id', access.bizId)");
  includes('reviews/[reviewId]/generate: resource not found 404', reviewGenerate, "status: 404");

  const suggestionPatch = read('src/app/api/content-intel/suggestions/[id]/route.ts');
  gateBeforeFirstQuery('content-intel/suggestions/[id]: gate attempt before first DB query', suggestionPatch);
  includes('content-intel/suggestions/[id]: update scoped by guarded biz', suggestionPatch, ".eq('business_id', access.bizId)");

  const dlq = read('src/app/api/dlq/route.ts');
  gateBeforeFirstQuery('dlq: gate before first DB query', dlq);
  includes('dlq: failed_jobs queries scoped by access.bizId', dlq, ".eq('biz_id', access.bizId)");

  const kb = read('src/app/api/kb/route.ts');
  includes('kb PATCH/DELETE uses pattern B request helper', kb, 'requireBizAccessPatternB(request');
  includes('kb PATCH/DELETE scoped by access.bizId', kb, ".eq('biz_id', access.bizId)");

  const triggers = read('src/app/api/triggers/route.ts');
  includes('triggers PUT/DELETE uses pattern B request helper', triggers, 'requireBizAccessPatternB(request');
  includes('triggers PUT/DELETE scoped by access.bizId', triggers, ".eq('biz_id', access.bizId)");

  const ops = read('src/app/api/ops-actions/route.ts');
  includes('ops-actions PATCH/DELETE uses pattern B request helper', ops, 'requireBizAccessPatternB(request');
  includes('ops-actions PATCH/DELETE scoped by access.bizId', ops, ".eq('biz_id', access.bizId)");

  const copyGenerate = read('src/app/api/lito/copy/generate/route.ts');
  gateBeforeFirstQuery('lito/copy/generate: gate before first DB query', copyGenerate);
  includes('lito/copy/generate: uses standardized membership from helper', copyGenerate, 'access.membership.role');

  const copyRefine = read('src/app/api/lito/copy/refine/route.ts');
  gateBeforeFirstQuery('lito/copy/refine: gate before first DB query', copyRefine);
  includes('lito/copy/refine: uses standardized membership from helper', copyRefine, 'access.membership.role');

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run();
