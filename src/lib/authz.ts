import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemberRole } from '@/types/database';
import {
  normalizeMemberRole,
  type CanonicalMemberRole,
} from '@/lib/roles';

type ViewerUser = {
  email?: string | null;
} | null;

type AdminViewerInput = {
  user: ViewerUser;
  orgId?: string | null;
  businessId?: string | null;
};

type OrgMembershipCheckInput = {
  supabase: SupabaseClient;
  userId: string;
  orgId: string;
  allowedRoles?: Array<MemberRole | CanonicalMemberRole>;
};

type OrgMembershipRow = {
  id: string;
  org_id?: string;
  user_id?: string;
  role: MemberRole;
};

type BusinessMembershipCheckInput = {
  supabase: SupabaseClient;
  userId: string;
  businessId: string;
  allowedRoles?: Array<MemberRole | CanonicalMemberRole>;
};

type BusinessOrgRow = {
  id: string;
  org_id: string;
};

type BusinessAssignmentRow = {
  business_id: string;
  role_override: string | null;
  is_active: boolean;
};

function isMissingBusinessMembershipTable(error: unknown): boolean {
  const message = ((error as { message?: string })?.message || '').toLowerCase();
  return message.includes('business_memberships')
    || message.includes('relation')
    || message.includes('does not exist');
}

function parseAdminEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\s;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminViewer({ user }: AdminViewerInput): boolean {
  const email = user?.email?.trim().toLowerCase();
  if (!email) return false;
  const allowlist = parseAdminEmails(process.env.ADMIN_EMAILS);
  return allowlist.has(email);
}

export async function hasAcceptedOrgMembership({
  supabase,
  userId,
  orgId,
  allowedRoles,
}: OrgMembershipCheckInput): Promise<boolean> {
  const query = supabase
    .from('memberships')
    .select('id, role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .not('accepted_at', 'is', null)
    .limit(1)
    .maybeSingle();

  const { data, error } = await query;
  if (error || !data) return false;

  const membership = data as OrgMembershipRow;
  if (!allowedRoles || allowedRoles.length === 0) return true;
  const normalizedMembershipRole = normalizeMemberRole(membership.role);
  const normalizedAllowedRoles = allowedRoles.map((role) => normalizeMemberRole(role));
  return normalizedAllowedRoles.includes(normalizedMembershipRole);
}

export async function getAcceptedOrgMembership({
  supabase,
  userId,
  orgId,
}: {
  supabase: SupabaseClient;
  userId: string;
  orgId: string;
}): Promise<(OrgMembershipRow & { org_id: string; user_id: string; normalized_role: CanonicalMemberRole }) | null> {
  const { data, error } = await supabase
    .from('memberships')
    .select('id, user_id, org_id, role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .not('accepted_at', 'is', null)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const membership = data as OrgMembershipRow & { org_id: string; user_id: string };
  return {
    ...membership,
    normalized_role: normalizeMemberRole(membership.role),
  };
}

export async function hasAcceptedBusinessMembership({
  supabase,
  userId,
  businessId,
  allowedRoles,
}: BusinessMembershipCheckInput): Promise<{ allowed: boolean; orgId: string | null }> {
  const { data: businessData, error: businessError } = await supabase
    .from('businesses')
    .select('id, org_id')
    .eq('id', businessId)
    .single();

  if (businessError || !businessData) {
    return { allowed: false, orgId: null };
  }

  const business = businessData as BusinessOrgRow;
  const { data: orgMembershipData, error: orgMembershipError } = await supabase
    .from('memberships')
    .select('id, role')
    .eq('user_id', userId)
    .eq('org_id', business.org_id)
    .not('accepted_at', 'is', null)
    .limit(1)
    .maybeSingle();

  if (orgMembershipError || !orgMembershipData) {
    return { allowed: false, orgId: business.org_id };
  }

  const orgRole = normalizeMemberRole((orgMembershipData as OrgMembershipRow).role);
  const isOrgAdminRole = orgRole === 'owner' || orgRole === 'admin';

  if (!allowedRoles || allowedRoles.length === 0) {
    if (isOrgAdminRole) {
      return { allowed: true, orgId: business.org_id };
    }

    const { data: assignmentData, error: assignmentError } = await supabase
      .from('business_memberships')
      .select('business_id, role_override, is_active')
      .eq('user_id', userId)
      .eq('org_id', business.org_id)
      .eq('business_id', businessId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (assignmentError) {
      if (isMissingBusinessMembershipTable(assignmentError)) {
        return { allowed: true, orgId: business.org_id };
      }
      return { allowed: false, orgId: business.org_id };
    }

    return { allowed: Boolean(assignmentData), orgId: business.org_id };
  }

  const normalizedAllowedRoles = allowedRoles.map((role) => normalizeMemberRole(role));
  if (isOrgAdminRole && normalizedAllowedRoles.includes(orgRole)) {
    return { allowed: true, orgId: business.org_id };
  }

  const { data: assignmentData, error: assignmentError } = await supabase
    .from('business_memberships')
    .select('business_id, role_override, is_active')
    .eq('user_id', userId)
    .eq('org_id', business.org_id)
    .eq('business_id', businessId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (assignmentError) {
    if (isMissingBusinessMembershipTable(assignmentError)) {
      const fallbackAllowed = normalizedAllowedRoles.includes(orgRole);
      return { allowed: fallbackAllowed, orgId: business.org_id };
    }
    return { allowed: false, orgId: business.org_id };
  }

  const assignment = assignmentData as BusinessAssignmentRow | null;
  if (!assignment) {
    return { allowed: false, orgId: business.org_id };
  }

  const effectiveRole = normalizeMemberRole(assignment.role_override || orgRole);
  const hasMembership = normalizedAllowedRoles.includes(effectiveRole);

  return {
    allowed: hasMembership,
    orgId: business.org_id,
  };
}
