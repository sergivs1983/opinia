/**
 * Tests for SEO Natural v2 (seo_rules) + Action Trigger matcher
 * Run: npx tsx src/__tests__/seo-triggers.test.ts
 */

// ============================================================
// TEST HELPERS — Extracted logic from generate route
// ============================================================

function buildSeoBlock(biz: any, reviewText: string, sentiment: string, rating: number): string {
  const enabled = biz.seo_enabled ?? biz.seo_mode ?? false;
  if (!enabled) return '';

  const allKeywords: string[] = [
    ...(biz.seo_keywords || []),
    ...(biz.target_keywords || []),
  ].filter((kw: string, i: number, arr: string[]) => kw && arr.indexOf(kw) === i);

  if (allKeywords.length === 0) return '';

  const rules = biz.seo_rules || {};
  const maxKw: number = rules.max_keywords_per_reply ?? biz.seo_aggressiveness ?? 2;
  const avoidIfNeg: boolean = rules.avoid_if_negative ?? true;
  const minRating: number = rules.min_rating_for_keywords ?? 4;

  const isNegative = sentiment === 'negative' || sentiment === 'very_negative';
  if (isNegative && avoidIfNeg) return '';
  if (rating && rating < minRating) return '';

  const reviewLower = reviewText.toLowerCase();
  const available = allKeywords.filter((kw: string) => !reviewLower.includes(kw.toLowerCase()));
  if (available.length === 0) return '';

  return `SEO:${available.slice(0, Math.min(maxKw, available.length)).join(',')}`;
}

function matchTrigger(
  trigger: any,
  reviewText: string,
  rating: number,
  sentiment: string,
  topics: string[]
): boolean {
  const reviewLower = reviewText.toLowerCase();
  const topicsLower = topics.map(t => t.toLowerCase());
  let matched = false;

  if (trigger.match_topics?.length > 0) {
    const triggerTopics = trigger.match_topics.map((t: string) => t.toLowerCase());
    if (topicsLower.some((t: string) => triggerTopics.includes(t))) matched = true;
  }

  if (!matched && trigger.match_phrases?.length > 0) {
    for (const phrase of trigger.match_phrases) {
      if (reviewLower.includes(phrase.toLowerCase())) { matched = true; break; }
    }
  }

  if (!matched) return false;
  if (trigger.min_rating != null && rating < trigger.min_rating) return false;

  if (trigger.sentiment_filter) {
    const sentMap: Record<string, string[]> = {
      negative: ['negative', 'very_negative'],
      neutral: ['neutral', 'mixed'],
      positive: ['positive', 'very_positive'],
    };
    if (!sentMap[trigger.sentiment_filter]?.includes(sentiment)) return false;
  }

  return true;
}

// ============================================================
// TESTS
// ============================================================
let pass = 0, fail = 0;
function assert(label: string, got: any, expected: any) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  ok ? pass++ : fail++;
}

console.log('\n=== SEO RULES v2 ===');

// T1: seo_enabled=false → empty
assert('Disabled → empty', buildSeoBlock({ seo_enabled: false, seo_keywords: ['test'] }, 'review', 'positive', 5), '');

// T2: seo_enabled=true, keywords present
assert('Enabled with keywords → non-empty', buildSeoBlock(
  { seo_enabled: true, seo_keywords: ['tapas barcelona'] }, 'great restaurant', 'positive', 5
) !== '', true);

// T3: avoid_if_negative=true, negative sentiment
assert('Negative + avoid → empty', buildSeoBlock(
  { seo_enabled: true, seo_keywords: ['tapas'], seo_rules: { max_keywords_per_reply: 2, avoid_if_negative: true, min_rating_for_keywords: 1 } },
  'terrible experience', 'negative', 2
), '');

// T4: avoid_if_negative=false, negative sentiment → still outputs
assert('Negative + no avoid → non-empty', buildSeoBlock(
  { seo_enabled: true, seo_keywords: ['tapas'], seo_rules: { max_keywords_per_reply: 2, avoid_if_negative: false, min_rating_for_keywords: 1 } },
  'terrible experience', 'negative', 2
) !== '', true);

// T5: min_rating filter
assert('Rating 3 < min 4 → empty', buildSeoBlock(
  { seo_enabled: true, seo_keywords: ['tapas'], seo_rules: { max_keywords_per_reply: 2, avoid_if_negative: false, min_rating_for_keywords: 4 } },
  'ok restaurant', 'neutral', 3
), '');

// T6: Rating 4 >= min 4 → non-empty
assert('Rating 4 >= min 4 → non-empty', buildSeoBlock(
  { seo_enabled: true, seo_keywords: ['tapas'], seo_rules: { max_keywords_per_reply: 2, avoid_if_negative: false, min_rating_for_keywords: 4 } },
  'good restaurant', 'positive', 4
) !== '', true);

// T7: max_keywords_per_reply respected
assert('Max 1 kw → only 1', buildSeoBlock(
  { seo_enabled: true, seo_keywords: ['tapas', 'wine', 'view'], seo_rules: { max_keywords_per_reply: 1, avoid_if_negative: false, min_rating_for_keywords: 1 } },
  'great place', 'positive', 5
), 'SEO:tapas');

// T8: Dedupes seo_keywords + target_keywords
assert('Deduped keywords', buildSeoBlock(
  { seo_enabled: true, seo_keywords: ['tapas', 'wine'], target_keywords: ['tapas', 'terrace'], seo_rules: { max_keywords_per_reply: 3, avoid_if_negative: false, min_rating_for_keywords: 1 } },
  'great place', 'positive', 5
), 'SEO:tapas,wine,terrace');

// T9: Legacy fallback (seo_mode + seo_aggressiveness)
assert('Legacy seo_mode=true → works', buildSeoBlock(
  { seo_mode: true, target_keywords: ['tapas'], seo_aggressiveness: 2 },
  'great place', 'positive', 5
) !== '', true);

console.log('\n=== ACTION TRIGGER MATCHER ===');

const baseTrigger = {
  match_topics: ['parking'],
  match_phrases: ['too expensive'],
  min_rating: null,
  sentiment_filter: null,
};

// T10: Topic match
assert('Topic match', matchTrigger(baseTrigger, 'parking issue', 3, 'negative', ['parking']), true);

// T11: Phrase match
assert('Phrase match', matchTrigger(baseTrigger, 'food was too expensive', 2, 'negative', ['food']), true);

// T12: No match
assert('No match', matchTrigger(baseTrigger, 'great food and service', 5, 'positive', ['food', 'service']), false);

// T13: Min rating filter
assert('Below min rating → no match', matchTrigger(
  { ...baseTrigger, min_rating: 3 }, 'parking bad', 2, 'negative', ['parking']
), false);

// T14: Min rating OK
assert('At min rating → match', matchTrigger(
  { ...baseTrigger, min_rating: 3 }, 'parking bad', 3, 'negative', ['parking']
), true);

// T15: Sentiment filter: negative only
assert('Sentiment negative → match negative', matchTrigger(
  { ...baseTrigger, sentiment_filter: 'negative' }, 'parking bad', 2, 'negative', ['parking']
), true);

// T16: Sentiment filter: negative rejects positive
assert('Sentiment negative → reject positive', matchTrigger(
  { ...baseTrigger, sentiment_filter: 'negative' }, 'parking great', 5, 'positive', ['parking']
), false);

// T17: Case insensitive phrase
assert('Case insensitive phrase', matchTrigger(
  { match_topics: [], match_phrases: ['Bad Service'], min_rating: null, sentiment_filter: null },
  'the bad service was unacceptable', 1, 'negative', []
), true);

// T18: Empty triggers → no match
assert('Empty topics+phrases → no match', matchTrigger(
  { match_topics: [], match_phrases: [], min_rating: null, sentiment_filter: null },
  'anything', 3, 'neutral', ['anything']
), false);

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
