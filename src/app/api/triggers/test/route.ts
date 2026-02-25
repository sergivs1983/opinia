export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { validateBody, TriggerTestSchema } from '@/lib/validations';
import { requireBizAccess, assertSingleBizId, withRequestContext } from '@/lib/api-handler';

/**
 * POST /api/triggers/test
 * Body: { biz_id, test_text, test_rating?, test_sentiment? }
 * Returns which triggers would match the given text.
 */
export const POST = withRequestContext(async function(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // ── Validate ──
  const [body, err] = await validateBody(request, TriggerTestSchema);
  if (err) return err;

  // ── Input hardening: biz_id per una sola via ─────────────────────────────
  const { bizId: resolvedBizId, error: ambigErr } = assertSingleBizId([
    new URL(request.url).searchParams.get('biz_id'),
    body.biz_id,
  ]);
  if (ambigErr) return ambigErr;
  // ── Biz-level guard ──────────────────────────────────────────────────────
  const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId: resolvedBizId });
  if (bizGuard) return bizGuard;

  const { data: triggers } = await supabase
    .from('action_triggers')
    .select('*')
    .eq('biz_id', body.biz_id)
    .eq('is_enabled', true);

  if (!triggers || triggers.length === 0) {
    return NextResponse.json({ matches: [], message: 'No enabled triggers found' });
  }

  const textLower = body.test_text.toLowerCase();
  const matches: { id: string; name: string; match_reason: string }[] = [];

  for (const trigger of triggers) {
    let reason = '';

    // Topic match
    if (trigger.match_topics?.length > 0) {
      for (const topic of trigger.match_topics) {
        if (textLower.includes(topic.toLowerCase())) {
          reason = `topic "${topic}"`;
          break;
        }
      }
    }

    // Phrase match
    if (!reason && trigger.match_phrases?.length > 0) {
      for (const phrase of trigger.match_phrases) {
        if (textLower.includes(phrase.toLowerCase())) {
          reason = `phrase "${phrase}"`;
          break;
        }
      }
    }

    if (!reason) continue;

    // Rating filter
    if (trigger.min_rating != null && body.test_rating != null && body.test_rating < trigger.min_rating) continue;

    // Sentiment filter
    if (trigger.sentiment_filter && body.test_sentiment && trigger.sentiment_filter !== body.test_sentiment) continue;

    matches.push({ id: trigger.id, name: trigger.name, match_reason: reason });
  }

  return NextResponse.json({ matches });
});
