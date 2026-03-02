/**
 * LITO Action Cards (D3) contract tests.
 * Run: npx tsx src/__tests__/lito-action-cards.test.ts
 */

import { getAllowedCardActions } from '../lib/lito/rbac-ctas';
import { scoreCard, sliceCardsByMode, sortCardsByPriority } from '../lib/lito/orchestrator';
import type { ActionCard } from '../types/lito-cards';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

const baseCard = (id: string, priority: number): ActionCard => ({
  id,
  type: 'signal',
  priority,
  severity: 'low',
  title: id,
  subtitle: id,
  primary_cta: { label: 'X', action: 'ack', payload: {} },
  refs: [],
});

console.log('\n=== SCORING ===');
assert('due_post score is 100', scoreCard({ type: 'due_post', severity: 'high' }) === 100);
assert('draft_approval score is 80', scoreCard({ type: 'draft_approval', severity: 'medium' }) === 80);
assert('week_unplanned score is 50', scoreCard({ type: 'week_unplanned', severity: 'medium' }) === 50);
assert('signal high score is 55', scoreCard({ type: 'signal', severity: 'high' }) === 55);
assert('signal medium score is 30', scoreCard({ type: 'signal', severity: 'medium' }) === 30);
assert('follow_up >=7 score is 30', scoreCard({ type: 'follow_up', severity: 'medium', daysInactive: 7 }) === 30);
assert('follow_up <7 score is 10', scoreCard({ type: 'follow_up', severity: 'medium', daysInactive: 3 }) === 10);

console.log('\n=== RBAC CTA MATRIX ===');
assert(
  'due_post staff has no snooze',
  !getAllowedCardActions('due_post', 'staff').includes('snooze'),
);
assert(
  'due_post owner includes snooze',
  getAllowedCardActions('due_post', 'owner').includes('snooze'),
);
assert(
  'draft_approval staff is view_only',
  getAllowedCardActions('draft_approval', 'staff').join(',') === 'view_only',
);
assert(
  'signal staff only ack',
  getAllowedCardActions('signal', 'staff').join(',') === 'ack',
);

console.log('\n=== SORTING + SLICING ===');
const sorted = sortCardsByPriority([
  baseCard('c1', 10),
  baseCard('c2', 100),
  baseCard('c3', 80),
  baseCard('c4', 30),
  baseCard('c5', 55),
  baseCard('c6', 30),
  baseCard('c7', 20),
]);
assert('sort by desc priority', sorted.map((card) => card.id).join(',').startsWith('c2,c3,c5'));
assert('slice basic max 2', sliceCardsByMode(sorted, 'basic').length === 2);
assert('slice advanced max 6', sliceCardsByMode(sorted, 'advanced').length === 6);

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
