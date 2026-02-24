/**
 * PUB-1 contract tests.
 * Run: npx tsx src/__tests__/webhooks-contract.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  signPayload,
  buildPlannerWebhookPayload,
  buildWebhookTestPayload,
  toWebhookTestResponse,
} from '../lib/webhooks';

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
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

console.log('\n=== SIGNING ===');

const signature = signPayload('secret', '{"a":1}');
assert(
  'HMAC SHA256 signature is deterministic',
  signature === 'aa9e2e3575f5d7098b6caccd790888c36d5fdb63342a73bada2d6a51747a8494',
);
assert('Signature is 64 hex chars', /^[a-f0-9]{64}$/i.test(signature));

console.log('\n=== PAYLOAD SHAPE ===');

const payload = buildPlannerWebhookPayload({
  event: 'planner.ready',
  requestId: 'req_pub_1',
  businessId: 'biz_1',
  businessName: 'Demo Biz',
  channel: 'ig_feed',
  scheduledAt: '2026-02-20T19:30:00.000Z',
  title: 'Weekly idea',
  language: 'ca',
  caption: 'Caption demo',
  cta: 'Reserva ara',
  hashtags: ['#opinia', '#growth'],
  assetSignedUrl: 'https://example.com/signed.png',
  plannerItemId: 'planner_1',
});

assert('Payload has event', payload.event === 'planner.ready');
assert('Payload has business info', payload.business.id === 'biz_1' && payload.business.name === 'Demo Biz');
assert('Payload has planner item', payload.item.id === 'planner_1' && payload.item.channel === 'ig_feed');
assert('Payload includes signed asset url', payload.item.asset_signed_url === 'https://example.com/signed.png');
assert('Payload includes assets array', Array.isArray(payload.assets) && payload.assets.length === 1);
assert('Payload carries request_id', payload.request_id === 'req_pub_1');

const demoPayload = buildWebhookTestPayload({
  event: 'planner.published',
  requestId: 'req_demo',
  businessId: 'biz_2',
  businessName: 'Demo Biz 2',
  language: 'en',
  channel: 'x',
});
assert('Demo payload uses selected event', demoPayload.event === 'planner.published');
assert('Demo payload uses selected channel', demoPayload.item.channel === 'x');

console.log('\n=== TEST RESULT MAPPING ===');

const okMapping = toWebhookTestResponse({
  status: 'sent',
  responseCode: 200,
  requestId: 'req_ok',
});
assert('sent -> ok=true', okMapping.ok === true && okMapping.status === 'sent');

const failMapping = toWebhookTestResponse({
  status: 'failed',
  responseCode: 500,
  requestId: 'req_fail',
  error: 'timeout',
});
assert('failed -> ok=false', failMapping.ok === false && failMapping.status === 'failed');

console.log('\n=== ROUTE CONTRACT ===');

const testRoute = read('src/app/api/webhooks/test/route.ts');
includes('webhooks/test validates body with WebhookTestSchema', testRoute, 'validateBody(request, WebhookTestSchema)');
includes('webhooks/test calls sendWebhook', testRoute, 'sendWebhook({');
includes('webhooks/test returns ok field', testRoute, 'ok: mapped.ok');
includes('webhooks/test returns request_id', testRoute, 'request_id: requestId');

const plannerSendRoute = read('src/app/api/planner/[id]/send/route.ts');
includes('planner send validates params', plannerSendRoute, 'validateParams(params, PlannerItemParamsSchema)');
includes('planner send validates body', plannerSendRoute, 'validateBody(request, PlannerSendSchema)');
includes('planner send returns webhook status', plannerSendRoute, 'status: mapped.status');
includes('planner send returns request_id', plannerSendRoute, 'request_id: requestId');

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
