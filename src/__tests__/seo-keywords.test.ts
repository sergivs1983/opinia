/**
 * Tests for SEO Natural Keyword Injection.
 * Run: npx tsx src/__tests__/seo-keywords.test.ts
 */

function assertEq(label: string, actual: any, expected: any) {
  const pass = actual === expected;
  console.log(`${pass ? '✅' : '❌'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if (!pass) process.exitCode = 1;
}
function assertTrue(label: string, cond: boolean) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) process.exitCode = 1;
}

// === buildSeoBlock (copied from generate route) ===
function buildSeoBlock(biz: any, reviewText: string, sentiment: string): string {
  if (!biz.seo_mode || !biz.target_keywords?.length) return '';
  const reviewLower = reviewText.toLowerCase();
  const aggressiveness: number = biz.seo_aggressiveness || 1;
  const available = (biz.target_keywords as string[]).filter(kw =>
    !reviewLower.includes(kw.toLowerCase())
  );
  if (available.length === 0) return '';
  const maxKw = Math.min(aggressiveness, available.length);
  const isNegative = sentiment === 'negative' || sentiment === 'very_negative';
  const isShortReview = reviewText.trim().split(/\s+/).length <= 5;
  return `<seo>
  <enabled>true</enabled>
  <keywords>${available.slice(0, maxKw + 2).join(', ')}</keywords>
  <max_per_response>${maxKw}</max_per_response>
  <rules>
    - Weave up to ${maxKw} keyword${maxKw > 1 ? 's' : ''} NATURALLY into the response text.
    - The keyword must fit grammatically and contextually — never force it.
    - Do NOT list keywords. Do NOT create comma-separated enumerations of keywords.
    - Do NOT repeat a keyword more than once in the same response.
    - The reader should NOT notice these are SEO keywords.
    - ${isNegative ? 'PRIORITY: empathy and resolution FIRST. SEO is secondary.' : ''}
    - ${isShortReview ? 'The review is very short — weave 1 keyword into a contextual compliment about the business.' : ''}
  </rules>
</seo>`;
}

// === SEO stuffing guardrail (copied) ===
function detectSeoStuffing(text: string, keywords: string[]): string[] {
  const warnings: string[] = [];
  const textLower = text.toLowerCase();
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    const occurrences = textLower.split(kwLower).length - 1;
    if (occurrences > 1) {
      warnings.push(`Keyword "${kw}" repetida ${occurrences}x`);
    }
  }
  if (/(?:[A-Za-zÀ-ú ]+,\s*){3,}[A-Za-zÀ-ú ]+/.test(text)) {
    const lists = text.match(/(?:[A-Za-zÀ-ú ]+,\s*){3,}[A-Za-zÀ-ú ]+/g) || [];
    for (const list of lists) {
      if (keywords.some(kw => list.toLowerCase().includes(kw.toLowerCase()))) {
        warnings.push(`Llistat artificial: ${list.slice(0, 40)}`);
      }
    }
  }
  return warnings;
}

console.log('\n=== SEO BLOCK BUILDER ===');

const baseBiz = { seo_mode: true, seo_aggressiveness: 1, target_keywords: ['millors tapes Barcelona', 'restaurant terrassa'] };

// T1: SEO disabled → empty
assertEq('SEO disabled → empty', buildSeoBlock({ ...baseBiz, seo_mode: false }, 'Great!', 'positive'), '');

// T2: No keywords → empty
assertEq('No keywords → empty', buildSeoBlock({ ...baseBiz, target_keywords: [] }, 'Great!', 'positive'), '');

// T3: Keywords present → has <seo> block
const block = buildSeoBlock(baseBiz, 'Molt bo tot!', 'positive');
assertTrue('Has <seo> tag', block.includes('<seo>'));
assertTrue('Has keywords', block.includes('millors tapes Barcelona'));
assertTrue('Max 1 for aggressiveness=1', block.includes('<max_per_response>1</max_per_response>'));

// T4: Aggressiveness 2 → max 2
const block2 = buildSeoBlock({ ...baseBiz, seo_aggressiveness: 2 }, 'Excellent!', 'positive');
assertTrue('Max 2 for aggressiveness=2', block2.includes('<max_per_response>2</max_per_response>'));

// T5: Aggressiveness 3 → max 2 (only 2 keywords available)
const block3 = buildSeoBlock({ ...baseBiz, seo_aggressiveness: 3 }, 'Wow!', 'positive');
assertTrue('Max capped to available keywords', block3.includes('<max_per_response>2</max_per_response>'));

// T6: Keyword already in review → filtered out
const blockFiltered = buildSeoBlock(baseBiz, 'Les millors tapes Barcelona que hem provat!', 'positive');
assertTrue('Keyword in review filtered', !blockFiltered.includes('millors tapes Barcelona'));
assertTrue('Other keyword still present', blockFiltered.includes('restaurant terrassa'));

// T7: ALL keywords in review → empty block
const blockAllFiltered = buildSeoBlock(baseBiz, 'millors tapes barcelona al restaurant terrassa', 'positive');
assertEq('All keywords in review → empty', blockAllFiltered, '');

// T8: Negative sentiment → empathy priority note
const blockNeg = buildSeoBlock(baseBiz, 'Terrible experiència', 'negative');
assertTrue('Negative → empathy priority', blockNeg.includes('empathy'));

// T9: Very negative → also empathy
const blockVNeg = buildSeoBlock(baseBiz, 'Mai tornaré', 'very_negative');
assertTrue('Very negative → empathy', blockVNeg.includes('empathy'));

// T10: Short review → short review hint
const blockShort = buildSeoBlock(baseBiz, 'Perfecte!', 'positive');
assertTrue('Short review hint', blockShort.includes('very short'));

// T11: Long review → no short review hint
const blockLong = buildSeoBlock(baseBiz, 'Una experiència molt bona que ens ha agradat molt a tota la família durant les vacances', 'positive');
assertTrue('Long review → no short hint', !blockLong.includes('very short'));

console.log('\n=== SEO STUFFING GUARDRAIL ===');

const kws = ['millors tapes Barcelona', 'restaurant terrassa'];

// T12: Clean text → no warnings
const clean = detectSeoStuffing('Gràcies per les millors tapes Barcelona del nostre local.', kws);
assertEq('Clean text → 0 warnings', clean.length, 0);

// T13: Keyword repeated 2x → warning
const stuffed = detectSeoStuffing('Les millors tapes Barcelona són les millors tapes Barcelona del món.', kws);
assertTrue('Repeated keyword → warning', stuffed.length > 0);
assertTrue('Warning mentions count', stuffed[0].includes('2x'));

// T14: Comma-separated list with keyword → warning
const listed = detectSeoStuffing('Tenim tapes, restaurant terrassa, cuina, vins, postres al nostre local.', kws);
assertTrue('Comma list with keyword → warning', listed.length > 0);

// T15: Comma list without keywords → no warning
const safeList = detectSeoStuffing('Tenim tapes, vins, postres, formatges al nostre local.', kws);
assertEq('List without keywords → clean', safeList.length, 0);

// T16: Single occurrence → no warning
const single = detectSeoStuffing('Gaudiu del millor restaurant terrassa de la ciutat.', kws);
assertEq('Single occurrence → clean', single.length, 0);

console.log('\n=== ALL SEO TESTS COMPLETE ===');
