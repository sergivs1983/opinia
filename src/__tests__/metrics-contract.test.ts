/**
 * MET-1 contract tests.
 * Run: npx tsx src/__tests__/metrics-contract.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { MetricsSummaryQuerySchema } from '../lib/validations/schemas';
import { addAiUsage, bumpDailyMetric } from '../lib/metrics';
import { filterMetricsSummaryForViewer } from '../lib/metrics-summary';
import { isAdminViewer } from '../lib/authz';

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
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

console.log('\n=== SUMMARY QUERY SCHEMA ===');

const validRange = MetricsSummaryQuerySchema.safeParse({ range: '30' });
assert('range=30 is valid', validRange.success);

const defaultRange = MetricsSummaryQuerySchema.safeParse({});
assert('range defaults to 30', defaultRange.success && defaultRange.data.range === '30');

const invalidRange = MetricsSummaryQuerySchema.safeParse({ range: '15' });
assert('range invalid -> validation error', !invalidRange.success);

console.log('\n=== ROUTE CONTRACT ===');

const summaryRoute = read('src/app/api/metrics/summary/route.ts');
includes('summary route uses validateQuery', summaryRoute, 'validateQuery(request, MetricsSummaryQuerySchema)');
includes('summary route reads x-biz-id', summaryRoute, "request.headers.get('x-biz-id')");
includes('summary route sets x-request-id header', summaryRoute, "response.headers.set('x-request-id', requestId)");
includes('summary route returns request id', summaryRoute, 'request_id: requestId');
includes('summary route includes admin flag', summaryRoute, 'admin');
includes('summary route includes value object', summaryRoute, 'value:');
includes('summary route computes benchmark', summaryRoute, 'computeBenchmarks');

console.log('\n=== VISIBILITY FILTER (AI COST) ===');

const baseSummary = {
  rangeDays: 30,
  totals: {
    replies_generated: 5,
    replies_approved: 3,
    assets_created: 2,
    planner_published: 4,
    ai_cost_cents: 1234,
    ai_tokens_in: 1000,
    ai_tokens_out: 2000,
    time_saved_minutes_est: 11,
  },
  series: [
    {
      day: '2026-02-20',
      replies_generated: 2,
      planner_published: 1,
      ai_cost_cents: 321,
      ai_tokens_in: 500,
      ai_tokens_out: 700,
    },
  ],
  highlights: [],
  value: {
    time_saved_hours: 0.2,
    time_saved_minutes: 11,
    streak_weeks: 2,
    benchmark: {
      metric: 'posts_published',
      label: 'A la mitjana',
      status: 'data',
      percentile: 55,
    },
  },
  request_id: 'req_metrics_contract',
};

const clientView = filterMetricsSummaryForViewer(baseSummary, false) as Record<string, unknown>;
const clientTotals = clientView.totals as Record<string, unknown>;
const clientSeriesFirst = ((clientView.series as unknown[])?.[0] || {}) as Record<string, unknown>;

assert('non-admin response includes admin=false', clientView.admin === false);
assert('non-admin response hides totals.ai_cost_cents', !Object.prototype.hasOwnProperty.call(clientTotals, 'ai_cost_cents'));
assert('non-admin response hides totals.ai_tokens_in', !Object.prototype.hasOwnProperty.call(clientTotals, 'ai_tokens_in'));
assert('non-admin response hides totals.ai_tokens_out', !Object.prototype.hasOwnProperty.call(clientTotals, 'ai_tokens_out'));
assert('non-admin response hides series ai_cost_cents', !Object.prototype.hasOwnProperty.call(clientSeriesFirst, 'ai_cost_cents'));
assert('non-admin response keeps value', Object.prototype.hasOwnProperty.call(clientView, 'value'));

const adminView = filterMetricsSummaryForViewer(baseSummary, true) as Record<string, unknown>;
const adminTotals = adminView.totals as Record<string, unknown>;

assert('admin response includes admin=true', adminView.admin === true);
assert('admin response includes totals.ai_cost_cents', Object.prototype.hasOwnProperty.call(adminTotals, 'ai_cost_cents'));
assert('admin response includes value', Object.prototype.hasOwnProperty.call(adminView, 'value'));

console.log('\n=== AUTHZ (ADMIN_EMAILS) ===');
const previousAdminEmails = process.env.ADMIN_EMAILS;
process.env.ADMIN_EMAILS = 'admin@opinia.dev,ops@opinia.dev';

assert(
  'isAdminViewer true for allowlisted email',
  isAdminViewer({ user: { email: 'admin@opinia.dev' }, orgId: 'org-1', businessId: 'biz-1' }),
);
assert(
  'isAdminViewer false for non-allowlisted email',
  !isAdminViewer({ user: { email: 'client@shop.com' }, orgId: 'org-1', businessId: 'biz-1' }),
);

if (typeof previousAdminEmails === 'string') process.env.ADMIN_EMAILS = previousAdminEmails;
else delete process.env.ADMIN_EMAILS;

console.log('\n=== bumpDailyMetric UPSERT ===');

type Row = {
  business_id: string;
  day: string;
  replies_generated: number;
  replies_approved: number;
  planner_items_added: number;
  planner_items_published: number;
  assets_created: number;
  exports_created: number;
  ai_cost_cents: number;
  ai_tokens_in: number;
  ai_tokens_out: number;
  reviews_received: number;
  created_at: string;
  updated_at: string;
};

const rows = new Map<string, Row>();

const fakeAdmin = {
  from(table: string) {
    if (table !== 'metrics_daily') {
      throw new Error(`unexpected table: ${table}`);
    }

    const state = { businessId: '', day: '' };
    return {
      select() {
        return this;
      },
      eq(column: string, value: string) {
        if (column === 'business_id') state.businessId = value;
        if (column === 'day') state.day = value;
        return this;
      },
      async maybeSingle() {
        const key = `${state.businessId}:${state.day}`;
        return { data: rows.get(key) || null, error: null };
      },
      async upsert(payload: Row | Row[]) {
        const list = Array.isArray(payload) ? payload : [payload];
        for (const item of list) {
          rows.set(`${item.business_id}:${item.day}`, item);
        }
        return { error: null };
      },
    };
  },
};

const now = () => new Date('2026-02-20T10:00:00.000Z');

async function run() {
  await bumpDailyMetric(
    'biz-1',
    '2026-02-20',
    { replies_generated: 1, planner_items_added: 1 },
    { admin: fakeAdmin as never, now },
  );

  await bumpDailyMetric(
    'biz-1',
    '2026-02-20',
    { replies_generated: 2, replies_approved: 1 },
    { admin: fakeAdmin as never, now },
  );

  await addAiUsage(
    'biz-1',
    '2026-02-20',
    { tokensIn: 120, tokensOut: 80, costCents: 9 },
    { admin: fakeAdmin as never, now },
  );

  const row = rows.get('biz-1:2026-02-20');
  assert('upsert row exists', !!row);
  assert('replies_generated increments', !!row && row.replies_generated === 3);
  assert('replies_approved increments', !!row && row.replies_approved === 1);
  assert('planner_items_added increments', !!row && row.planner_items_added === 1);
  assert('ai_tokens_in increments', !!row && row.ai_tokens_in === 120);
  assert('ai_tokens_out increments', !!row && row.ai_tokens_out === 80);
  assert('ai_cost_cents increments', !!row && row.ai_cost_cents === 9);

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

void run();
