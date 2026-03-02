import { NextResponse } from 'next/server';

import { getAcceptedBusinessMembershipContext } from '@/lib/authz';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { type LitoMemberRole, toLitoMemberRole } from '@/lib/ai/lito-rbac';

const MEMORY_ALLOWED_ROLES = ['owner', 'manager', 'staff'] as const;

export function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export function parseBizIdFromSearch(request: Request): string | null {
  const searchParams = new URL(request.url).searchParams;
  const raw = searchParams.get('biz_id');
  if (!raw) return null;
  return raw.trim() || null;
}

export async function requireMemoryBizAccess(params: {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  userId: string;
  bizId: string;
}): Promise<{ ok: true; orgId: string; role: LitoMemberRole | null } | { ok: false }> {
  const access = await getAcceptedBusinessMembershipContext({
    supabase: params.supabase,
    userId: params.userId,
    businessId: params.bizId,
    allowedRoles: [...MEMORY_ALLOWED_ROLES],
  });
  if (!access.allowed || !access.orgId) return { ok: false };
  return {
    ok: true,
    orgId: access.orgId,
    role: toLitoMemberRole(access.role),
  };
}
