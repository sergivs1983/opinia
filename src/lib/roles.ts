import type { MemberRole } from '@/types/database';

export type CanonicalMemberRole = 'owner' | 'admin' | 'manager' | 'responder';

export const TEAM_MANAGEMENT_ROLES: CanonicalMemberRole[] = ['owner', 'admin'];
export const PUBLISH_ROLES: CanonicalMemberRole[] = ['owner', 'admin', 'manager'];

export function normalizeMemberRole(role: string | null | undefined): CanonicalMemberRole {
  const normalized = (role || '').trim().toLowerCase();
  if (normalized === 'owner') return 'owner';
  if (normalized === 'admin') return 'admin';
  if (normalized === 'manager') return 'manager';
  if (normalized === 'responder' || normalized === 'staff') return 'responder';
  return 'responder';
}

export function roleCanManageTeam(role: string | null | undefined): boolean {
  const normalized = normalizeMemberRole(role);
  return TEAM_MANAGEMENT_ROLES.includes(normalized);
}

export function roleCanManageBusinesses(role: string | null | undefined): boolean {
  const normalized = normalizeMemberRole(role);
  return normalized === 'owner' || normalized === 'admin';
}

export function roleCanManageIntegrations(role: string | null | undefined): boolean {
  return roleCanManageBusinesses(role);
}

export function roleCanPublish(role: string | null | undefined): boolean {
  const normalized = normalizeMemberRole(role);
  return PUBLISH_ROLES.includes(normalized);
}

export function roleCanAccessAdmin(role: string | null | undefined): boolean {
  const normalized = normalizeMemberRole(role);
  return normalized === 'owner' || normalized === 'admin';
}

export function asMembershipRoleFilter(roles: ReadonlyArray<CanonicalMemberRole>): MemberRole[] {
  return roles as MemberRole[];
}
