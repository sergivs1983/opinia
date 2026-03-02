import type { SupabaseClient } from '@supabase/supabase-js';

import {
  listSignalsForBusiness,
  pickTopSignals,
  toSignalCards,
} from '@/lib/signals/pro';
import type {
  LITOSignalContextItem,
  LITOSignalsContext,
} from '@/lib/lito/context/types';

function toSeverity(value: string): LITOSignalContextItem['severity'] {
  if (value === 'high') return 'high';
  if (value === 'med' || value === 'medium') return 'medium';
  return 'low';
}

function compactText(value: unknown, max = 120): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return '';
  return text.slice(0, max);
}

function buildMetric(value: {
  reason: string;
  code: string;
  severity: 'high' | 'med' | 'low';
}): string {
  const reason = compactText(value.reason, 100);
  if (reason) return reason;
  const severity = value.severity === 'high' ? 'alta' : value.severity === 'med' ? 'mitjana' : 'baixa';
  return `${value.code} · prioritat ${severity}`;
}

export async function loadSignalsContext(input: {
  admin: SupabaseClient;
  bizId: string;
  now?: Date;
  mode?: 'basic' | 'advanced';
}): Promise<LITOSignalsContext> {
  const now = input.now || new Date();
  const since = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const mode = input.mode || 'advanced';

  const rows = await listSignalsForBusiness({
    admin: input.admin,
    bizId: input.bizId,
    provider: 'google_business',
    sinceDay: since.toISOString().slice(0, 10),
    limit: 12,
  });

  const cards = toSignalCards({
    rows,
    bizId: input.bizId,
  });

  const topLimit = mode === 'advanced' ? 3 : 1;
  const top = pickTopSignals(cards, topLimit).map<LITOSignalContextItem>((signal) => ({
    id: signal.id,
    severity: toSeverity(signal.severity),
    title: compactText(signal.title, 96) || 'Senyal activa',
    metric: buildMetric({
      reason: signal.reason,
      code: signal.code,
      severity: signal.severity,
    }),
  }));

  return {
    active_count: rows.length,
    top,
  };
}
