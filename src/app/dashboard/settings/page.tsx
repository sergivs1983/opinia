'use client';

export const dynamic = 'force-dynamic';


import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import Divider from '@/components/ui/Divider';
import GlassCard from '@/components/ui/GlassCard';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import TagInput from '@/components/ui/TagInput';
import Toggle from '@/components/ui/Toggle';
import IntegrationsPlaceholder from '@/components/settings/IntegrationsPlaceholder';
import { useT } from '@/components/i18n/I18nContext';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { cn } from '@/lib/utils';
import { textMain, textMuted, textSub } from '@/components/ui/glass';
import { normalizeMemberRole, roleCanManageTeam } from '@/lib/roles';
import { businessLimitForPlan, seatLimitForPlan } from '@/lib/seats';

type SettingsTab = 'adn' | 'personality' | 'autopilot' | 'team';
type Tone = 'professional' | 'friendly' | 'fun';

function getRoleLabel(role: string | undefined, t: (key: string) => string): string {
  if (role === 'owner') return t('settings.humanized.team.roles.owner');
  if (role === 'manager') return t('settings.humanized.team.roles.manager');
  return t('settings.humanized.team.roles.staff');
}

export default function SettingsPage() {
  const t = useT();
  const { biz, org, membership, businesses } = useWorkspace();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<SettingsTab>('adn');
  const [saving, setSaving] = useState(false);
  const [savedIndicatorVisible, setSavedIndicatorVisible] = useState(false);
  const [oauthBanner, setOauthBanner] = useState<{ type: 'success' | 'warning'; message: string } | null>(null);

  const [businessType, setBusinessType] = useState('restaurant');
  const [topOffer, setTopOffer] = useState('');
  const [complaintPolicy, setComplaintPolicy] = useState('apologize');
  const [practicalData, setPracticalData] = useState('');

  const [tone, setTone] = useState<Tone>('friendly');
  const [signature, setSignature] = useState('');
  const [forbiddenWords, setForbiddenWords] = useState<string[]>([]);
  const [expertMode, setExpertMode] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');

  const [killSwitchRating, setKillSwitchRating] = useState('1_2');
  const [killSwitchAction, setKillSwitchAction] = useState('notify_no_reply');
  const [autoReplyRating, setAutoReplyRating] = useState('5');
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('staff');
  const [inviting, setInviting] = useState(false);

  const { members: teamMembers, seats: teamSeats, refetch: refetchTeam } = useTeamMembers(org?.id);

  const pendingInvites = useMemo(
    () => teamMembers.filter((member) => !member.accepted_at),
    [teamMembers],
  );

  const planCode = teamSeats?.plan_code === 'pro_149' ? 'pro_149' : 'starter_49';

  const seatsLimit = Math.max(1, teamSeats?.seats_limit ?? seatLimitForPlan(planCode));
  const seatsUsed = teamSeats?.seats_used ?? teamMembers.length;
  const seatsPercentage = Math.min(100, Math.round((seatsUsed / seatsLimit) * 100));
  const seatsFull = seatsUsed >= seatsLimit;

  const businessesLimit = Math.max(1, teamSeats?.business_limit ?? businessLimitForPlan(planCode));
  const businessesUsed = teamSeats?.businesses_used ?? businesses.length;
  const businessesPercentage = Math.min(100, Math.round((businessesUsed / businessesLimit) * 100));
  const businessesFull = businessesUsed >= businessesLimit;

  const canManageTeamTab = roleCanManageTeam(membership?.role);
  const canManageBusinesses = normalizeMemberRole(membership?.role) === 'owner';

  const tabs = useMemo(() => {
    const baseTabs = [
      { key: 'adn' as const, label: t('settings.humanized.tabs.adn'), testId: 'settings-tab-adn' },
      { key: 'personality' as const, label: t('settings.humanized.tabs.personality'), testId: 'settings-tab-voice' },
      { key: 'autopilot' as const, label: t('settings.humanized.tabs.autopilot'), testId: 'settings-tab-autopilot' },
    ];
    if (!canManageTeamTab) return baseTabs;
    return [...baseTabs, { key: 'team' as const, label: t('settings.humanized.tabs.team'), testId: 'settings-tab-integrations' }];
  }, [canManageTeamTab, t]);

  useEffect(() => {
    if (!canManageTeamTab && tab === 'team') setTab('adn');
  }, [canManageTeamTab, tab]);

  useEffect(() => {
    if (!canManageTeamTab) return;
    const queryTab = searchParams.get('tab');
    if (queryTab === 'integrations' && tab !== 'team') {
      setTab('team');
    }
  }, [canManageTeamTab, searchParams, tab]);

  useEffect(() => {
    const oauthState = searchParams.get('google_oauth');
    if (!oauthState) return;

    const requestId = searchParams.get('request_id');
    const isConnected = oauthState === 'connected';
    const message = isConnected
      ? t('settings.integrations.googleCallbackConnected')
      : t('settings.integrations.googleCallbackError');
    const withRequestId = requestId ? `${message} (${requestId})` : message;

    setOauthBanner({
      type: isConnected ? 'success' : 'warning',
      message: withRequestId,
    });
    toast(withRequestId, isConnected ? 'success' : 'warning');

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('google_oauth');
    nextParams.delete('message');
    nextParams.delete('request_id');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [pathname, router, searchParams, t, toast]);

  const toneOptions = useMemo(
    () => [
      {
        key: 'professional' as const,
        title: t('settings.humanized.personality.quickTones.formal'),
        subtitle: t('settings.humanized.personality.tones.professional.subtitle'),
      },
      {
        key: 'friendly' as const,
        title: t('settings.humanized.personality.quickTones.proper'),
        subtitle: t('settings.humanized.personality.tones.friendly.subtitle'),
      },
      {
        key: 'fun' as const,
        title: t('settings.humanized.personality.quickTones.fun'),
        subtitle: t('settings.humanized.personality.tones.fun.subtitle'),
      },
    ],
    [t],
  );

  const selectedToneDescription = useMemo(() => {
    return toneOptions.find((item) => item.key === tone)?.subtitle || '';
  }, [tone, toneOptions]);

  const handleInvite = useCallback(async () => {
    const orgId = org?.id;
    if (!orgId) {
      toast(t('settings.humanized.team.inviteError'), 'warning');
      return;
    }

    const trimmed = inviteEmail.trim().toLowerCase();
    if (!trimmed.includes('@')) {
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
          org_id: orgId,
          email: trimmed,
          role: inviteRole,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || t('settings.humanized.team.inviteError'));

      setInviteEmail('');
      await refetchTeam();
      toast(t('settings.humanized.team.inviteQueued'), 'success');
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : t('settings.humanized.team.inviteError'), 'warning');
    } finally {
      setInviting(false);
    }
  }, [inviteEmail, inviteRole, org?.id, refetchTeam, seatsFull, t, toast]);

  const handleSave = useCallback(async () => {
    setSaving(true);

    const payload = {
      businessId: biz?.id ?? null,
      businessMemory: { businessType, topOffer, complaintPolicy, practicalData },
      personality: { tone, signature, forbiddenWords, expertMode, customPrompt },
      autopilot: { killSwitchRating, killSwitchAction, autoReplyRating, autoReplyEnabled },
      teamIntegrations: { pendingInvites, webhookEnabled: true },
    };

    console.log('[settings-humanized] save (mock)', payload);
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    toast(t('settings.humanized.saveSuccess'), 'success');

    setSavedIndicatorVisible(true);
    window.setTimeout(() => setSavedIndicatorVisible(false), 1600);
    setSaving(false);
  }, [
    autoReplyEnabled,
    autoReplyRating,
    biz?.id,
    businessType,
    complaintPolicy,
    customPrompt,
    expertMode,
    forbiddenWords,
    killSwitchAction,
    killSwitchRating,
    pendingInvites,
    practicalData,
    signature,
    t,
    toast,
    tone,
    topOffer,
  ]);

  if (!biz) {
    return <div className={cn('p-8 text-center', textMuted)}>{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-6 pb-20" data-testid="settings-page">
      <header className={cn('space-y-1')}>
        <h1 className={cn('font-display text-2xl font-semibold md:text-3xl', textMain)}>{t('settings.humanized.title')}</h1>
        <p className={cn('text-sm md:text-base', textSub)}>{t('settings.humanized.subtitle')}</p>
      </header>

      {oauthBanner && (
        <GlassCard
          variant="glass"
          className={cn(
            'border px-4 py-3 text-sm',
            oauthBanner.type === 'success'
              ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-100'
              : 'border-amber-300/35 bg-amber-300/10 text-amber-100',
          )}
          data-testid="settings-google-oauth-banner"
        >
          {oauthBanner.message}
        </GlassCard>
      )}

      <div className="overflow-x-auto pb-1">
        <div className="inline-flex min-w-full border-b border-white/10 md:min-w-0">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={cn(
                'whitespace-nowrap border-b-2 border-transparent px-4 py-2.5 text-sm font-medium',
                'transition-colors duration-[220ms] ease-premium',
                tab === item.key ? 'border-emerald-500 text-white' : 'text-zinc-500 hover:text-zinc-300',
              )}
              data-testid={item.testId}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'adn' && (
        <GlassCard variant="strong" className="space-y-6 rounded-2xl border border-white/5 bg-zinc-900/50 p-6 md:p-8">
          <header className="space-y-1">
            <h2 className={cn('text-lg font-semibold', textMain)}>{t('settings.humanized.adn.title')}</h2>
            <p className={cn('text-sm', textSub)}>{t('settings.humanized.adn.subtitle')}</p>
            <p className={cn('text-sm', textSub)}>{t('settings.humanized.adn.helper')}</p>
          </header>

          <div className="grid gap-4 md:grid-cols-2">
            <Select
              value={businessType}
              onChange={(event) => setBusinessType(event.target.value)}
              label={t('settings.humanized.adn.businessType')}
              options={[
                { value: 'restaurant', label: t('settings.humanized.adn.businessTypes.restaurant') },
                { value: 'hotel', label: t('settings.humanized.adn.businessTypes.hotel') },
                { value: 'retail', label: t('settings.humanized.adn.businessTypes.retail') },
                { value: 'service', label: t('settings.humanized.adn.businessTypes.service') },
              ]}
            />
            <Input
              value={topOffer}
              onChange={(event) => setTopOffer(event.target.value)}
              label={t('settings.humanized.adn.topOffer')}
              placeholder={t('settings.humanized.adn.topOfferPlaceholder')}
            />
          </div>

          <Select
            value={complaintPolicy}
            onChange={(event) => setComplaintPolicy(event.target.value)}
            label={t('settings.humanized.adn.complaintPolicy')}
            options={[
              { value: 'apologize', label: t('settings.humanized.adn.complaintOptions.apologize') },
              { value: 'private_contact', label: t('settings.humanized.adn.complaintOptions.privateContact') },
              { value: 'invite_back', label: t('settings.humanized.adn.complaintOptions.inviteBack') },
            ]}
          />

          <div className="space-y-1.5">
            <label className={cn('block text-sm font-medium', textSub)}>{t('settings.humanized.adn.practicalData')}</label>
            <textarea
              value={practicalData}
              onChange={(event) => setPracticalData(event.target.value)}
              placeholder={t('settings.humanized.adn.practicalDataPlaceholder')}
              className={cn(
                'min-h-[120px] w-full rounded-xl border border-white/10 bg-zinc-950/50 px-3.5 py-2.5 text-sm',
                'text-white placeholder:text-zinc-500',
                'transition-all duration-[220ms] ease-premium',
                'focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50',
              )}
            />
          </div>

          <Divider />
          <p className={cn('text-xs', textMuted)}>{t('settings.humanized.adn.footer')}</p>
        </GlassCard>
      )}

      {tab === 'personality' && (
        <GlassCard
          variant="strong"
          className="space-y-6 rounded-2xl border border-white/5 bg-zinc-900/50 p-6 md:p-8"
          data-testid="settings-voice-panel"
        >
          <header className="space-y-1">
            <h2 className={cn('text-lg font-semibold', textMain)}>{t('settings.humanized.personality.title')}</h2>
            <p className={cn('text-sm', textSub)}>{t('settings.humanized.personality.subtitle')}</p>
          </header>

          <section className="space-y-3">
            <h3 className={cn('text-sm font-semibold', textMain)}>{t('settings.humanized.personality.howToSound')}</h3>
            <div className="flex flex-wrap gap-2">
              {toneOptions.map((item) => {
                const isActive = tone === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTone(item.key)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm font-medium backdrop-blur-xl transition-all duration-[220ms] ease-premium',
                      isActive
                        ? 'border-emerald-500/50 bg-white/5 text-white ring-1 ring-emerald-500/20'
                        : 'border-white/10 bg-zinc-950/40 text-zinc-400 hover:bg-white/5 hover:text-zinc-200',
                    )}
                  >
                    {item.title}
                  </button>
                );
              })}
            </div>
            <p className={cn('text-xs', textMuted)}>{selectedToneDescription}</p>
          </section>

          <Input
            value={signature}
            onChange={(event) => setSignature(event.target.value)}
            label={t('settings.humanized.personality.signature')}
            placeholder={t('settings.humanized.personality.signaturePlaceholder')}
            data-testid="settings-signature"
          />

          <TagInput
            tags={forbiddenWords}
            onChange={setForbiddenWords}
            label={t('settings.humanized.personality.forbiddenWords')}
            placeholder={t('settings.humanized.personality.forbiddenWordsPlaceholder')}
          />

          <details className="rounded-xl border border-white/5 bg-zinc-950/40 p-3">
            <summary className={cn('cursor-pointer list-none text-sm font-semibold', textMain)}>
              {t('settings.humanized.personality.advancedOptions')}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-zinc-950/50 p-3">
                <div>
                  <p className={cn('text-sm font-semibold', textMain)}>{t('settings.humanized.personality.expertMode')}</p>
                  <p className={cn('text-xs', textMuted)}>{t('settings.humanized.personality.expertModeDesc')}</p>
                </div>
                <Toggle checked={expertMode} onChange={setExpertMode} />
              </div>

              {expertMode && (
                <div className="space-y-2 rounded-xl border border-amber-300/30 bg-amber-400/10 p-3">
                  <span className="inline-flex rounded-full border border-amber-300/40 bg-amber-300/15 px-2 py-0.5 text-xs text-amber-100">
                    {t('settings.humanized.personality.expertWarning')}
                  </span>
                  <label className={cn('block text-sm font-medium', textSub)}>{t('settings.humanized.personality.customPrompt')}</label>
                  <textarea
                    value={customPrompt}
                    onChange={(event) => setCustomPrompt(event.target.value)}
                    placeholder={t('settings.humanized.personality.customPromptPlaceholder')}
                    className={cn(
                      'min-h-[120px] w-full rounded-xl border border-white/10 bg-zinc-950/50 px-3.5 py-2.5 text-sm',
                      'text-white placeholder:text-zinc-500',
                      'transition-all duration-[220ms] ease-premium',
                      'focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50',
                    )}
                  />
                </div>
              )}
            </div>
          </details>
        </GlassCard>
      )}

      {tab === 'autopilot' && (
        <GlassCard variant="strong" className="space-y-6 rounded-2xl border border-white/5 bg-zinc-900/50 p-6 md:p-8">
          <header className="space-y-1">
            <h2 className={cn('text-lg font-semibold', textMain)}>{t('settings.humanized.autopilot.title')}</h2>
            <p className={cn('text-sm', textSub)}>{t('settings.humanized.autopilot.subtitle')}</p>
          </header>

          <div className="rounded-xl border border-white/5 bg-zinc-950/40 p-4">
            <p className={cn('mb-3 text-sm font-medium', textMain)}>{t('settings.humanized.autopilot.rule1Title')}</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                value={killSwitchRating}
                onChange={(event) => setKillSwitchRating(event.target.value)}
                label={t('settings.humanized.autopilot.rule1Stars')}
                options={[
                  { value: '1', label: t('settings.humanized.autopilot.ratingOptions.oneStar') },
                  { value: '1_2', label: t('settings.humanized.autopilot.ratingOptions.oneTwoStars') },
                  { value: '2', label: t('settings.humanized.autopilot.ratingOptions.twoStars') },
                ]}
              />
              <Select
                value={killSwitchAction}
                onChange={(event) => setKillSwitchAction(event.target.value)}
                label={t('settings.humanized.autopilot.rule1Action')}
                options={[
                  { value: 'notify_no_reply', label: t('settings.humanized.autopilot.actionOptions.notifyNoReply') },
                  { value: 'notify_prepare', label: t('settings.humanized.autopilot.actionOptions.notifyPrepare') },
                ]}
              />
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-zinc-950/40 p-4">
            <p className={cn('mb-3 text-sm font-medium', textMain)}>{t('settings.humanized.autopilot.rule2Title')}</p>
            <div className="space-y-3">
              <Select
                value={autoReplyRating}
                onChange={(event) => setAutoReplyRating(event.target.value)}
                label={t('settings.humanized.autopilot.rule2Stars')}
                options={[
                  { value: '5', label: t('settings.humanized.autopilot.ratingOptions.fiveStars') },
                  { value: '4_5', label: t('settings.humanized.autopilot.ratingOptions.fourFiveStars') },
                ]}
              />
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-zinc-950/50 p-3">
                <p className={cn('text-sm', textSub)}>{t('settings.humanized.autopilot.rule2Toggle')}</p>
                <Toggle checked={autoReplyEnabled} onChange={setAutoReplyEnabled} />
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {tab === 'team' && canManageTeamTab && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* IMPORTANT: només 1 GlassCard aquí (sense duplicats) */}
          <GlassCard variant="strong" className="space-y-4 rounded-2xl border border-white/5 bg-zinc-900/50 p-6 md:p-8">
            <header className="space-y-1">
              <h2 className={cn('text-lg font-semibold', textMain)}>{t('settings.humanized.team.title')}</h2>
              <p className={cn('text-sm', textSub)}>{t('settings.humanized.team.subtitle')}</p>
            </header>

            <div className="space-y-2 rounded-xl border border-white/10 bg-zinc-950/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className={cn('text-sm font-medium', textMain)}>
                  {t('settings.humanized.team.peopleCounter', { used: seatsUsed, limit: seatsLimit })}
                </span>
                <span className={cn('text-xs', textSub)}>{seatsPercentage}%</span>
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

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className={cn('text-sm font-medium', textMain)}>
                  {t('settings.humanized.team.businessCounter', { used: businessesUsed, limit: businessesLimit })}
                </span>
                <span className={cn('text-xs', textSub)}>{businessesPercentage}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-white/10">
                <div
                  className={cn(
                    'h-2 rounded-full transition-all duration-[220ms] ease-premium',
                    businessesFull ? 'bg-amber-300/80' : 'bg-brand-accent/80',
                  )}
                  style={{ width: `${businessesPercentage}%` }}
                />
              </div>

              {seatsFull && (
                <div className="flex items-center justify-between gap-2">
                  <p className={cn('text-xs', textMuted)}>{t('settings.humanized.team.limitReached')}</p>
                  <Link
                    href="/pricing"
                    className={cn('text-xs font-semibold text-emerald-400 transition-colors duration-[220ms] ease-premium hover:text-emerald-300')}
                  >
                    {t('settings.humanized.team.upgradePlan')}
                  </Link>
                </div>
              )}

              {businessesFull && (
                <div className="flex items-center justify-between gap-2">
                  <p className={cn('text-xs', textMuted)}>{t('settings.humanized.team.businessLimitReached')}</p>
                  <Link
                    href="/pricing"
                    className={cn('text-xs font-semibold text-emerald-400 transition-colors duration-[220ms] ease-premium hover:text-emerald-300')}
                  >
                    {t('settings.humanized.team.upgradePlan')}
                  </Link>
                </div>
              )}
            </div>

            <Input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              label={t('settings.humanized.team.email')}
              placeholder={t('settings.humanized.team.emailPlaceholder')}
              disabled={seatsFull}
            />

            <Select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value)}
              label={t('settings.humanized.team.role')}
              disabled={seatsFull}
              options={[
                { value: 'manager', label: t('settings.humanized.team.roles.manager') },
                { value: 'staff', label: t('settings.humanized.team.roles.staff') },
              ]}
            />

            <Button
              type="button"
              onClick={() => void handleInvite()}
              disabled={seatsFull}
              loading={inviting}
              title={seatsFull ? t('settings.humanized.team.limitTooltip') : undefined}
            >
              {t('settings.humanized.team.inviteCta')}
            </Button>

            <div className="space-y-2 rounded-xl border border-white/10 bg-zinc-950/50 p-3">
              <p className={cn('text-xs font-semibold uppercase tracking-wide', textMuted)}>
                {t('settings.humanized.team.currentMembers')}
              </p>
              <ul className="space-y-2">
                {teamMembers.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className={cn('truncate text-sm', textMain)}>{item.full_name || item.invited_email || t('common.unknown')}</p>
                      {item.invited_email && item.full_name && <p className={cn('truncate text-xs', textMuted)}>{item.invited_email}</p>}
                    </div>
                    <div className="ml-3 text-right">
                      <p className={cn('text-xs', textSub)}>
                        {getRoleLabel(item.role, t)}
                      </p>
                      <p className={cn('text-[11px]', textMuted)}>
                        {item.accepted_at ? t('settings.humanized.team.statusActive') : t('settings.humanized.team.statusPending')}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {pendingInvites.length > 0 && (
              <div className="space-y-2 rounded-xl border border-white/10 bg-zinc-950/50 p-3">
                <p className={cn('text-xs font-semibold uppercase tracking-wide', textMuted)}>
                  {t('settings.humanized.team.pendingInvites')}
                </p>
                <ul className="space-y-2">
                  {pendingInvites.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-3 py-2"
                    >
                      <span className={cn('text-sm', textMain)}>{item.invited_email || t('common.unknown')}</span>
                      <span className={cn('text-xs', textSub)}>
                        {getRoleLabel(item.role, t)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canManageBusinesses && (
              <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-3">
                <p className={cn('text-xs', textSub)}>{t('settings.humanized.team.manageBusinessesHint')}</p>
                <Link
                  href="/dashboard/admin"
                  className="mt-3 inline-flex rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-medium text-zinc-100 transition-all duration-[220ms] ease-premium hover:bg-white/5"
                >
                  {t('settings.humanized.team.manageBusinessesCta')}
                </Link>
              </div>
            )}
          </GlassCard>

          <GlassCard variant="strong" className="space-y-4 rounded-2xl border border-white/5 bg-zinc-900/50 p-6 md:p-8">
            <header className="space-y-1">
              <h2 className={cn('text-lg font-semibold', textMain)}>{t('settings.humanized.integrations.title')}</h2>
              <p className={cn('text-sm', textSub)}>{t('settings.humanized.integrations.subtitle')}</p>
            </header>
            <IntegrationsPlaceholder />
          </GlassCard>
        </div>
      )}

      <div className="fixed bottom-5 right-5 z-30 flex justify-end md:bottom-6 md:right-6">
        <GlassCard variant="glass" className="p-2">
          <Button onClick={() => void handleSave()} loading={saving} data-testid="settings-save">
            {t('settings.humanized.saveCta')}
          </Button>
          {savedIndicatorVisible && (
            <div className="mt-2 px-1 text-xs text-emerald-400" data-testid="settings-saved-indicator">
              {t('common.saved')}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
