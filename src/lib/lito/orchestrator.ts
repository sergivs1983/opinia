import type { SupabaseClient } from '@supabase/supabase-js';

import { getOrgEntitlements, getSignalsLevel } from '@/lib/billing/entitlements';
import { getAllowedCardActions } from '@/lib/lito/rbac-ctas';
import {
  listSignalsForBusiness,
  pickTopSignals,
  toSignalCards,
  type SignalCard,
} from '@/lib/signals/pro';
import type {
  ActionCard,
  ActionCardCta,
  ActionCardCtaAction,
  ActionCardMode,
  ActionCardRef,
  ActionCardRole,
  ActionCardSeverity,
  ActionCardType,
} from '@/types/lito-cards';

type SocialScheduleStatus = 'scheduled' | 'notified' | 'published' | 'missed' | 'snoozed' | 'cancelled';

type SocialScheduleRow = {
  id: string;
  draft_id: string;
  platform: 'instagram' | 'tiktok';
  scheduled_at: string;
  status: SocialScheduleStatus;
  published_at: string | null;
};

type SocialDraftRow = {
  id: string;
  channel: 'instagram' | 'tiktok' | 'facebook';
  updated_at: string;
  created_at: string;
};

type TelemetryRow = {
  created_at: string;
  props: Record<string, unknown> | null;
};

export type BuildActionCardsInput = {
  admin: SupabaseClient;
  bizId: string;
  orgId: string;
  userId: string;
  role: ActionCardRole;
  now?: Date;
};

export type BuildActionCardsResult = {
  generatedAt: string;
  mode: ActionCardMode;
  cards: ActionCard[];
  queueCount: number;
};

const BASIC_VISIBLE_LIMIT = 2;
const ADVANCED_VISIBLE_LIMIT = 6;

function startOfLocalDay(input: Date): Date {
  return new Date(input.getFullYear(), input.getMonth(), input.getDate(), 0, 0, 0, 0);
}

function endOfLocalDayExclusive(input: Date): Date {
  return new Date(input.getFullYear(), input.getMonth(), input.getDate() + 1, 0, 0, 0, 0);
}

function startOfLocalWeekMonday(input: Date): Date {
  const date = new Date(input.getTime());
  const day = date.getDay();
  const mondayOffset = (day + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfLocalWeekMondayExclusive(input: Date): Date {
  const start = startOfLocalWeekMonday(input);
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
}

function normalizeMode(input: string): ActionCardMode {
  return input === 'advanced' || input === 'full' ? 'advanced' : 'basic';
}

function platformLabel(platform: 'instagram' | 'tiktok' | 'facebook'): string {
  if (platform === 'tiktok') return 'TikTok';
  if (platform === 'facebook') return 'Facebook';
  return 'Instagram';
}

function formatCatalanTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });
}

function formatCatalanWeekday(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'avui';
  const raw = date.toLocaleDateString('ca-ES', { weekday: 'short' });
  return raw.replace('.', '');
}

function severityFromSignal(signal: SignalCard): ActionCardSeverity {
  if (signal.severity === 'high') return 'high';
  if (signal.severity === 'med') return 'medium';
  return 'low';
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function cardId(type: ActionCardType, refId: string): string {
  return `${type}:${refId}`;
}

function actionLabel(type: ActionCardType, action: ActionCardCtaAction): string {
  if (type === 'due_post') {
    if (action === 'copy_open') return 'Copiar i obrir';
    if (action === 'snooze') return 'Demà va millor';
    if (action === 'mark_done') return 'Ja està';
  }
  if (type === 'draft_approval') {
    if (action === 'approve') return 'Me’l quedo';
    if (action === 'regenerate') return 'Un altre';
    if (action === 'edit') return 'Retocar';
    if (action === 'view_only') return 'Veure';
  }
  if (type === 'week_unplanned') {
    if (action === 'open_weekly_wizard') return 'Prepara la setmana';
    if (action === 'view_only') return 'Veure';
  }
  if (type === 'signal') {
    if (action === 'view_recommendation') return 'Veure què fer';
    if (action === 'ack') return 'Entesos';
  }
  if (type === 'follow_up') {
    if (action === 'open_pending') return 'Veiem-les';
    if (action === 'copy_open') return 'Copiar i obrir';
    if (action === 'mark_done') return 'Ja està';
    if (action === 'snooze') return 'Demà va millor';
  }
  if (action === 'view_only') return 'Veure';
  return 'Obrir';
}

function makeCta(
  type: ActionCardType,
  action: ActionCardCtaAction,
  payload: Record<string, unknown>,
): ActionCardCta {
  return {
    label: actionLabel(type, action),
    action,
    payload,
  };
}

function pickPrimaryAndSecondaryCtas(input: {
  type: ActionCardType;
  role: ActionCardRole;
  payload: Record<string, unknown>;
}): { primary: ActionCardCta; secondary?: ActionCardCta } {
  const actions = getAllowedCardActions(input.type, input.role);
  const primaryAction = actions[0] || 'view_only';
  const secondaryAction = actions[1];

  return {
    primary: makeCta(input.type, primaryAction, input.payload),
    secondary: secondaryAction ? makeCta(input.type, secondaryAction, input.payload) : undefined,
  };
}

function withPriority(input: {
  type: ActionCardType;
  severity: ActionCardSeverity;
  daysInactive?: number;
}): number {
  const base = (() => {
    if (input.type === 'due_post') return 100;
    if (input.type === 'draft_approval') return 80;
    if (input.type === 'week_unplanned') return 50;
    if (input.type === 'signal') return 30;
    return 10;
  })();

  if (input.type === 'signal' && input.severity === 'high') return base + 25;
  if (input.type === 'follow_up' && (input.daysInactive || 0) >= 7) return base + 20;
  return base;
}

export function scoreCard(input: {
  type: ActionCardType;
  severity: ActionCardSeverity;
  daysInactive?: number;
}): number {
  return withPriority(input);
}

export function sortCardsByPriority(cards: ActionCard[]): ActionCard[] {
  return [...cards].sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return left.id.localeCompare(right.id);
  });
}

export function sliceCardsByMode(cards: ActionCard[], mode: ActionCardMode): ActionCard[] {
  const limit = mode === 'advanced' ? ADVANCED_VISIBLE_LIMIT : BASIC_VISIBLE_LIMIT;
  return cards.slice(0, limit);
}

async function resolveMode(admin: SupabaseClient, orgId: string): Promise<ActionCardMode> {
  const entitlements = await getOrgEntitlements({ supabase: admin, orgId });
  return normalizeMode(getSignalsLevel(entitlements));
}

async function queryDueSchedule(input: {
  admin: SupabaseClient;
  bizId: string;
  role: ActionCardRole;
  userId: string;
  now: Date;
}): Promise<SocialScheduleRow | null> {
  const dayStart = startOfLocalDay(input.now).toISOString();
  const dayEnd = endOfLocalDayExclusive(input.now).toISOString();

  let query = input.admin
    .from('social_schedules')
    .select('id, draft_id, platform, scheduled_at, status, published_at')
    .eq('biz_id', input.bizId)
    .in('status', ['scheduled', 'notified'])
    .gte('scheduled_at', dayStart)
    .lt('scheduled_at', dayEnd)
    .order('scheduled_at', { ascending: true })
    .limit(1);

  if (input.role === 'staff') {
    query = query.eq('assigned_user_id', input.userId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'due_schedule_query_failed');
  }

  const row = Array.isArray(data) ? data[0] : null;
  return (row as SocialScheduleRow | null) || null;
}

async function queryPendingDraft(input: {
  admin: SupabaseClient;
  bizId: string;
  role: ActionCardRole;
  userId: string;
}): Promise<SocialDraftRow | null> {
  let query = input.admin
    .from('social_drafts')
    .select('id, channel, updated_at, created_at')
    .eq('biz_id', input.bizId)
    .eq('status', 'pending')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (input.role === 'staff') {
    query = query.eq('created_by', input.userId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'pending_draft_query_failed');
  }

  const row = Array.isArray(data) ? data[0] : null;
  return (row as SocialDraftRow | null) || null;
}

async function queryWeekHasSchedules(input: {
  admin: SupabaseClient;
  bizId: string;
  now: Date;
}): Promise<boolean> {
  const weekStart = startOfLocalWeekMonday(input.now).toISOString();
  const weekEnd = endOfLocalWeekMondayExclusive(input.now).toISOString();
  const { count, error } = await input.admin
    .from('social_schedules')
    .select('id', { count: 'exact', head: true })
    .eq('biz_id', input.bizId)
    .in('status', ['scheduled', 'notified', 'snoozed', 'published'])
    .gte('scheduled_at', weekStart)
    .lt('scheduled_at', weekEnd);

  if (error) {
    throw new Error(error.message || 'week_schedule_count_failed');
  }

  return (count || 0) > 0;
}

async function querySignals(input: {
  admin: SupabaseClient;
  bizId: string;
  mode: ActionCardMode;
}): Promise<SignalCard[]> {
  const signalDay = new Date().toISOString().slice(0, 10);
  const since = new Date(`${signalDay}T00:00:00.000Z`);
  since.setUTCDate(since.getUTCDate() - 6);

  const rows = await listSignalsForBusiness({
    admin: input.admin,
    bizId: input.bizId,
    provider: 'google_business',
    sinceDay: since.toISOString().slice(0, 10),
    limit: 12,
  });

  const cards = toSignalCards({ rows, bizId: input.bizId });
  const signalsLimit = input.mode === 'advanced' ? 3 : 1;
  return pickTopSignals(cards, signalsLimit);
}

async function queryFollowUpInput(input: {
  admin: SupabaseClient;
  bizId: string;
  orgId: string;
  role: ActionCardRole;
  userId: string;
}): Promise<{
  pendingCount: number;
  daysInactive: number;
}> {
  let pendingQuery = input.admin
    .from('social_schedules')
    .select('id, scheduled_at, status, published_at')
    .eq('biz_id', input.bizId)
    .in('status', ['snoozed', 'missed'])
    .order('scheduled_at', { ascending: false })
    .limit(100);

  if (input.role === 'staff') {
    pendingQuery = pendingQuery.eq('assigned_user_id', input.userId);
  }

  const { data: pendingRows, error: pendingError } = await pendingQuery;
  if (pendingError) {
    throw new Error(pendingError.message || 'follow_up_pending_query_failed');
  }

  const pendingCount = Array.isArray(pendingRows) ? pendingRows.length : 0;
  if (pendingCount === 0) return { pendingCount: 0, daysInactive: 0 };

  const { data: telemetryRows, error: telemetryError } = await input.admin
    .from('telemetry_events')
    .select('created_at, props')
    .eq('org_id', input.orgId)
    .eq('event_name', 'post_executed')
    .order('created_at', { ascending: false })
    .limit(100);

  if (telemetryError) {
    throw new Error(telemetryError.message || 'follow_up_telemetry_query_failed');
  }

  const telemetry = (telemetryRows || []) as TelemetryRow[];
  const fromTelemetry = telemetry.find((row) => String(row.props?.bizId || row.props?.biz_id || '') === input.bizId);

  let lastExecutionAt: Date | null = null;
  if (fromTelemetry?.created_at) {
    const parsed = new Date(fromTelemetry.created_at);
    if (!Number.isNaN(parsed.getTime())) lastExecutionAt = parsed;
  }

  if (!lastExecutionAt) {
    let lastPublishedQuery = input.admin
      .from('social_schedules')
      .select('id, draft_id, platform, scheduled_at, status, published_at')
      .eq('biz_id', input.bizId)
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(1);

    if (input.role === 'staff') {
      lastPublishedQuery = lastPublishedQuery.eq('assigned_user_id', input.userId);
    }

    const { data: publishedRows, error: publishedError } = await lastPublishedQuery;
    if (publishedError) {
      throw new Error(publishedError.message || 'follow_up_last_published_query_failed');
    }
    const lastPublished = Array.isArray(publishedRows) ? publishedRows[0] : null;
    if (lastPublished?.published_at) {
      const parsed = new Date(lastPublished.published_at);
      if (!Number.isNaN(parsed.getTime())) lastExecutionAt = parsed;
    }
  }

  const now = new Date();
  const daysInactive = lastExecutionAt ? daysBetween(lastExecutionAt, now) : 365;
  return { pendingCount, daysInactive };
}

function buildDuePostCard(input: {
  row: SocialScheduleRow;
  role: ActionCardRole;
}): ActionCard {
  const payload = {
    schedule_id: input.row.id,
    draft_id: input.row.draft_id,
    platform: input.row.platform,
  };
  const ctas = pickPrimaryAndSecondaryCtas({
    type: 'due_post',
    role: input.role,
    payload,
  });
  const refs: ActionCardRef[] = [
    { kind: 'schedule_id', id: input.row.id },
    { kind: 'draft_id', id: input.row.draft_id },
  ];
  const severity: ActionCardSeverity = 'high';
  return {
    id: cardId('due_post', input.row.id),
    type: 'due_post',
    priority: withPriority({ type: 'due_post', severity }),
    severity,
    title: 'Toca publicar ara',
    subtitle: `${platformLabel(input.row.platform)} · avui a les ${formatCatalanTime(input.row.scheduled_at)}`,
    primary_cta: ctas.primary,
    secondary_cta: ctas.secondary,
    refs,
  };
}

function buildDraftApprovalCard(input: {
  row: SocialDraftRow;
  role: ActionCardRole;
}): ActionCard {
  const payload = {
    draft_id: input.row.id,
    channel: input.row.channel,
  };
  const ctas = pickPrimaryAndSecondaryCtas({
    type: 'draft_approval',
    role: input.role,
    payload,
  });
  const refs: ActionCardRef[] = [{ kind: 'draft_id', id: input.row.id }];
  const severity: ActionCardSeverity = 'medium';

  return {
    id: cardId('draft_approval', input.row.id),
    type: 'draft_approval',
    priority: withPriority({ type: 'draft_approval', severity }),
    severity,
    title: 'LITO t’ha preparat un post',
    subtitle: `${formatCatalanWeekday(input.row.updated_at || input.row.created_at)} · ${platformLabel(input.row.channel)}`,
    primary_cta: ctas.primary,
    secondary_cta: ctas.secondary,
    refs,
  };
}

function buildWeekUnplannedCard(input: {
  bizId: string;
  role: ActionCardRole;
}): ActionCard {
  const payload = {
    biz_id: input.bizId,
  };
  const ctas = pickPrimaryAndSecondaryCtas({
    type: 'week_unplanned',
    role: input.role,
    payload,
  });
  const refs: ActionCardRef[] = [{ kind: 'biz_id', id: input.bizId }];
  const severity: ActionCardSeverity = 'medium';

  return {
    id: cardId('week_unplanned', input.bizId),
    type: 'week_unplanned',
    priority: withPriority({ type: 'week_unplanned', severity }),
    severity,
    title: 'Setmana sense planificar',
    subtitle: 'Fem-ho en 2 minuts?',
    primary_cta: ctas.primary,
    secondary_cta: ctas.secondary,
    refs,
  };
}

function buildSignalCard(input: {
  row: SignalCard;
  role: ActionCardRole;
}): ActionCard {
  const severity = severityFromSignal(input.row);
  const payload = {
    signal_id: input.row.id,
    recommendation_id: typeof input.row.data?.recommendation_id === 'string'
      ? input.row.data.recommendation_id
      : null,
    route: input.row.cta_route,
  };
  const ctas = pickPrimaryAndSecondaryCtas({
    type: 'signal',
    role: input.role,
    payload,
  });
  const refs: ActionCardRef[] = [{ kind: 'signal_id', id: input.row.id }];
  const metric = String(input.row.why || input.row.reason || '').trim();

  return {
    id: cardId('signal', input.row.id),
    type: 'signal',
    priority: withPriority({ type: 'signal', severity }),
    severity,
    title: input.row.title,
    subtitle: metric || 'Senyal prioritària',
    primary_cta: ctas.primary,
    secondary_cta: ctas.secondary,
    refs,
  };
}

function buildFollowUpCard(input: {
  bizId: string;
  pendingCount: number;
  daysInactive: number;
  role: ActionCardRole;
}): ActionCard {
  const severity: ActionCardSeverity = input.daysInactive >= 14 ? 'high' : 'medium';
  const payload = {
    biz_id: input.bizId,
    pending_count: input.pendingCount,
    days_inactive: input.daysInactive,
  };
  const ctas = pickPrimaryAndSecondaryCtas({
    type: 'follow_up',
    role: input.role,
    payload,
  });
  const refs: ActionCardRef[] = [{ kind: 'biz_id', id: input.bizId }];

  return {
    id: cardId('follow_up', input.bizId),
    type: 'follow_up',
    priority: withPriority({ type: 'follow_up', severity, daysInactive: input.daysInactive }),
    severity,
    title: 'Fa dies que no publiques',
    subtitle: `Tens ${input.pendingCount} coses pendents`,
    primary_cta: ctas.primary,
    secondary_cta: ctas.secondary,
    refs,
  };
}

export async function buildActionCards(input: BuildActionCardsInput): Promise<BuildActionCardsResult> {
  const now = input.now || new Date();
  const generatedAt = now.toISOString();
  const mode = await resolveMode(input.admin, input.orgId);

  const [dueSchedule, pendingDraft, weekHasSchedules, signals, followUpData] = await Promise.all([
    queryDueSchedule({
      admin: input.admin,
      bizId: input.bizId,
      role: input.role,
      userId: input.userId,
      now,
    }),
    queryPendingDraft({
      admin: input.admin,
      bizId: input.bizId,
      role: input.role,
      userId: input.userId,
    }),
    queryWeekHasSchedules({
      admin: input.admin,
      bizId: input.bizId,
      now,
    }),
    querySignals({
      admin: input.admin,
      bizId: input.bizId,
      mode,
    }),
    queryFollowUpInput({
      admin: input.admin,
      bizId: input.bizId,
      orgId: input.orgId,
      role: input.role,
      userId: input.userId,
    }),
  ]);

  const cards: ActionCard[] = [];

  if (dueSchedule) {
    cards.push(buildDuePostCard({ row: dueSchedule, role: input.role }));
  }

  if (pendingDraft) {
    cards.push(buildDraftApprovalCard({ row: pendingDraft, role: input.role }));
  }

  const isMonday = now.getDay() === 1;
  const isAfterNine = now.getHours() >= 9;
  if (isMonday && isAfterNine && !weekHasSchedules) {
    cards.push(buildWeekUnplannedCard({ bizId: input.bizId, role: input.role }));
  }

  for (const signal of signals) {
    cards.push(buildSignalCard({ row: signal, role: input.role }));
  }

  if (followUpData.pendingCount > 0 && followUpData.daysInactive >= 7) {
    cards.push(buildFollowUpCard({
      bizId: input.bizId,
      pendingCount: followUpData.pendingCount,
      daysInactive: followUpData.daysInactive,
      role: input.role,
    }));
  }

  const sortedCards = sortCardsByPriority(cards);
  const queueCount = sortedCards.length;
  const visibleCards = sliceCardsByMode(sortedCards, mode);

  return {
    generatedAt,
    mode,
    cards: visibleCards,
    queueCount,
  };
}
