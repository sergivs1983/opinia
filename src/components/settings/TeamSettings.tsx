'use client';

import { useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useT } from '@/components/i18n/I18nContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { glass, glassNoise, glassStrong, glassSweep, ringAccent } from '@/components/ui/glass';
import type { OrgProps } from './types';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { normalizeMemberRole, roleCanManageTeam } from '@/lib/roles';

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-amber-400/18 text-amber-300 border border-amber-300/35',
  admin: 'bg-violet-400/18 text-violet-200 border border-violet-300/30',
  manager: 'bg-sky-400/18 text-sky-300 border border-sky-300/35',
  responder: 'bg-white/10 text-white/72 border border-white/14',
  staff: 'bg-white/10 text-white/72 border border-white/14',
};

export default function TeamSettings({ org }: OrgProps) {
  const t = useT();
  const { membership } = useWorkspace();
  const { members, seats, loading, error, refetch } = useTeamMembers(org.id);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('responder');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('responder');

  const normalizedMembershipRole = normalizeMemberRole(membership?.role);
  const isOwner = normalizedMembershipRole === 'owner';
  const canManageTeam = roleCanManageTeam(normalizedMembershipRole);

  const roleLabel = (role: string) => t(`settings.team.roles.${role}`) || role;
  const seatsLimit = Math.max(1, seats?.seats_limit ?? 3);
  const seatsUsed = seats?.seats_used ?? members.length;
  const seatsPercentage = Math.min(100, Math.round((seatsUsed / seatsLimit) * 100));
  const seatsFull = seatsUsed >= seatsLimit;

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true); setInviteMsg(null);
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org.id, email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      setInviteEmail(''); setInviteMsg(`✅ ${t('common.success')}`);
      await refetch();
    } catch (e: unknown) { setInviteMsg('❌ ' + (e instanceof Error ? e.message : t('common.error'))); }
    setInviting(false);
  };

  const handleRoleChange = async (membershipId: string, newRole: string) => {
    try {
      const res = await fetch('/api/team/role', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membership_id: membershipId, role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      setEditingId(null); await refetch();
    } catch (e: unknown) { alert(e instanceof Error ? e.message : t('common.error')); }
  };

  const handleRemove = async (membershipId: string, name: string) => {
    if (!confirm(t('settings.team.removeConfirm'))) return;
    try {
      const res = await fetch(`/api/team/member?id=${membershipId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      await refetch();
    } catch (e: unknown) { alert(e instanceof Error ? e.message : t('common.error')); }
  };

  if (loading) return <div className="text-center py-8 text-white/70">{t('common.loading')}</div>;
  if (error) return <div className="text-center py-8 text-red-500">{t('common.error')}: {error}</div>;

  const accepted = members.filter(m => m.accepted_at);
  const pending = members.filter(m => !m.accepted_at);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className={cn(glassStrong, glassNoise, glassSweep, 'p-6')}>
        <div className="mb-4 space-y-2 rounded-xl border border-white/12 bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/90">{`Persones: ${seatsUsed}/${seatsLimit}`}</span>
            <span className="text-xs text-white/70">{seatsPercentage}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/10">
            <div
              className={cn(
                'h-2 rounded-full transition-all duration-[220ms] ease-premium',
                seatsFull ? 'bg-amber-300/80' : 'bg-brand-accent/80',
              )}
              style={{ width: `${seatsPercentage}%` }}
            />
          </div>
        </div>
        <h3 className="font-semibold text-white/90 mb-4">{t('settings.team.members')} ({accepted.length})</h3>
        <div className="space-y-3">
          {accepted.map(m => {
            const isSelf = m.user_id === membership?.user_id;
            return (
              <div key={m.id} className="flex items-center gap-3 py-2 px-3 rounded-xl transition-all duration-[220ms] ease-premium hover:bg-white/8 hover:border hover:border-brand-accent/20 hover:shadow-[0_0_16px_rgba(0,168,107,0.10)]">
                <div className="w-8 h-8 rounded-full bg-brand-primary/65 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {m.full_name?.charAt(0)?.toUpperCase() || m.invited_email?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white/90 truncate">
                    {m.full_name || m.invited_email || t('common.unknown')}
                    {isSelf && <span className="text-xs text-white/60 ml-1">(you)</span>}
                  </p>
                  {m.invited_email && m.full_name && <p className="text-xs text-white/60 truncate">{m.invited_email}</p>}
                </div>
                {editingId === m.id ? (
                  <div className="flex items-center gap-2">
                    <select value={editRole} onChange={e => setEditRole(e.target.value)} className={cn('rounded-lg border border-white/14 bg-white/8 px-2 py-1 text-xs text-white/90', ringAccent)}>
                      <option value="responder">{roleLabel('responder')}</option>
                      <option value="admin">{roleLabel('admin')}</option>
                      <option value="manager">{roleLabel('manager')}</option>
                      <option value="owner">{roleLabel('owner')}</option>
                    </select>
                    <button onClick={() => handleRoleChange(m.id, editRole)} className="text-xs text-emerald-300 hover:text-emerald-200 font-medium">{t('common.save')}</button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-white/60 hover:text-white/82">{t('common.cancel')}</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase', ROLE_COLORS[m.role] || ROLE_COLORS.responder)}>{roleLabel(m.role)}</span>
                    {isOwner && !isSelf && (
                      <>
                        <button onClick={() => { setEditingId(m.id); setEditRole(m.role); }} className="text-xs text-emerald-300 hover:text-emerald-200">{t('settings.team.inviteRole')}</button>
                        <button onClick={() => handleRemove(m.id, m.full_name || m.invited_email || '')} className="text-xs text-rose-300 transition-colors duration-[220ms] ease-premium hover:text-rose-200">{t('settings.team.remove')}</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {pending.length > 0 && (
        <div className={cn(glass, glassNoise, glassSweep, 'p-6')}>
          <h3 className="font-semibold text-white/90 mb-4">{t('settings.team.pending')} ({pending.length})</h3>
          <div className="space-y-2">
            {pending.map(m => (
              <div key={m.id} className="flex items-center gap-3 py-2 px-3 rounded-xl bg-amber-400/12 border border-amber-300/25 transition-all duration-[220ms] ease-premium hover:border-amber-300/35">
                <div className="w-8 h-8 rounded-full bg-amber-400/18 text-amber-300 flex items-center justify-center text-xs font-bold shrink-0">✉</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white/82 truncate">{m.invited_email}</p>
                </div>
                <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase', ROLE_COLORS[m.role] || ROLE_COLORS.responder)}>{roleLabel(m.role)}</span>
                {canManageTeam && (
                  <button onClick={() => handleRemove(m.id, m.invited_email || '')} className="text-xs text-rose-300 transition-colors duration-[220ms] ease-premium hover:text-rose-200">{t('common.cancel')}</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {canManageTeam && (
        <div className={cn(glass, glassNoise, glassSweep, 'p-6 space-y-4')}>
          <h3 className="font-semibold text-white/90">{t('settings.team.invite')}</h3>
          <div className="flex gap-3">
            <Input label={t('settings.team.inviteEmail')} type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              placeholder={t('settings.team.invitePlaceholder')} className="flex-1" disabled={seatsFull} />
            <div>
              <label className="text-sm font-medium text-white/80 block mb-1">{t('settings.team.inviteRole')}</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} disabled={seatsFull} className={cn('rounded-xl border border-white/14 bg-white/8 px-3 py-2.5 text-sm text-white/90 disabled:opacity-60', ringAccent)}>
                <option value="responder">{roleLabel('responder')}</option>
                <option value="admin">{roleLabel('admin')}</option>
                <option value="manager">{roleLabel('manager')}</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleInvite} loading={inviting} disabled={seatsFull} title={seatsFull ? 'Límit assolit. Puja de pla.' : undefined}>{t('settings.team.sendInvite')}</Button>
            {inviteMsg && <span className="text-sm">{inviteMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
