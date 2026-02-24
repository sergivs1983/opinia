/**
 * STEP 4.5 — Action Triggers
 * Matches triggers against review and fires notifications.
 */

import type { Business } from '@/types/database';
import type { FiredTrigger } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function matchAndFireTriggers(
  adminClient: SupabaseClient,
  biz: Business,
  reviewId: string,
  reviewText: string,
  rating: number,
  sentiment: string,
  topics: string[],
): Promise<FiredTrigger[]> {
  const { data: triggers } = await adminClient
    .from('action_triggers')
    .select('*')
    .eq('biz_id', biz.id)
    .eq('is_enabled', true);

  if (!triggers || triggers.length === 0) return [];

  const reviewLower = reviewText.toLowerCase();
  const topicsLower = topics.map((t) => t.toLowerCase());
  const fired: FiredTrigger[] = [];

  for (const trigger of triggers) {
    let matched = false;

    // Topic match
    if (trigger.match_topics?.length > 0) {
      const triggerTopics = trigger.match_topics.map((t: string) => t.toLowerCase());
      if (topicsLower.some((t) => triggerTopics.includes(t))) {
        matched = true;
      }
    }

    // Phrase match
    if (!matched && trigger.match_phrases?.length > 0) {
      for (const phrase of trigger.match_phrases) {
        if (reviewLower.includes(phrase.toLowerCase())) {
          matched = true;
          break;
        }
      }
    }

    if (!matched) continue;

    // Filter by min_rating
    if (trigger.min_rating != null && rating < trigger.min_rating) continue;

    // Filter by sentiment
    if (trigger.sentiment_filter) {
      const sentMap: Record<string, string[]> = {
        negative: ['negative', 'very_negative'],
        neutral: ['neutral', 'mixed'],
        positive: ['positive', 'very_positive'],
      };
      if (!sentMap[trigger.sentiment_filter]?.includes(sentiment)) continue;
    }

    // Fire notification (non-blocking)
    const { error: notificationError } = await adminClient.from('notifications').insert({
      org_id: biz.org_id,
      biz_id: biz.id,
      review_id: reviewId,
      trigger_id: trigger.id,
      type: trigger.action_type || 'in_app_alert',
      title: `Trigger "${trigger.name}" fired`,
      body: `Review matched: ${trigger.match_topics?.length ? 'topics [' + trigger.match_topics.join(', ') + ']' : ''} ${trigger.match_phrases?.length ? 'phrases [' + trigger.match_phrases.join(', ') + ']' : ''}`.trim(),
      payload: {
        trigger_name: trigger.name,
        action_type: trigger.action_type,
        action_target: trigger.action_target,
        review_text_preview: reviewText.slice(0, 100),
        rating,
        sentiment,
        topics,
      },
    });
    if (notificationError) {
      // Keep trigger flow non-blocking on notification insert failure.
      // Intentionally still record trigger as fired (legacy behavior).
    }

    fired.push({ triggerId: trigger.id, triggerName: trigger.name });
  }

  return fired;
}
