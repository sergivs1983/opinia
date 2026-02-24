/**
 * Integration Hub foundation tests (INT-0).
 * Run: npx tsx src/__tests__/integrations-dispatch.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { signPayload } from '../lib/integrations/crypto';
import { dispatchEvent, type DispatchConnector } from '../lib/integrations/dispatch';

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

const fixedNow = new Date('2026-02-20T12:00:00.000Z');
const business = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  org_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Demo Biz',
  webhook_enabled: true,
  webhook_url: 'https://hooks.example.test/path',
  webhook_secret: 'secret',
  webhook_channels: ['ig_feed'],
};
const connector: DispatchConnector = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  business_id: business.id,
  type: 'webhook',
  enabled: true,
  url: 'https://hooks.example.test/path',
  secret: 'secret',
  allowed_channels: ['ig_feed'],
};

async function run() {
  console.log('\n=== HMAC SIGNATURE ===');
  const signature = signPayload('secret', '{"a":1}');
  assert(
    'signature is deterministic',
    signature === 'aa9e2e3575f5d7098b6caccd790888c36d5fdb63342a73bada2d6a51747a8494',
  );

  console.log('\n=== DISPATCH SUCCESS ===');
  let successHeaderEvent = '';
  let successHeaderRequestId = '';
  const successDeliveries: Array<{ status: string; responseCode: number | null; error: string | null }> = [];

  const successResult = await dispatchEvent({
    businessId: business.id,
    event: 'planner.ready',
    data: {
      channel: 'ig_feed',
      item: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', channel: 'ig_feed' },
    },
    requestId: 'req_int0_success',
    plannerItemId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    admin: {} as never,
    dependencies: {
      now: () => fixedNow,
      loadContext: async () => ({ business, connectors: [connector] }),
      isCooldown: async () => false,
      recordDelivery: async (args) => {
        successDeliveries.push({ status: args.status, responseCode: args.responseCode, error: args.error });
      },
      enqueueDlq: async () => undefined,
      fetchImpl: async (_input, init) => {
        const headers = (init?.headers || {}) as Record<string, string>;
        successHeaderEvent = headers['x-opinia-event'] || '';
        successHeaderRequestId = headers['x-request-id'] || '';
        return new Response('ok', { status: 200 });
      },
    },
  });

  assert('dispatch success status', successResult.status === 'sent');
  assert('dispatch records sent delivery', successDeliveries.some((entry) => entry.status === 'sent'));
  assert('dispatch sends x-opinia-event header', successHeaderEvent === 'planner.ready');
  assert('dispatch sends x-request-id header', successHeaderRequestId === 'req_int0_success');

  console.log('\n=== DISPATCH FAILURE (non-blocking + DLQ) ===');
  const failDeliveries: Array<{ status: string; responseCode: number | null; error: string | null }> = [];
  let dlqEnqueued = 0;

  const failResult = await dispatchEvent({
    businessId: business.id,
    event: 'planner.ready',
    data: {
      channel: 'ig_feed',
      item: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', channel: 'ig_feed' },
    },
    requestId: 'req_int0_fail',
    plannerItemId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    admin: {} as never,
    dependencies: {
      now: () => fixedNow,
      loadContext: async () => ({ business, connectors: [connector] }),
      isCooldown: async () => false,
      recordDelivery: async (args) => {
        failDeliveries.push({ status: args.status, responseCode: args.responseCode, error: args.error });
      },
      enqueueDlq: async () => {
        dlqEnqueued += 1;
      },
      fetchImpl: async () => new Response('fail', { status: 500 }),
    },
  });

  assert('dispatch fail status', failResult.status === 'failed');
  assert('dispatch records failed delivery', failDeliveries.some((entry) => entry.status === 'failed'));
  assert('dispatch enqueues DLQ on failure', dlqEnqueued === 1);

  console.log('\n=== DISPATCH COOLDOWN ===');
  const cooldownDeliveries: Array<{ status: string; responseCode: number | null; error: string | null }> = [];
  let cooldownFetchCalls = 0;

  const cooldownResult = await dispatchEvent({
    businessId: business.id,
    event: 'planner.ready',
    data: {
      channel: 'ig_feed',
      item: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', channel: 'ig_feed' },
    },
    requestId: 'req_int0_cooldown',
    plannerItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    admin: {} as never,
    dependencies: {
      now: () => fixedNow,
      loadContext: async () => ({ business, connectors: [connector] }),
      isCooldown: async () => true,
      recordDelivery: async (args) => {
        cooldownDeliveries.push({ status: args.status, responseCode: args.responseCode, error: args.error });
      },
      enqueueDlq: async () => undefined,
      fetchImpl: async () => {
        cooldownFetchCalls += 1;
        return new Response('ok', { status: 200 });
      },
    },
  });

  assert('cooldown returns failed status', cooldownResult.status === 'failed');
  assert('cooldown returns 429', cooldownResult.responseCode === 429);
  assert('cooldown records failed delivery', cooldownDeliveries.some((entry) => entry.responseCode === 429));
  assert('cooldown does not call webhook fetch', cooldownFetchCalls === 0);

  console.log('\n=== CONNECTORS API CONTRACT ===');
  const connectorsRoute = read('src/app/api/integrations/connectors/route.ts');
  includes('GET connector route returns secret_present only', connectorsRoute, 'secret_present');
  includes('POST connector route validates URL policy', connectorsRoute, 'validateConnectorUrl');
  includes('POST connector route can generate secret', connectorsRoute, 'generateConnectorSecret');

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

