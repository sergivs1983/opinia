'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Toggle from '@/components/ui/Toggle';
import { useT } from '@/components/i18n/I18nContext';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTeamMembers, type TeamMember } from '@/hooks/useTeamMembers';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';
import { businessLimitForPlan } from '@/lib/seats';
import { normalizeMemberRole, roleCanAccessAdmin } from '@/lib/roles';

type AdminTab = 'team' | 'businesses' | 'plan';

type AssignmentRow = {
  id: string;
  org_id: string;
  business_id: string;
  user_id: string;
  role_override: string | null;
  is_active: boolean;
};

type AdminBusiness = {
  id: string;
  org_id: string;
  name: string;
  slug: string | null;
  type: string;
  city: string | null;
  url: string | null;
  is_active: boolean;
  sort_order: number;
};

type DragState = {
  draggingId: string | null;
  overId: string | null;
};

const ROLE_OPTIONS = [
  { value: 'owner', labelKey: 'settings.humanized.team.roles.owner' },
  { value: 'admin', labelKey: 'settings.humanized.team.roles.admin' },
  { value: 'manager', labelKey: 'settings.humanized.team.roles.manager' },
  { value: 'responder', labelKey: 'settings.humanized.team.roles.responder' },
] as const;

function reorderBusinesses(list: AdminBusiness[], draggedId: string, targetId: string): AdminBusiness[] {
  if (draggedId === targetId) return list;
  const current = [...list];
  const from = current.findIndex((item) => item.id === draggedId);
  const to = current.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0) return list;

  const [moved] = current.splice(from, 1);
  current.splice(to, 0, moved);
  return current.map((item, index) => ({ ...item, sort_order: index }));
}

export default function DashboardAdminPage() {
  const t = useT();
  const { toast } = useToast();
  const { org, membership } = useWorkspace();
  const canAccessAdmin = roleCanAccessAdmin(membership?.role);
  const normalizedRole = normalizeMemberRole(membership?.role);
  const isOwner = normalizedRole === 'owner';

  const [tab, setTab] = useState<AdminTab>('team');
  const [assignmentsByUser, setAssignmentsByUser] = useState<Record<string, string[]>>({});
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [savingAssignmentsUserId, setSavingAssignmentsUserId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState>({ draggingId: null, overId: null });

  const [businesses, setBusinesses] = useState<AdminBusiness[]>([]);
  const [businessesLoading, setBusinessesLoading] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [updatingBusinessId, setUpdatingBusinessId] = useState<string | null>(null);
  const [creatingBusiness, setCreatingBusiness] = useState(false);
  const [newBusinessName, setNewBusinessName] = useState('');
  const [newBusinessType, setNewBusinessType] = useState('other');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('responder');
  const [inviting, setInviting] = useState(false);
  const [updatingRoleMembershipId, setUpdatingRoleMembershipId] = useState<string | null>(null);
  const [removingMembershipId, setRemovingMembershipId] = useState<string | null>(null);

  const [updatingPlan, setUpdatingPlan] = useState(false);
  const [targetPlanCode, setTargetPlanCode] = useState<'starter_49' | 'pro_149'>('starter_49');

  const { members, seats, loading: teamLoading, refetch: refetchTeam } = useTeamMembers(org?.id);
  const acceptedMembers = useMemo(() => members.filter((member) => member.accepted_at), [members]);
  const pendingMembers = useMemo(() => members.filter((member) => !member.accepted_at), [members]);
  const planCode = seats?.plan_code === 'pro_149' ? 'pro_149' : 'starter_49';
  const seatsUsed = seats?.seats_used ?? members.length;
  const seatsLimit = seats?.seats_limit ?? (planCode === 'pro_149' ? 6 : 2);
  const seatsFull = seatsUsed >= seatsLimit;
  const seatsPercent = Math.max(0, Math.min(100, Math.round((seatsUsed / Math.max(1, seatsLimit)) * 100)));
  const businessesUsed = seats?.businesses_used ?? businesses.length;
  const businessesLimit = seats?.business_limit ?? businessLimitForPlan(planCode);
  const businessesFull = businessesUsed >= businessesLimit;
  const businessesPercent = Math.max(0, Math.min(100, Math.round((businessesUsed / Math.max(1, businessesLimit)) * 100)));
  const canAssignAdminRole = planCode === 'pro_149';

  useEffect(() => {
    if (!seats?.plan_code) return;
    if (seats.plan_code === 'pro_149') {
      setTargetPlanCode('pro_149');
    } else {
      setTargetPlanCode('starter_49');
    }
  }, [seats?.plan_code]);

  useEffect(() => {
    if (!canAssignAdminRole && inviteRole === 'admin') {
      setInviteRole('manager');
    }
  }, [canAssignAdminRole, inviteRole]);

  const loadAssignments = useCallback(async () => {
    if (!org?.id || !canAccessAdmin) return;
    setAssignmentsLoading(true);
    try {
      const response = await fetch(`/api/admin/business-memberships?org_id=${org.id}`);
      const payload = (await response.json().catch(() => ({}))) as { assignments?: AssignmentRow[]; message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message || payload.error || 'assignments_error');

      const nextMap: Record<string, string[]> = {};
      for (const row of payload.assignments || []) {
        if (!row.is_active) continue;
        if (!nextMap[row.user_id]) nextMap[row.user_id] = [];
        nextMap[row.user_id].push(row.business_id);
      }
      setAssignmentsByUser(nextMap);
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : t('common.error'), 'warning');
    } finally {
      setAssignmentsLoading(false);
    }
  }, [canAccessAdmin, org?.id, t, toast]);

  const loadBusinesses = useCallback(async () => {
    if (!org?.id || !canAccessAdmin) return;
    setBusinessesLoading(true);
    try {
      const response = await fetch(`/api/admin/businesses?org_id=${org.id}`);
      const payload = (await response.json().catch(() => ({}))) as { businesses?: AdminBusiness[]; message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message || payload.error || 'businesses_error');
      const rows = (payload.businesses || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setBusinesses(rows);
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : t('common.error'), 'warning');
    } finally {
      setBusinessesLoading(false);
    }
  }, [canAccessAdmin, org?.id, t, toast]);

  useEffect(() => {
    if (!canAccessAdmin) return;
    void loadAssignments();
    void loadBusinesses();
  }, [canAccessAdmin, loadAssignments, loadBusinesses]);

  const businessTypeOptions = useMemo(() => [
    { value: 'restaurant', label: t('settings.humanized.adn.businessTypes.restaurant') },
    { value: 'hotel', label: t('settings.humanized.adn.businessTypes.hotel') },
    { value: 'shop', label: t('settings.humanized.adn.businessTypes.retail') },
    { value: 'service', label: t('settings.humanized.adn.businessTypes.service') },
    { value: 'other', label: t('common.other') },
  ], [t]);

  const roleOptions = useMemo(() => ROLE_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  })), [t]);
  const assignableRoleOptions = useMemo(() => {
    if (canAssignAdminRole) return roleOptions;
    return roleOptions.filter((option) => option.value !== 'admin');
  }, [canAssignAdminRole, roleOptions]);

  const roleLabel = useCallback((role: string) => {
    const mapped = roleOptions.find((option) => option.value === normalizeMemberRole(role));
    return mapped?.label || role;
  }, [roleOptions]);

  const setMemberAssignments = useCallback((memberUserId: string, businessId: string, checked: boolean) => {
    setAssignmentsByUser((prev) => {
      const current = new Set(prev[memberUserId] || []);
      if (checked) current.add(businessId);
      else current.delete(businessId);
      return { ...prev, [memberUserId]: Array.from(current) };
    });
  }, []);

  const persistMemberAssignments = useCallback(async (member: TeamMember) => {
    if (!org?.id) return;
    setSavingAssignmentsUserId(member.user_id);
    try {
      const businessIds = assignmentsByUser[member.user_id] || [];
      const response = await fetch('/api/admin/business-memberships', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: org.id,
          membership_id: member.id,
          business_ids: businessIds,
          role_override: normalizeMemberRole(member.role),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message || payload.error || 'assignments_save_error');
      toast(t('admin.team.assignmentsSaved'), 'success');
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : t('common.error'), 'warning');
    } finally {
      setSavingAssignmentsUserId(null);
    }
  }, [assignmentsByUser, org?.id, t, toast]);

  const handleInvite = useCallback(async () => {
    if (!org?.id) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email.includes('@')) {
      toast(t('settings.humanized.team.invalidEmail'), 'warning');
      return;
    }

    if (seatsFull) {
      toast(t('settings.humanized.team.limitReached'), 'warning');
      return;
    }

    setInviting(true);
    try {
      const response = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: org.id,
          email,
          role: inviteRole,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || 'invite_error');
      setInviteEmail('');
      await refetchTeam();
      await loadAssignments();
      toast(t('settings.humanized.team.inviteQueued'), 'success');
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : t('settings.humanized.team.inviteError'), 'warning');
    } finally {
      setInviting(false);
    }
  }, [inviteEmail, inviteRole, loadAssignments, org?.id, refetchTeam, seatsFull, t, toast]);

  const handleRoleUpdate = useCallback(async (member: TeamMember, nextRole: string) => {
    setUpdatingRoleMembershipId(member.id);
    try {
      const response = await fetch('/api/team/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membership_id: member.id, role: nextRole }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || 'role_error');
      await refetchTeam();
      toast(t('admin.team.roleUpdated'), 'success');
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : t('common.error'), 'warning');
    } finally {
      setUpdatingRoleMembershipId(null);
    }
  }, [refetchTeam, t, toast]);

  const handleRemoveMember = useCallback(async (member: TeamMember) => {
    setRemovingMembershipId(member.id);
    try {
      const response = await fetch(`/api/team/member?id=${member.id}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || 'remove_error');
      await refetchTeam();
      await loadAssignments();
      toast(t('admin.team.memberRemoved'), 'success');
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : t('common.error'), 'warning');
    } finally {
      setRemovingMembershipId(null);
    }
  }, [loadAssignments, refetchTeam, t, toast]);

  const persistBusinessOrder = useCallback(async (nextBusinesses: AdminBusiness[]) => {
    if (!org?.id) return;
    setSavingOrder(true);
    try {
      const response = await fetch('/api/admin/businesses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: org.id,
          items: nextBusinesses.map((business, index) => ({
            id: business.id,
            sort_order: index,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((payload as { message?: string; error?: string }).message || (payload as { error?: string }).error || 'order_error');
      toast(t('admin.businesses.orderSaved'), 'success');
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : t('common.error'), 'warning');
      await loadBusinesses();
    } finally {
      setSavingOrder(false);
    }
  }, [loadBusinesses, org?.id, t, toast]);

  const updateBusinessState = useCallback(async (businessId: string, payload: Partial<Pick<AdminBusiness, 'is_active' | 'name'>>) => {
    if (!org?.id) return;
    setUpdatingBusinessId(businessId);
    try {
      const response = await fetch('/api/admin/businesses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: org.id,
          business_id: businessId,
          ...payload,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { business?: AdminBusiness; message?: string; error?: string };
      if (!response.ok) throw new Error(data.message || data.error || 'business_update_error');
      if (data.business) {
        setBusinesses((previous) => previous.map((row) => (row.id === data.business?.id ? data.business : row)));
      }
      toast(t('admin.businesses.businessUpdated'), 'success');
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : t('common.error'), 'warning');
    } finally {
      setUpdatingBusinessId(null);
    }
  }, [org?.id, t, toast]);

  const handleCreateBusiness = useCallback(async () => {
    if (!org?.id) return;
    const trimmedName = newBusinessName.trim();
    if (!trimmedName) {
      toast(t('admin.businesses.nameRequired'), 'warning');
      return;
    }
    setCreatingBusiness(true);
    try {
      const response = await fetch('/api/admin/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: org.id,
          name: trimmedName,
          type: newBusinessType,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { business?: AdminBusiness; message?: string; error?: string };
      if (!response.ok) throw new Error(data.message || data.error || 'create_business_error');
      setNewBusinessName('');
      await loadBusinesses();
      toast(t('admin.businesses.businessCreated'), 'success');
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : t('common.error'), 'warning');
    } finally {
      setCreatingBusiness(false);
    }
  }, [loadBusinesses, newBusinessName, newBusinessType, org?.id, t, toast]);

  const handlePlanUpdate = useCallback(async () => {
    if (!org?.id || !isOwner) return;
    setUpdatingPlan(true);
    try {
      const response = await fetch(`/api/orgs/${org.id}/set-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_code: targetPlanCode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const data = payload as { message?: string; error?: string };
        throw new Error(data.message || data.error || 'plan_update_error');
      }
      await refetchTeam();
      toast(t('admin.plan.updated'), 'success');
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : t('common.error'), 'warning');
    } finally {
      setUpdatingPlan(false);
    }
  }, [isOwner, org?.id, refetchTeam, t, targetPlanCode, toast]);

  if (!org) {
    return <div className={cn('p-6', textSub)}>{t('common.loading')}</div>;
  }

  if (!canAccessAdmin) {
    return (
      <GlassCard variant="strong" className="space-y-4 p-6">
        <h1 className={cn('text-2xl font-semibold', textMain)}>{t('admin.title')}</h1>
        <p className={cn('text-sm', textSub)}>{t('admin.forbidden')}</p>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className={cn('text-2xl font-semibold md:text-3xl', textMain)}>{t('admin.title')}</h1>
        <p className={cn('text-sm md:text-base', textSub)}>{t('admin.subtitle')}</p>
      </header>

      <GlassCard variant="strong" className="space-y-4 p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className={cn('text-sm font-medium', textMain)}>
              {t('admin.seatsCounter', { used: seatsUsed, limit: seatsLimit })}
            </p>
            <p className={cn('text-sm font-medium', textMain)}>
              {t('admin.businessesCounter', { used: businessesUsed, limit: businessesLimit })}
            </p>
          </div>
          <span className="rounded-full border border-emerald-300/35 bg-emerald-400/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-emerald-200">
            {planCode === 'pro_149' ? t('admin.plan.pro') : t('admin.plan.starter')}
          </span>
        </div>
        <div className="h-2 rounded-full bg-white/10">
          <div
            className={cn(
              'h-2 rounded-full transition-all duration-[220ms] ease-premium',
              seatsFull ? 'bg-amber-300/80' : 'bg-brand-accent/80',
            )}
            style={{ width: `${seatsPercent}%` }}
          />
        </div>
        <div className="h-2 rounded-full bg-white/10">
          <div
            className={cn(
              'h-2 rounded-full transition-all duration-[220ms] ease-premium',
              businessesFull ? 'bg-amber-300/80' : 'bg-brand-accent/80',
            )}
            style={{ width: `${businessesPercent}%` }}
          />
        </div>
      </GlassCard>

      <div className="flex flex-wrap gap-2">
        {(['team', 'businesses', 'plan'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTab(entry)}
            className={cn(
              'rounded-full border px-4 py-2 text-sm font-medium backdrop-blur-xl transition-all duration-[220ms] ease-premium',
              tab === entry
                ? 'border-brand-accent/35 bg-white/10 text-white shadow-[0_0_18px_rgba(0,168,107,0.12)] ring-1 ring-brand-accent/20'
                : 'border-white/12 bg-white/5 text-white/70 hover:bg-white/8 hover:text-white',
            )}
          >
            {entry === 'team' ? t('admin.tabs.team') : entry === 'businesses' ? t('admin.tabs.businesses') : t('admin.tabs.plan')}
          </button>
        ))}
      </div>

      {tab === 'team' && (
        <div className="space-y-4">
          <GlassCard variant="glass" className="space-y-4 p-5">
            <h2 className={cn('text-lg font-semibold', textMain)}>{t('admin.team.inviteTitle')}</h2>
            <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <Input
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                label={t('settings.humanized.team.email')}
                placeholder={t('settings.humanized.team.emailPlaceholder')}
              />
              <Select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value)}
                label={t('settings.humanized.team.role')}
                options={assignableRoleOptions.filter((option) => option.value !== 'owner')}
              />
              <div className="flex items-end">
                <Button
                  type="button"
                  onClick={handleInvite}
                  loading={inviting}
                  disabled={seatsFull}
                  title={seatsFull ? t('settings.humanized.team.limitTooltip') : undefined}
                  className="w-full md:w-auto"
                >
                  {t('settings.humanized.team.inviteCta')}
                </Button>
              </div>
            </div>
          </GlassCard>

          <GlassCard variant="glass" className="space-y-4 p-5">
            <h2 className={cn('text-lg font-semibold', textMain)}>{t('admin.team.membersTitle')}</h2>
            {teamLoading || assignmentsLoading ? (
              <p className={cn('text-sm', textSub)}>{t('common.loading')}</p>
            ) : (
              <div className="space-y-3">
                {acceptedMembers.map((member) => {
                  const assignedBusinessIds = assignmentsByUser[member.user_id] || [];
                  return (
                    <article key={member.id} className="rounded-xl border border-white/12 bg-white/6 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className={cn('text-sm font-semibold', textMain)}>
                            {member.full_name || member.invited_email || t('common.unknown')}
                          </p>
                          <p className={cn('text-xs', textSub)}>{member.invited_email || '—'}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Select
                            value={normalizeMemberRole(member.role)}
                            onChange={(event) => void handleRoleUpdate(member, event.target.value)}
                            options={assignableRoleOptions}
                            className="min-w-[170px]"
                            disabled={updatingRoleMembershipId === member.id}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            className="text-rose-300 hover:text-rose-200"
                            onClick={() => void handleRemoveMember(member)}
                            loading={removingMembershipId === member.id}
                            disabled={normalizeMemberRole(member.role) === 'owner' && acceptedMembers.filter((entry) => normalizeMemberRole(entry.role) === 'owner').length <= 1}
                          >
                            {t('settings.team.remove')}
                          </Button>
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        <p className={cn('text-xs uppercase tracking-[0.08em]', textSub)}>{t('admin.team.businessAssignments')}</p>
                        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                          {businesses.map((business) => {
                            const checked = assignedBusinessIds.includes(business.id);
                            return (
                              <label
                                key={`${member.id}-${business.id}`}
                                className={cn(
                                  'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all duration-[220ms] ease-premium',
                                  checked
                                    ? 'border-emerald-300/35 bg-emerald-400/15 text-emerald-200'
                                    : 'border-white/12 bg-white/5 text-white/80 hover:bg-white/10',
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) => setMemberAssignments(member.user_id, business.id, event.target.checked)}
                                  className="h-4 w-4 accent-emerald-400"
                                />
                                <span className="truncate">{business.name}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div className="pt-1">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void persistMemberAssignments(member)}
                            loading={savingAssignmentsUserId === member.user_id}
                          >
                            {t('admin.team.saveAssignments')}
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </GlassCard>

          {pendingMembers.length > 0 && (
            <GlassCard variant="glass" className="space-y-3 p-5">
              <h2 className={cn('text-lg font-semibold', textMain)}>{t('admin.team.pendingTitle')}</h2>
              <div className="space-y-2">
                {pendingMembers.map((member) => (
                  <div key={member.id} className="flex items-center justify-between rounded-lg border border-amber-300/25 bg-amber-400/12 px-3 py-2">
                    <span className={cn('text-sm', textMain)}>{member.invited_email}</span>
                    <span className="text-xs text-amber-200">{roleLabel(member.role)}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>
      )}

      {tab === 'businesses' && (
        <div className="space-y-4">
          <GlassCard variant="glass" className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className={cn('text-lg font-semibold', textMain)}>{t('admin.businesses.createTitle')}</h2>
              <span className={cn('text-xs', textSub)}>
                {t('admin.businesses.counter', { used: businessesUsed, limit: businessesLimit })}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <Input
                value={newBusinessName}
                onChange={(event) => setNewBusinessName(event.target.value)}
                label={t('admin.businesses.nameLabel')}
                placeholder={t('admin.businesses.namePlaceholder')}
                disabled={businessesFull}
              />
              <Select
                value={newBusinessType}
                onChange={(event) => setNewBusinessType(event.target.value)}
                label={t('admin.businesses.typeLabel')}
                options={businessTypeOptions}
                disabled={businessesFull}
              />
              <div className="flex items-end">
                <Button
                  type="button"
                  onClick={() => void handleCreateBusiness()}
                  loading={creatingBusiness}
                  disabled={businessesFull}
                  title={businessesFull ? t('admin.businesses.limitTooltip') : undefined}
                >
                  {t('admin.businesses.createCta')}
                </Button>
              </div>
            </div>
            {businessesFull && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2">
                <p className={cn('text-xs', textSub)}>{t('admin.businesses.limitReached')}</p>
                <Link href="/pricing" className="text-xs font-semibold text-emerald-300 hover:text-emerald-200">
                  {t('settings.humanized.team.upgradePlan')}
                </Link>
              </div>
            )}
          </GlassCard>

          <GlassCard variant="glass" className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className={cn('text-lg font-semibold', textMain)}>{t('admin.businesses.listTitle')}</h2>
              {savingOrder && <span className={cn('text-xs', textSub)}>{t('admin.businesses.savingOrder')}</span>}
            </div>
            {businessesLoading ? (
              <p className={cn('text-sm', textSub)}>{t('common.loading')}</p>
            ) : (
              <div className="space-y-2">
                {businesses.map((business) => (
                  <article
                    key={business.id}
                    draggable
                    onDragStart={() => setDragState({ draggingId: business.id, overId: business.id })}
                    onDragEnter={() => setDragState((prev) => ({ ...prev, overId: business.id }))}
                    onDragOver={(event) => event.preventDefault()}
                    onDragEnd={() => setDragState({ draggingId: null, overId: null })}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!dragState.draggingId) return;
                      const next = reorderBusinesses(businesses, dragState.draggingId, business.id);
                      setBusinesses(next);
                      void persistBusinessOrder(next);
                      setDragState({ draggingId: null, overId: null });
                    }}
                    className={cn(
                      'flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 transition-all duration-[220ms] ease-premium',
                      dragState.overId === business.id ? 'border-brand-accent/35 bg-white/10' : 'border-white/12 bg-white/5',
                    )}
                  >
                    <span className="cursor-grab text-white/50">⋮⋮</span>
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-sm font-semibold', textMain)}>{business.name}</p>
                      <p className={cn('truncate text-xs uppercase tracking-[0.08em]', textSub)}>{business.type}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn('text-xs', textSub)}>{business.is_active ? t('admin.businesses.visible') : t('admin.businesses.hidden')}</span>
                      <Toggle
                        checked={business.is_active}
                        onChange={(checked) => void updateBusinessState(business.id, { is_active: checked })}
                        disabled={updatingBusinessId === business.id}
                      />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {tab === 'plan' && (
        <GlassCard variant="glass" className="space-y-5 p-5">
          <h2 className={cn('text-lg font-semibold', textMain)}>{t('admin.plan.title')}</h2>
          <p className={cn('text-sm', textSub)}>{t('admin.plan.subtitle')}</p>

          <div className="grid gap-3 md:grid-cols-2">
            <label className={cn('rounded-xl border p-4 transition-all duration-[220ms] ease-premium', targetPlanCode === 'starter_49' ? 'border-brand-accent/35 bg-white/10' : 'border-white/12 bg-white/5')}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className={cn('text-sm font-semibold', textMain)}>{t('admin.plan.starter')}</p>
                  <p className={cn('text-xs', textSub)}>{t('admin.plan.starterSeats')}</p>
                </div>
                <input
                  type="radio"
                  name="plan_code"
                  value="starter_49"
                  checked={targetPlanCode === 'starter_49'}
                  onChange={() => setTargetPlanCode('starter_49')}
                  className="h-4 w-4 accent-emerald-400"
                />
              </div>
            </label>

            <label className={cn('rounded-xl border p-4 transition-all duration-[220ms] ease-premium', targetPlanCode === 'pro_149' ? 'border-brand-accent/35 bg-white/10' : 'border-white/12 bg-white/5')}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className={cn('text-sm font-semibold', textMain)}>{t('admin.plan.pro')}</p>
                  <p className={cn('text-xs', textSub)}>{t('admin.plan.proSeats')}</p>
                </div>
                <input
                  type="radio"
                  name="plan_code"
                  value="pro_149"
                  checked={targetPlanCode === 'pro_149'}
                  onChange={() => setTargetPlanCode('pro_149')}
                  className="h-4 w-4 accent-emerald-400"
                />
              </div>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void handlePlanUpdate()} loading={updatingPlan} disabled={!isOwner}>
              {t('admin.plan.updateCta')}
            </Button>
            {!isOwner && <span className={cn('text-xs', textSub)}>{t('admin.plan.ownerOnly')}</span>}
            <Link href="/pricing" className="text-sm text-emerald-300 hover:text-emerald-200 underline underline-offset-2">
              {t('settings.humanized.team.upgradePlan')}
            </Link>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
