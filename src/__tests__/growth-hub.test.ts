/**
 * Growth Hub selection tests.
 * Run: npx tsx src/__tests__/growth-hub.test.ts
 */

import {
  GROWTH_NO_RECURRING_ISSUES_THEME,
  pickStrongPoint,
  pickOpportunity,
} from '../lib/growth-hub';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

console.log('\n=== CASE 1: with differentiator + complaint ===');

const payloadA = {
  top_themes: [
    { theme: 'servei ràpid', mentions: 6, sentiment: 'positive' as const },
    { theme: 'esmorzar lent', mentions: 3, sentiment: 'negative' as const },
  ],
  differentiators: ['servei ràpid'],
  complaints: ['esmorzar lent en hora punta'],
};

const strongA = pickStrongPoint(payloadA);
const oppA = pickOpportunity(payloadA);

assert('Strong point picks differentiator', strongA.theme === 'servei ràpid');
assert('Strong point keeps mentions from matched theme', strongA.mentions === 6);
assert('Opportunity exists with complaint', oppA.hasOpportunity === true);
assert('Opportunity links to negative theme', oppA.theme === 'esmorzar lent');

console.log('\n=== CASE 2: no differentiator -> positive theme fallback ===');

const payloadB = {
  top_themes: [
    { theme: 'neteja habitacions', mentions: 5, sentiment: 'positive' as const },
    { theme: 'check-in', mentions: 2, sentiment: 'neutral' as const },
  ],
  differentiators: [],
  complaints: ['check-in lent'],
};

const strongB = pickStrongPoint(payloadB);
assert('Strong point falls back to most positive theme', strongB.theme === 'neteja habitacions');
assert('Strong point includes mentions', strongB.mentions === 5);

console.log('\n=== CASE 3: no complaints -> neutral opportunity card ===');

const payloadC = {
  top_themes: [{ theme: 'experiència general', mentions: 4, sentiment: 'positive' as const }],
  differentiators: ['experiència general'],
  complaints: [],
};

const oppC = pickOpportunity(payloadC);
assert('Opportunity disabled when no complaints', oppC.hasOpportunity === false);
assert('Opportunity message for no complaints', oppC.theme === GROWTH_NO_RECURRING_ISSUES_THEME);

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
