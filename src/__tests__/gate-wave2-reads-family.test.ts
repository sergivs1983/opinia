/**
 * Wave 2 read-family gate contract tests
 * Run: npx tsx src/__tests__/gate-wave2-reads-family.test.ts
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

function ordered(label: string, haystack: string, before: string, after: string) {
  const beforeIdx = haystack.indexOf(before);
  const afterIdx = haystack.indexOf(after);
  assert(label, beforeIdx >= 0 && afterIdx >= 0 && beforeIdx < afterIdx);
}

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

function run() {
  const contentAssets = read('src/app/api/content-studio/assets/route.ts');
  includes('content-studio/assets GET: uses biz gate', contentAssets, 'requireBizAccessPatternB(request, businessId');
  ordered('content-studio/assets GET: gate before assets query', contentAssets, 'requireBizAccessPatternB(request, businessId', ".from('content_assets')");
  includes('content-studio/assets GET: list scoped by access.bizId', contentAssets, ".eq('business_id', access.bizId)");

  const competitors = read('src/app/api/competitors/route.ts');
  includes('competitors GET: uses biz gate', competitors, 'requireBizAccessPatternB(request, bizId');
  ordered('competitors GET: gate before competitors query', competitors, 'requireBizAccessPatternB(request, bizId', ".from('competitors')");
  includes('competitors GET: scoped by access.bizId', competitors, ".eq('biz_id', access.bizId)");

  const exportsRoute = read('src/app/api/exports/route.ts');
  includes('exports GET: uses biz gate', exportsRoute, 'requireBizAccessPatternB(request, businessId');
  ordered('exports GET: gate before exports query', exportsRoute, 'requireBizAccessPatternB(request, businessId', ".from('exports')");
  includes('exports GET: scoped by access.bizId', exportsRoute, ".eq('business_id', access.bizId)");

  const insightsOps = read('src/app/api/insights/ops/route.ts');
  includes('insights/ops GET: uses biz gate', insightsOps, 'requireBizAccessPatternB(request, bizId');
  ordered('insights/ops GET: gate before reviews query', insightsOps, 'requireBizAccessPatternB(request, bizId', ".from('reviews')");
  includes('insights/ops GET: reviews scoped by access.bizId', insightsOps, ".eq('biz_id', access.bizId)");

  const litoThreads = read('src/app/api/lito/threads/route.ts');
  includes('lito/threads GET: uses biz gate', litoThreads, 'requireBizAccessPatternB(request, payload.biz_id');
  ordered('lito/threads GET: gate before thread list query', litoThreads, 'requireBizAccessPatternB(request, payload.biz_id', ".from('lito_threads')");
  includes('lito/threads GET: scoped by gate.bizId', litoThreads, ".eq('biz_id', gate.bizId)");
  includes('lito/threads GET: role insufficient returns 404', litoThreads, "{ status: 404 }");

  const planner = read('src/app/api/planner/route.ts');
  includes('planner GET: uses biz gate', planner, 'requireBizAccessPatternB(request, businessId');
  ordered('planner GET: gate before planner query', planner, 'requireBizAccessPatternB(request, businessId', ".from('content_planner_items')");
  includes('planner GET: list scoped by gate.bizId', planner, ".eq('business_id', gate.bizId)");

  const litoCopy = read('src/app/api/lito/copy/route.ts');
  includes('lito/copy GET: uses biz gate', litoCopy, 'requireBizAccessPatternB(request, payload.biz_id');
  includes('lito/copy GET: recommendation lookup scoped by gate.bizId', litoCopy, ".eq('biz_id', gate.bizId)");
  includes('lito/copy GET: role insufficient returns 404', litoCopy, "{ status: 404 }");

  const metrics = read('src/app/api/metrics/summary/route.ts');
  includes('metrics/summary GET: uses biz gate', metrics, 'requireBizAccessPatternB(request, businessId');
  ordered('metrics/summary GET: gate before metrics_daily query', metrics, 'requireBizAccessPatternB(request, businessId', ".from('metrics_daily')");
  includes('metrics/summary GET: reviews query scoped by access.bizId', metrics, ".eq('biz_id', access.bizId)");
  includes('metrics/summary GET: previous period query scoped by access.bizId', metrics, ".eq('business_id', access.bizId)");

  const pushStatus = read('src/app/api/push/status/route.ts');
  includes('push/status GET: uses push biz access helper', pushStatus, 'requirePushBizAccess({');
  includes('push/status GET: subscriptions scoped by access.bizId', pushStatus, ".eq('biz_id', access.bizId)");

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run();
