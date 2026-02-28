import type { SupabaseClient } from '@supabase/supabase-js';

import { getAcceptedBusinessMembershipContext } from '@/lib/authz';
import { toLitoMemberRole, type LitoMemberRole } from '@/lib/ai/lito-rbac';

export type LitoActionDraftRow = {
  id: string;
  org_id: string;
  biz_id: string;
  thread_id: string | null;
  source_voice_clip_id: string | null;
  idempotency_key?: string | null;
  kind: 'gbp_update' | 'social_post' | 'customer_email';
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'executed';
  payload: Record<string, unknown>;
  created_by: string;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LitoBizAccess = {
  allowed: boolean;
  orgId: string | null;
  role: LitoMemberRole | null;
};

export async function getLitoBizAccess(params: {
  supabase: SupabaseClient;
  userId: string;
  bizId: string;
}): Promise<LitoBizAccess> {
  const context = await getAcceptedBusinessMembershipContext({
    supabase: params.supabase,
    userId: params.userId,
    businessId: params.bizId,
  });
  const role = toLitoMemberRole(context.role);
  return {
    allowed: context.allowed && Boolean(role) && Boolean(context.orgId),
    orgId: context.orgId || null,
    role,
  };
}

export function canConfirmOrExecute(role: LitoMemberRole | null): boolean {
  return role === 'owner' || role === 'manager';
}

export function canEditOwnDraft(role: LitoMemberRole | null): boolean {
  return role === 'staff' || role === 'owner' || role === 'manager';
}
