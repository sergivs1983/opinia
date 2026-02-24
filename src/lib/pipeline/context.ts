/**
 * STEP 2 — RAG Retrieval + Anti-repetition context
 * Matches KB entries against review, loads recent replies.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import type { KnowledgeBaseEntry } from '@/types/database';
import type { RAGContext, MatchedKB, Classification } from './types';

export async function buildRAGContext(
  bizId: string,
  reviewText: string,
  classification: Classification
): Promise<RAGContext> {
  const admin = createAdminClient();

  // Load all KB entries
  const { data: kbEntries } = await admin
    .from('knowledge_base_entries')
    .select('*')
    .eq('biz_id', bizId);

  const allKB: KnowledgeBaseEntry[] = (kbEntries || []) as KnowledgeBaseEntry[];

  // Match triggers against review text + topics
  const reviewLower = reviewText.toLowerCase();
  const topicsLower = classification.topics.map((t) => t.toLowerCase());
  const searchTerms = new Set([
    ...reviewLower.split(/[\s,.!?;:()]+/).filter((w) => w.length > 2),
    ...topicsLower,
  ]);

  const matchedKB: MatchedKB[] = [];

  for (const entry of allKB) {
    let score = 0;

    // Check triggers
    for (const trigger of entry.triggers) {
      const tLower = trigger.toLowerCase();
      if (searchTerms.has(tLower) || reviewLower.includes(tLower)) {
        score += 1;
      }
    }

    // Category vs topics
    for (const topic of topicsLower) {
      if (entry.category.toLowerCase().includes(topic) || topic.includes(entry.category.toLowerCase())) {
        score += 0.5;
      }
    }

    // Content word overlap (last resort)
    if (score === 0) {
      const contentWords = entry.content.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
      let overlap = 0;
      for (const cw of contentWords) {
        if (reviewLower.includes(cw)) overlap++;
      }
      if (overlap >= 2) score = 0.3;
    }

    if (score > 0) {
      matchedKB.push({ ...entry, match_score: score });
    }
  }

  matchedKB.sort((a, b) => b.match_score - a.match_score);
  const relevantKB = matchedKB.slice(0, 5);

  // Load recent replies for anti-repetition
  const { data: recentRepliesData } = await admin
    .from('replies')
    .select('content')
    .eq('biz_id', bizId)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(10);

  const recentReplies: string[] = (recentRepliesData || []).map((r: { content: string }) => r.content);

  const recentOpenings = recentReplies
    .map((r) => r.split(/[.!?]/)[0]?.trim())
    .filter(Boolean)
    .slice(0, 4);

  const recentClosings = recentReplies
    .map((r) => {
      const sentences = r.split(/[.!?]/).filter((s) => s.trim());
      return sentences[sentences.length - 1]?.trim();
    })
    .filter(Boolean)
    .slice(0, 4);

  return { allKB, relevantKB, recentReplies, recentOpenings, recentClosings };
}
