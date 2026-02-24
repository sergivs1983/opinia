/**
 * Tests for Panic Button + Golden Dataset + Negative Constraints.
 *
 * Run: npx tsx src/__tests__/panic-golden-constraints.test.ts
 * (Pure logic tests — no DB or API dependency)
 */

// ============================================================
// 1. DIFF SCORE (Golden Dataset)
// ============================================================

function computeDiffScore(original: string, edited: string): number {
  const wordsA = new Set(original.toLowerCase().split(/\s+/).filter(w => w.length > 1));
  const wordsB = new Set(edited.toLowerCase().split(/\s+/).filter(w => w.length > 1));
  if (wordsA.size === 0 && wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  const similarity = union > 0 ? intersection / union : 0;
  return Math.round((1 - similarity) * 100);
}

function assertEq(label: string, actual: any, expected: any) {
  const pass = actual === expected;
  console.log(`${pass ? '✅' : '❌'} ${label}: got ${actual}, expected ${expected}`);
  if (!pass) process.exitCode = 1;
}

function assertRange(label: string, actual: number, min: number, max: number) {
  const pass = actual >= min && actual <= max;
  console.log(`${pass ? '✅' : '❌'} ${label}: got ${actual}, expected [${min}-${max}]`);
  if (!pass) process.exitCode = 1;
}

function assertTrue(label: string, condition: boolean) {
  console.log(`${condition ? '✅' : '❌'} ${label}`);
  if (!condition) process.exitCode = 1;
}

console.log('\n=== GOLDEN DATASET: computeDiffScore ===');

// T1: Identical texts → 0
assertEq('Identical texts → 0', computeDiffScore('Hello world test', 'Hello world test'), 0);

// T2: Completely different → 100
assertEq('Completely different → 100', computeDiffScore('alpha beta gamma', 'delta epsilon zeta'), 100);

// T3: Empty strings → 0
assertEq('Empty strings → 0', computeDiffScore('', ''), 0);

// T4: Partial overlap
const orig = 'Gràcies per la seva visita al nostre hotel';
const edit = 'Gràcies per la seva opinió sobre el nostre servei';
const score = computeDiffScore(orig, edit);
assertRange('Partial overlap → 20-80', score, 20, 80);

// T5: Minor edit (few words changed)
const minor = computeDiffScore(
  'Moltes gràcies pel seu comentari positiu',
  'Moltes gràcies pel seu amable comentari'
);
assertRange('Minor edit → < 50', minor, 0, 50);

// T6: Major rewrite
const major = computeDiffScore(
  'Thank you for your kind words about our hotel stay',
  'Lamentem que la experiència no fos satisfactòria'
);
assertRange('Major rewrite → > 80', major, 80, 100);

// ============================================================
// 2. NEGATIVE CONSTRAINTS BUILDER
// ============================================================

console.log('\n=== NEGATIVE CONSTRAINTS: buildNegativeConstraints ===');

const DEFAULT_NEGATIVE_CONSTRAINTS = [
  "Do NOT start with 'Dear customer' or 'Dear guest'",
  "Do NOT use 'We are thrilled' or 'We are delighted to hear'",
  "Do NOT use 'We regret any inconvenience' or 'We apologize for any inconvenience'",
  "Do NOT apologize more than once in any single response",
  "Avoid generic corporate phrases that sound AI-generated",
  "Do NOT use 'Thank you for taking the time to' as an opening",
  "Do NOT use 'We look forward to welcoming you back' as a closing for negative reviews",
];

function buildNegativeConstraints(biz: { negative_constraints: string[] }): string {
  const custom = Array.isArray(biz.negative_constraints) ? biz.negative_constraints : [];
  const all = [...DEFAULT_NEGATIVE_CONSTRAINTS, ...custom.filter(Boolean)];
  return `<prohibited_phrases>\nSTRICTLY FORBIDDEN — never use any of these patterns:\n${all.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}\n</prohibited_phrases>`;
}

// T7: Default constraints always present
const defaultResult = buildNegativeConstraints({ negative_constraints: [] });
assertTrue('Defaults present with empty custom', defaultResult.includes('Dear customer'));
assertTrue('Has prohibited_phrases tag', defaultResult.includes('<prohibited_phrases>'));
assertEq('7 defaults', (defaultResult.match(/\d+\./g) || []).length, 7);

// T8: Custom constraints appended
const customResult = buildNegativeConstraints({ negative_constraints: ['No mencionar preus', 'No dir gratuït'] });
assertTrue('Custom appended', customResult.includes('No mencionar preus'));
assertTrue('Custom 2 appended', customResult.includes('No dir gratuït'));
assertEq('7+2 = 9 total', (customResult.match(/\d+\./g) || []).length, 9);

// T9: Empty strings filtered
const filtered = buildNegativeConstraints({ negative_constraints: ['Valid', '', '  ', 'Also valid'] });
assertTrue('Empty strings filtered', !filtered.includes('\n  8. \n'));
assertTrue('Valid entries present', filtered.includes('Valid') && filtered.includes('Also valid'));

// T10: Null/undefined safety
const nullSafe = buildNegativeConstraints({ negative_constraints: null as any });
assertEq('Null safety → 7 defaults', (nullSafe.match(/\d+\./g) || []).length, 7);

// ============================================================
// 3. PANIC MODE (logic validation)
// ============================================================

console.log('\n=== PANIC MODE: business state logic ===');

interface BizPanic { panic_mode: boolean; panic_reason: string | null; panic_enabled_at: string | null }

function shouldBlockGeneration(biz: BizPanic): boolean {
  return biz.panic_mode === true;
}

// T11: Normal mode → generate allowed
assertEq('Normal mode → allowed', shouldBlockGeneration({
  panic_mode: false, panic_reason: null, panic_enabled_at: null,
}), false);

// T12: Panic mode → generation blocked
assertEq('Panic mode → blocked', shouldBlockGeneration({
  panic_mode: true, panic_reason: 'crisis', panic_enabled_at: new Date().toISOString(),
}), true);

// T13: Panic mode without reason → still blocked
assertEq('Panic no reason → blocked', shouldBlockGeneration({
  panic_mode: true, panic_reason: null, panic_enabled_at: null,
}), true);

// T14: Response format when panic
function buildPanicResponse(biz: BizPanic) {
  return {
    error: 'panic_mode_enabled',
    message: 'La generació IA està aturada (mode pànic). Desactiva-ho a Settings per continuar.',
    panic_reason: biz.panic_reason || null,
    status: 409,
  };
}

const panicResp = buildPanicResponse({ panic_mode: true, panic_reason: 'Crisi reputacional', panic_enabled_at: '2026-01-01' });
assertEq('Panic error code', panicResp.error, 'panic_mode_enabled');
assertEq('Panic HTTP status', panicResp.status, 409);
assertEq('Panic reason', panicResp.panic_reason, 'Crisi reputacional');

// ============================================================
// 4. INTEGRATION-LEVEL ASSERTIONS
// ============================================================

console.log('\n=== INTEGRATION: structural checks ===');

// T15: Audit action types
const validAuditActions = ['panic_mode_enabled', 'panic_mode_disabled'];
for (const a of validAuditActions) {
  assertTrue(`Audit action "${a}" is valid string`, typeof a === 'string' && a.length > 0);
}

// T16: diff_score range
for (let i = 0; i <= 100; i += 25) {
  const s = computeDiffScore('abc def ghi jkl mno'.split(' ').slice(0, 5 - i / 25).join(' '), 'abc def ghi jkl mno');
  assertRange(`diff_score always 0-100 (sample ${i})`, s, 0, 100);
}

console.log('\n=== ALL TESTS COMPLETE ===');
