import type { MemberRole } from '@/types/database';

export type LitoMemberRole = 'owner' | 'manager' | 'staff';

export function toLitoMemberRole(role: MemberRole | string | null | undefined): LitoMemberRole | null {
  const normalized = (role || '').trim().toLowerCase();
  if (normalized === 'owner') return 'owner';
  if (normalized === 'manager') return 'manager';
  if (normalized === 'staff') return 'staff';
  return null;
}
