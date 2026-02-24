/**
 * MET-2 helper tests.
 * Run: npx tsx src/__tests__/metrics-value.test.ts
 */

import {
  MIN_BIZ_FOR_BENCH,
  computeBenchmarks,
  computeStreakWeeks,
  computeTimeSavedHours,
} from '../lib/metrics-value';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass += 1;
  else fail += 1;
}

async function run() {
  console.log('\n=== computeTimeSavedHours ===');
  const basic = computeTimeSavedHours({ replies_generated: 10, replies_approved: 4 });
  assert('minutes = 10*2 + 4*0.5', basic.rawMinutes === 22);
  assert('hours rounded to 1 decimal', basic.hours === 0.4);

  const empty = computeTimeSavedHours({ replies_generated: 0, replies_approved: 0 });
  assert('zero input -> zero minutes', empty.rawMinutes === 0);
  assert('zero input -> zero hours', empty.hours === 0);

  console.log('\n=== computeStreakWeeks ===');
  const streak = computeStreakWeeks(
    [
      { day: '2026-02-23', planner_published: 1 },
      { day: '2026-02-24', planner_published: 1 },
      { day: '2026-02-16', planner_published: 3 },
      { day: '2026-02-10', planner_published: 1 },
    ],
    { now: () => new Date('2026-02-27T12:00:00.000Z') },
  );
  assert('current + previous week meet threshold => streak 2', streak === 2);

  const noStreak = computeStreakWeeks(
    [{ day: '2026-02-10', planner_published: 3 }],
    { now: () => new Date('2026-02-27T12:00:00.000Z') },
  );
  assert('no qualifying current week => streak 0', noStreak === 0);

  console.log('\n=== computeBenchmarks ===');
  const estimate = await computeBenchmarks({
    businessId: 'biz-self',
    rangeDays: 30,
    metricKey: 'planner_items_published',
    admin: {} as never,
    loadAggregates: async () => Array.from({ length: MIN_BIZ_FOR_BENCH - 1 }, (_, index) => ({
      business_id: `biz-${index + 1}`,
      value: index + 1,
    })),
  });
  assert('estimate when active businesses < MIN_BIZ_FOR_BENCH', estimate.status === 'estimate');
  assert('estimate benchmark has null percentile', estimate.percentile === null);

  const aggregates = Array.from({ length: MIN_BIZ_FOR_BENCH + 5 }, (_, index) => ({
    business_id: `biz-${index + 1}`,
    value: index + 1,
  }));
  aggregates[MIN_BIZ_FOR_BENCH - 1] = { business_id: 'biz-self', value: MIN_BIZ_FOR_BENCH };

  const data = await computeBenchmarks({
    businessId: 'biz-self',
    rangeDays: 30,
    metricKey: 'planner_items_published',
    admin: {} as never,
    loadAggregates: async () => aggregates,
  });
  assert('data status when enough volume', data.status === 'data');
  assert('metric maps planner -> posts_published', data.metric === 'posts_published');
  assert('percentile is present in data mode', typeof data.percentile === 'number');
  assert('label is one of the supported buckets', (
    data.label === 'Per sobre de la mitjana'
    || data.label === 'A la mitjana'
    || data.label === 'Per sota de la mitjana'
  ));

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

void run();
