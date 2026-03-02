import type { SupabaseClient } from '@supabase/supabase-js';

import { loadBusinessContext } from '@/lib/lito/context/business';
import { loadLearnedContext } from '@/lib/lito/context/learned';
import { loadSignalsContext } from '@/lib/lito/context/signals';
import { loadStateContext } from '@/lib/lito/context/state';
import { buildContextSummary } from '@/lib/lito/context/summary';
import type { LITOPayload } from '@/lib/lito/context/types';

export async function buildLITOPayload(input: {
  admin: SupabaseClient;
  bizId: string;
  userId: string;
  mode?: 'basic' | 'advanced';
  now?: Date;
}): Promise<LITOPayload> {
  const now = input.now || new Date();
  const businessContext = await loadBusinessContext({
    admin: input.admin,
    bizId: input.bizId,
  });

  const [learnedContext, stateContext, signalsContext] = await Promise.all([
    loadLearnedContext({
      admin: input.admin,
      orgId: businessContext.org_id,
      bizId: input.bizId,
    }),
    loadStateContext({
      admin: input.admin,
      bizId: input.bizId,
      now,
    }),
    loadSignalsContext({
      admin: input.admin,
      bizId: input.bizId,
      now,
      mode: input.mode || 'advanced',
    }),
  ]);

  const basePayload = {
    generated_at: now.toISOString(),
    biz_id: input.bizId,
    user_id: input.userId,
    business_context: businessContext,
    learned_context: learnedContext,
    state_context: stateContext,
    signals_context: signalsContext,
  };

  return {
    ...basePayload,
    context_summary: buildContextSummary(basePayload),
  };
}
