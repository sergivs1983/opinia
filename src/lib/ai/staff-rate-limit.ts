import type { SupabaseClient } from '@supabase/supabase-js';

export type StaffDailyLimitResult =
  | { ok: true; used: number; limit: number }
  | { ok: false; reason: 'staff_daily_limit' | 'rate_limit_unavailable'; used: number; limit: number };

function utcDayIso(input: Date = new Date()): string {
  return input.toISOString().slice(0, 10);
}

function isSchemaMissing(error: unknown): boolean {
  const code = ((error as { code?: string })?.code || '').toUpperCase();
  const message = ((error as { message?: string })?.message || '').toLowerCase();
  return (
    code === '42703'
    || code === '42P01'
    || code === 'PGRST202'
    || code === 'PGRST204'
    || code === 'PGRST205'
    || message.includes('does not exist')
    || message.includes('schema cache')
  );
}

export async function consumeStaffDailyAction(params: {
  admin: SupabaseClient;
  userId: string;
  limit?: number;
}): Promise<StaffDailyLimitResult> {
  const limit = params.limit ?? 10;
  const day = utcDayIso();

  const { data, error } = await params.admin
    .rpc('consume_staff_daily_action', {
      p_user_id: params.userId,
      p_day: day,
      p_limit: limit,
    })
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return { ok: false, reason: 'rate_limit_unavailable', used: 0, limit };
    }
    return { ok: false, reason: 'rate_limit_unavailable', used: 0, limit };
  }

  const row = (data || {}) as { allowed?: boolean; used?: number; limit?: number };
  const used = typeof row.used === 'number' ? row.used : 0;
  const rowLimit = typeof row.limit === 'number' ? row.limit : limit;
  const allowed = Boolean(row.allowed);

  if (!allowed) {
    return {
      ok: false,
      reason: 'staff_daily_limit',
      used,
      limit: rowLimit,
    };
  }

  return {
    ok: true,
    used,
    limit: rowLimit,
  };
}
