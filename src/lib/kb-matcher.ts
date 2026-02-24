import type { KBEntry } from '@/types/database';

export interface MatchResult {
  entry: KBEntry;
  score: number;
  matched_triggers: string[];
}

/**
 * Match KB entries to a review using trigger keywords.
 * Deterministic, zero latency, zero cost.
 */
export function matchKBEntries(
  reviewText: string,
  entries: KBEntry[],
  maxResults: number = 5
): MatchResult[] {
  const reviewLower = reviewText.toLowerCase();
  const reviewWords = new Set(
    reviewLower.split(/[\s,.!?;:()]+/).filter(w => w.length > 2)
  );

  const now = new Date();
  const results: MatchResult[] = [];

  for (const entry of entries) {
    if (!entry.is_active) continue;

    // Check validity window
    if (entry.valid_from && new Date(entry.valid_from) > now) continue;
    if (entry.valid_until && new Date(entry.valid_until) < now) continue;

    const matched: string[] = [];

    // Match triggers
    const triggers = (entry as any).triggers || [];
    for (const trigger of triggers) {
      const triggerLower = trigger.toLowerCase();
      if (reviewWords.has(triggerLower) || reviewLower.includes(triggerLower)) {
        matched.push(trigger);
      }
    }

    // Fallback: topic word matching
    if (matched.length === 0) {
      const topicWords = entry.topic.toLowerCase().split(/\s+/);
      for (const tw of topicWords) {
        if (tw.length > 3 && reviewLower.includes(tw)) {
          matched.push(`[topic:${tw}]`);
        }
      }
    }

    // Content word matching as last resort
    if (matched.length === 0) {
      const contentWords = entry.content.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      let contentMatches = 0;
      for (const cw of contentWords) {
        if (reviewLower.includes(cw)) contentMatches++;
      }
      if (contentMatches >= 2) {
        matched.push(`[content-match:${contentMatches}]`);
      }
    }

    if (matched.length > 0) {
      const triggerRatio = triggers.length > 0
        ? matched.length / triggers.length
        : 0.3;
      const priorityBoost = 1 + (entry.priority / 10);
      const score = triggerRatio * priorityBoost;

      results.push({ entry, score, matched_triggers: matched });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Format matched entries for prompt injection.
 * XML structure prevents prompt injection from KB content.
 */
export function formatKBForPrompt(matches: MatchResult[]): string {
  if (matches.length === 0) {
    return '<business_knowledge>\nNo verified facts available. Do NOT invent specific details.\n</business_knowledge>';
  }

  const lines = matches.map((m, i) => {
    const cat = (m.entry as any).category || m.entry.type;
    const validity = (m.entry as any).valid_until
      ? ` [valid until ${(m.entry as any).valid_until}]`
      : '';
    const sensitivity = m.entry.type === 'sensitive'
      ? ' ⚠️ DEFLECT TO PRIVATE CONTACT'
      : '';
    return `  <fact id="${i + 1}" category="${cat}" relevance="${m.score.toFixed(2)}"${validity}${sensitivity}>
    ${m.entry.topic}: ${m.entry.content}
  </fact>`;
  });

  return `<business_knowledge>
  ONLY reference these verified facts when relevant. NEVER fabricate beyond these.
${lines.join('\n')}
</business_knowledge>`;
}
