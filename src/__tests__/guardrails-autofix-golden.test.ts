/**
 * Golden tests for G6 guardrail auto-fix behavior.
 * Run: npx tsx src/__tests__/guardrails-autofix-golden.test.ts
 */

import { runGuardrails, hasSeoAutofixWarnings } from '../lib/pipeline/guardrails';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

function countOccurrences(text: string, term: string): number {
  return text.toLowerCase().split(term.toLowerCase()).length - 1;
}

function applySeoAutofixForTest(
  initialResponses: { option_a: string; option_b: string; option_c: string },
  fallbackResponses: { option_a: string; option_b: string; option_c: string },
  biz: any,
  rag: any
) {
  let finalResponses = initialResponses;
  let warnings = runGuardrails(finalResponses, biz, rag);

  if (hasSeoAutofixWarnings(warnings)) {
    const fallbackBiz = {
      ...biz,
      seo_enabled: false,
      seo_mode: false,
      seo_aggressiveness: 1,
    };
    finalResponses = fallbackResponses;
    warnings = runGuardrails(finalResponses, fallbackBiz, rag);
  }

  return { finalResponses, warnings };
}

const baseBiz = {
  formality: 'tu',
  seo_enabled: true,
  seo_mode: true,
  seo_aggressiveness: 2,
  seo_keywords: ['millors tapes Barcelona', 'restaurant terrassa Tarragona'],
  target_keywords: ['millors tapes Barcelona', 'restaurant terrassa Tarragona'],
  seo_rules: {
    max_keywords_per_reply: 2,
    avoid_if_negative: true,
    min_rating_for_keywords: 4,
  },
};

const baseRag = {
  allKB: [],
  relevantKB: [],
  recentReplies: [],
  recentOpenings: [],
  recentClosings: [],
};

console.log('\n=== GOLDEN 1: Keyword repetida -> final net ===');

const keywordStuffed = {
  option_a: "Gràcies per visitar-nos! L'equip.",
  option_b: "Ens encanta oferir les millors tapes Barcelona. Si busques millors tapes Barcelona, torna aviat. L'equip.",
  option_c: "Un plaer tenir-te amb nosaltres. L'equip.",
};
const keywordFallback = {
  option_a: "Gràcies per visitar-nos! L'equip.",
  option_b: "Ens encanta que hagis gaudit de l'experiència gastronòmica. Esperem tornar-te a veure aviat. L'equip.",
  option_c: "Un plaer tenir-te amb nosaltres. L'equip.",
};

const result1 = applySeoAutofixForTest(keywordStuffed, keywordFallback, baseBiz, baseRag);

assert(
  'Input inicial detecta G6',
  hasSeoAutofixWarnings(runGuardrails(keywordStuffed, baseBiz as any, baseRag as any))
);
assert(
  'Output final sense keyword repetida',
  countOccurrences(result1.finalResponses.option_b, 'millors tapes Barcelona') <= 1
);
assert('Output final sense warnings G6', !hasSeoAutofixWarnings(result1.warnings));

console.log('\n=== GOLDEN 2: Llista amb comes -> final net ===');

const commaListStuffed = {
  option_a: "Gràcies per la visita! L'equip.",
  option_b: "Som referent en millors tapes Barcelona, restaurant terrassa Tarragona, cuina mediterrània, producte local. L'equip.",
  option_c: "Ens alegra que t'hagi agradat. L'equip.",
};
const commaListFallback = {
  option_a: "Gràcies per la visita! L'equip.",
  option_b: "Treballem cada dia per oferir una cuina honesta i una atenció propera. L'equip.",
  option_c: "Ens alegra que t'hagi agradat. L'equip.",
};

const result2 = applySeoAutofixForTest(commaListStuffed, commaListFallback, baseBiz, baseRag);

assert(
  'Input inicial detecta llista artificial G6',
  hasSeoAutofixWarnings(runGuardrails(commaListStuffed, baseBiz as any, baseRag as any))
);
assert(
  'Output final sense llista artificial',
  !/(?:[A-Za-zÀ-ú ]+,\s*){3,}[A-Za-zÀ-ú ]+/.test(result2.finalResponses.option_b)
);
assert('Output final sense warnings G6', !hasSeoAutofixWarnings(result2.warnings));

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
