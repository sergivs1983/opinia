import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import {
  ACTIVE_ORG_COOKIE,
  resolveActiveMembership,
  type MembershipSelectorRow,
} from '@/lib/workspace/active-org';

export type ServerMembershipRow = MembershipSelectorRow & {
  user_id: string;
};

export async function resolveServerActiveMembership(args: {
  supabase: SupabaseClient;
  userId: string;
  cookieOrgId?: string | null;
}): Promise<ServerMembershipRow | null> {
  const { supabase, userId, cookieOrgId } = args;
  const { data, error } = await supabase
    .from('memberships')
    .select('id, user_id, org_id, is_default, created_at, accepted_at')
    .eq('user_id', userId)
    .not('accepted_at', 'is', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error || !data || data.length === 0) return null;
  return resolveActiveMembership(data as ServerMembershipRow[], cookieOrgId);
}

export function getServerActiveOrgCookieValue(): string | null {
  return cookies().get(ACTIVE_ORG_COOKIE)?.value ?? null;
}

