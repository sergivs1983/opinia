/**
 * STEP 4 — Guardrail Check (local, zero cost)
 * Validates AI output for facts, tone, repetition, SEO stuffing.
 */

import type { GuardrailWarning, ReplyTone, Business, KnowledgeBaseEntry } from '@/types/database';
import type { GeneratedResponses, RAGContext } from './types';

const TONE_MAP: Record<string, ReplyTone> = {
  option_a: 'proper',
  option_b: 'professional',
  option_c: 'premium',
};

const SEO_REPEAT_MARKER = 'Keyword SEO "';
const SEO_LIST_MARKER = 'Possible llistat artificial de keywords SEO';

function getGrams(s: string): Set<string> {
  const words = s.toLowerCase().split(/\s+/);
  const grams = new Set<string>();
  for (let i = 0; i <= words.length - 3; i++) {
    grams.add(words.slice(i, i + 3).join(' '));
  }
  return grams;
}

export function runGuardrails(
  responses: GeneratedResponses,
  biz: Business,
  rag: RAGContext,
): GuardrailWarning[] {
  const kbContentJoined = rag.allKB.map((e) => e.content).join('\n').toLowerCase();
  const warnings: GuardrailWarning[] = [];

  for (const [key, text] of Object.entries(responses) as [string, string][]) {
    const tone = TONE_MAP[key];
    if (!tone) continue;
    const textLower = text.toLowerCase();

    // G1: Price detection
    const prices = text.match(/\d+([.,]\d{1,2})?\s*[€$£]/g) || [];
    for (const p of prices) {
      const num = p.replace(/[€$£\s]/g, '');
      if (!kbContentJoined.includes(num)) {
        warnings.push({ tone, type: 'price_mention', text: `Preu "${p}" no verificat al Business Memory`, span: p });
      }
    }

    // G2: Time detection
    const times = text.match(/\b\d{1,2}[:.h]\d{0,2}\s*(h|am|pm|hores)?\b/gi) || [];
    for (const t of times) {
      if (!kbContentJoined.includes(t.toLowerCase().replace(/\s/g, ''))) {
        warnings.push({ tone, type: 'schedule_mention', text: `Horari "${t}" no verificat`, span: t });
      }
    }

    // G3: Percentage detection
    const percents = text.match(/\b\d+\s*%/g) || [];
    for (const p of percents) {
      if (!kbContentJoined.includes(p.replace(/\s/g, ''))) {
        warnings.push({ tone, type: 'unverified_fact', text: `Dada "${p}" no verificada`, span: p });
      }
    }

    // G4: Formality check
    if (biz.formality === 'voste') {
      for (const m of [' tu ', ' teu ', ' teva ']) {
        if (textLower.includes(m)) {
          warnings.push({ tone, type: 'unverified_fact', text: `Formalitat incorrecta: "${m.trim()}"`, span: m.trim() });
        }
      }
    }

    // G5: Repetition check (Jaccard 3-gram)
    if (rag.recentReplies.length > 0) {
      const textGrams = getGrams(text);
      for (const recent of rag.recentReplies.slice(0, 3)) {
        const recentGrams = getGrams(recent);
        const intersection = [...textGrams].filter((g) => recentGrams.has(g)).length;
        const union = new Set([...textGrams, ...recentGrams]).size;
        const similarity = union > 0 ? intersection / union : 0;
        if (similarity > 0.45) {
          warnings.push({ tone, type: 'hallucination', text: `Massa similar a resposta recent (${(similarity * 100).toFixed(0)}%)`, span: `${(similarity * 100).toFixed(0)}%` });
          break;
        }
      }
    }

    // G6: SEO keyword stuffing check
    const legacyBiz = biz as unknown as { seo_mode?: boolean };
    const seoActive = biz.seo_enabled ?? legacyBiz.seo_mode;
    const allSeoKw = [...new Set([...(biz.seo_keywords || []), ...(biz.target_keywords || [])])];
    if (seoActive && allSeoKw.length > 0) {
      for (const kw of allSeoKw) {
        const kwLower = kw.toLowerCase();
        const occurrences = textLower.split(kwLower).length - 1;
        if (occurrences > 1) {
          warnings.push({
            tone, type: 'unverified_fact',
            text: `Keyword SEO "${kw}" repetida ${occurrences}x — possible stuffing`,
            span: kw,
          });
        }
      }
      // Detect comma-separated keyword lists
      if (/(?:[A-Za-zÀ-ú ]+,\s*){3,}[A-Za-zÀ-ú ]+/.test(text)) {
        const suspiciousLists = text.match(/(?:[A-Za-zÀ-ú ]+,\s*){3,}[A-Za-zÀ-ú ]+/g) || [];
        for (const list of suspiciousLists) {
          const hasKeyword = allSeoKw.some((kw) => list.toLowerCase().includes(kw.toLowerCase()));
          if (hasKeyword) {
            warnings.push({
              tone, type: 'unverified_fact',
              text: `Possible llistat artificial de keywords SEO`,
              span: list.slice(0, 60),
            });
          }
        }
      }
    }
  }

  return warnings;
}

export function isSeoAutofixWarning(warning: GuardrailWarning): boolean {
  if (warning.type !== 'unverified_fact') return false;
  return warning.text.includes(SEO_REPEAT_MARKER) || warning.text.includes(SEO_LIST_MARKER);
}

export function hasSeoAutofixWarnings(warnings: GuardrailWarning[]): boolean {
  return warnings.some(isSeoAutofixWarning);
}
