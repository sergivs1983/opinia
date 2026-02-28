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

type BusinessMembershipContext = {
  allowed: boolean;
  orgId: string | null;
  role: MemberRole | null;
  normalizedRole: CanonicalMemberRole | null;
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

function normalizeRawMemberRole(role: string | null | undefined): MemberRole {
  const normalized = (role || '').trim().toLowerCase();
  if (normalized === 'owner') return 'owner';
  if (normalized === 'admin') return 'admin';
  if (normalized === 'manager') return 'manager';
  if (normalized === 'staff') return 'staff';
  return 'responder';
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
  const context = await getAcceptedBusinessMembershipContext({
    supabase,
    userId,
    businessId,
    allowedRoles,
  });

  return {
    allowed: context.allowed,
    orgId: context.orgId,
  };
}

export async function getAcceptedBusinessMembershipContext({
  supabase,
  userId,
  businessId,
  allowedRoles,
}: BusinessMembershipCheckInput): Promise<BusinessMembershipContext> {
  const { data: businessData, error: businessError } = await supabase
    .from('businesses')
    .select('id, org_id')
    .eq('id', businessId)
    .single();

  if (businessError || !businessData) {
    return { allowed: false, orgId: null, role: null, normalizedRole: null };
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
    return { allowed: false, orgId: business.org_id, role: null, normalizedRole: null };
  }

  const orgMembership = orgMembershipData as OrgMembershipRow;
  const orgRoleRaw = normalizeRawMemberRole(orgMembership.role);
  const orgRole = normalizeMemberRole(orgRoleRaw);
  const isOrgAdminRole = orgRoleRaw === 'owner' || orgRoleRaw === 'admin';

  if (!allowedRoles || allowedRoles.length === 0) {
    if (isOrgAdminRole) {
      return {
        allowed: true,
        orgId: business.org_id,
        role: orgRoleRaw,
        normalizedRole: orgRole,
      };
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
        return {
          allowed: true,
          orgId: business.org_id,
          role: orgRoleRaw,
          normalizedRole: orgRole,
        };
      }
      return { allowed: false, orgId: business.org_id, role: null, normalizedRole: null };
    }

    const assignment = assignmentData as BusinessAssignmentRow | null;
    if (!assignment) {
      return { allowed: false, orgId: business.org_id, role: null, normalizedRole: null };
    }

    const roleOverrideRaw = assignment.role_override ? normalizeRawMemberRole(assignment.role_override) : null;
    const effectiveRoleRaw = roleOverrideRaw || orgRoleRaw;
    const effectiveRole = normalizeMemberRole(effectiveRoleRaw);

    return {
      allowed: true,
      orgId: business.org_id,
      role: effectiveRoleRaw,
      normalizedRole: effectiveRole,
    };
  }

  const normalizedAllowedRoles = allowedRoles.map((role) => normalizeMemberRole(role));
  if (isOrgAdminRole && normalizedAllowedRoles.includes(orgRole)) {
    return {
      allowed: true,
      orgId: business.org_id,
      role: orgRoleRaw,
      normalizedRole: orgRole,
    };
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
      return {
        allowed: fallbackAllowed,
        orgId: business.org_id,
        role: fallbackAllowed ? orgRoleRaw : null,
        normalizedRole: fallbackAllowed ? orgRole : null,
      };
    }
    return { allowed: false, orgId: business.org_id, role: null, normalizedRole: null };
  }

  const assignment = assignmentData as BusinessAssignmentRow | null;
  if (!assignment) {
    return { allowed: false, orgId: business.org_id, role: null, normalizedRole: null };
  }

  const roleOverrideRaw = assignment.role_override ? normalizeRawMemberRole(assignment.role_override) : null;
  const effectiveRoleRaw = roleOverrideRaw || orgRoleRaw;
  const effectiveRole = normalizeMemberRole(effectiveRoleRaw);
  const hasMembership = normalizedAllowedRoles.includes(effectiveRole);

  return {
    allowed: hasMembership,
    orgId: business.org_id,
    role: hasMembership ? effectiveRoleRaw : null,
    normalizedRole: hasMembership ? effectiveRole : null,
  };
}
