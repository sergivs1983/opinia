import type { SupabaseClient } from '@supabase/supabase-js';

export type RecommendationStatus = 'shown' | 'accepted' | 'dismissed' | 'published';
export type RecommendationVertical = 'general' | 'restaurant' | 'hotel';

export type WeeklyRecommendationItem = {
  id: string;
  rule_id: string;
  status: RecommendationStatus;
  generated_at: string;
  week_start: string;
  priority: number;
  vertical: RecommendationVertical;
  recommendation_template: RecommendationTemplate;
  format: string;
  hook: string;
  idea: string;
  cta: string;
};

type RecommendationLogRow = {
  id: string;
  rule_id: string;
  status: RecommendationStatus;
  generated_copy: string | null;
  generated_at: string;
  week_start: string;
};

type SocialPlaybookRow = {
  id: string;
  vertical: RecommendationVertical;
};

type PlaybookRuleRow = {
  id: string;
  playbook_id: string;
  priority: number;
  cooldown_days: number;
  recommendation_template: unknown;
  created_at: string;
};

export type RecommendationTemplate = {
  format: string;
  hook: string;
  idea: string;
  cta: string;
};

export const VISIBLE_STATUSES: RecommendationStatus[] = ['shown', 'accepted', 'published'];
const TARGET_WEEKLY_RECOMMENDATIONS = 3;

function isVisibleStatus(status: RecommendationStatus): boolean {
  return status === 'shown' || status === 'accepted' || status === 'published';
}

export function getWeekStartMondayIso(input: Date): string {
  const d = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun .. 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

export function mapBusinessTypeToVertical(type: string | null | undefined): RecommendationVertical {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'restaurant') return 'restaurant';
  if (normalized === 'hotel') return 'hotel';
  return 'general';
}

export function parseTemplate(input: unknown): RecommendationTemplate | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const format = typeof obj.format === 'string' ? obj.format : null;
  const hook = typeof obj.hook === 'string' ? obj.hook : null;
  const idea = typeof obj.idea === 'string' ? obj.idea : null;
  const cta = typeof obj.cta === 'string' ? obj.cta : null;
  if (!format || !hook || !idea || !cta) return null;
  return { format, hook, idea, cta };
}

export function parseTemplateFromGeneratedCopy(value: string | null | undefined): RecommendationTemplate | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parseTemplate(parsed);
  } catch {
    return null;
  }
}

export function ensureTemplateOrFallback(template: unknown): RecommendationTemplate {
  return (
    parseTemplate(template) || {
      format: 'post',
      hook: 'Comparteix una història real del teu negoci',
      idea: 'Publica un contingut curt i visual amb un detall diferencial del servei.',
      cta: 'Convida a deixar una ressenya després de la visita.',
    }
  );
}

function daysBetweenUtc(now: Date, previousIso: string): number {
  const previous = new Date(previousIso);
  if (Number.isNaN(previous.getTime())) return Number.MAX_SAFE_INTEGER;
  return Math.floor((now.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24));
}

function isCooldownExpired(
  rule: Pick<PlaybookRuleRow, 'id' | 'cooldown_days'>,
  latestByRuleId: Map<string, string>,
  now: Date,
): boolean {
  const latest = latestByRuleId.get(rule.id);
  if (!latest) return true;
  const elapsedDays = daysBetweenUtc(now, latest);
  return elapsedDays >= Math.max(rule.cooldown_days ?? 0, 0);
}

async function fetchWeekLogs(params: {
  readClient: SupabaseClient;
  bizId: string;
  weekStart: string;
}): Promise<RecommendationLogRow[]> {
  const { data, error } = await params.readClient
    .from('recommendation_log')
    .select('id, rule_id, status, generated_copy, generated_at, week_start')
    .eq('biz_id', params.bizId)
    .eq('week_start', params.weekStart)
    .order('generated_at', { ascending: true });

  if (error) {
    throw new Error(`weekly_logs_query_failed:${error.message}`);
  }

  return (data || []) as RecommendationLogRow[];
}

async function enrichItemsFromLogs(params: {
  readClient: SupabaseClient;
  logs: RecommendationLogRow[];
  fallbackVertical: RecommendationVertical;
}): Promise<WeeklyRecommendationItem[]> {
  const visibleLogs = params.logs.filter((row) => isVisibleStatus(row.status));
  if (visibleLogs.length === 0) return [];

  const ruleIds = [...new Set(visibleLogs.map((row) => row.rule_id))];
  const { data: rulesData, error: rulesError } = await params.readClient
    .from('playbook_rules')
    .select('id, playbook_id, priority, recommendation_template')
    .in('id', ruleIds);

  if (rulesError) {
    throw new Error(`rules_lookup_failed:${rulesError.message}`);
  }

  const playbookIds = [...new Set((rulesData || []).map((row) => (row as { playbook_id?: string }).playbook_id).filter(Boolean))];
  const { data: playbooksData, error: playbooksError } = await params.readClient
    .from('social_playbooks')
    .select('id, vertical')
    .in('id', playbookIds.length ? playbookIds : ['00000000-0000-0000-0000-000000000000']);

  if (playbooksError) {
    throw new Error(`playbooks_lookup_failed:${playbooksError.message}`);
  }

  const verticalByPlaybookId = new Map<string, RecommendationVertical>();
  for (const row of playbooksData || []) {
    const id = (row as { id?: string }).id;
    const vertical = (row as { vertical?: RecommendationVertical }).vertical;
    if (id && vertical) verticalByPlaybookId.set(id, vertical);
  }

  const ruleInfoById = new Map<string, { priority: number; vertical: RecommendationVertical; template: RecommendationTemplate }>();
  for (const row of rulesData || []) {
    const id = (row as { id?: string }).id;
    if (!id) continue;
    const playbookId = (row as { playbook_id?: string }).playbook_id || '';
    const priority = Number((row as { priority?: number }).priority ?? 100);
    const template = ensureTemplateOrFallback((row as { recommendation_template?: unknown }).recommendation_template);
    const vertical = verticalByPlaybookId.get(playbookId) || params.fallbackVertical;
    ruleInfoById.set(id, { priority, vertical, template });
  }

  return visibleLogs.slice(0, TARGET_WEEKLY_RECOMMENDATIONS).map((row) => {
    const info = ruleInfoById.get(row.rule_id);
    const template = parseTemplateFromGeneratedCopy(row.generated_copy) || info?.template || ensureTemplateOrFallback(null);
    return {
      id: row.id,
      rule_id: row.rule_id,
      status: row.status,
      generated_at: row.generated_at,
      week_start: row.week_start,
      priority: info?.priority ?? 100,
      vertical: info?.vertical ?? params.fallbackVertical,
      recommendation_template: template,
      format: template.format,
      hook: template.hook,
      idea: template.idea,
      cta: template.cta,
    };
  });
}

async function fetchCandidateRules(params: {
  readClient: SupabaseClient;
  vertical: RecommendationVertical;
}): Promise<{ playbooks: SocialPlaybookRow[]; rules: PlaybookRuleRow[] }> {
  const verticals: RecommendationVertical[] = params.vertical === 'general'
    ? ['general']
    : [params.vertical, 'general'];

  const { data: playbooksData, error: playbooksError } = await params.readClient
    .from('social_playbooks')
    .select('id, vertical')
    .in('vertical', verticals)
    .eq('is_active', true);

  if (playbooksError) {
    throw new Error(`playbooks_query_failed:${playbooksError.message}`);
  }

  const playbooks = (playbooksData || []) as SocialPlaybookRow[];
  const playbookIds = playbooks.map((row) => row.id);
  if (playbookIds.length === 0) return { playbooks, rules: [] };

  const { data: rulesData, error: rulesError } = await params.readClient
    .from('playbook_rules')
    .select('id, playbook_id, priority, cooldown_days, recommendation_template, created_at')
    .eq('is_active', true)
    .eq('trigger_type', 'evergreen')
    .in('playbook_id', playbookIds);

  if (rulesError) {
    throw new Error(`rules_query_failed:${rulesError.message}`);
  }

  const playbookById = new Map(playbooks.map((row) => [row.id, row]));
  const rules = ((rulesData || []) as PlaybookRuleRow[]).sort((a, b) => {
    const aVertical = playbookById.get(a.playbook_id)?.vertical;
    const bVertical = playbookById.get(b.playbook_id)?.vertical;
    const aWeight = aVertical === params.vertical ? 0 : 1;
    const bWeight = bVertical === params.vertical ? 0 : 1;
    if (aWeight !== bWeight) return aWeight - bWeight;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.created_at.localeCompare(b.created_at);
  });

  return { playbooks, rules };
}

async function ensureTargetCount(params: {
  readClient: SupabaseClient;
  writeClient: SupabaseClient;
  bizId: string;
  orgId: string;
  vertical: RecommendationVertical;
  weekStart: string;
  existingLogs: RecommendationLogRow[];
}): Promise<void> {
  const visibleNow = params.existingLogs.filter((row) => isVisibleStatus(row.status));
  if (visibleNow.length >= TARGET_WEEKLY_RECOMMENDATIONS) return;

  const needed = TARGET_WEEKLY_RECOMMENDATIONS - visibleNow.length;
  const { playbooks, rules: candidateRules } = await fetchCandidateRules({
    readClient: params.readClient,
    vertical: params.vertical,
  });
  if (candidateRules.length === 0) return;

  const maxCooldown = Math.max(...candidateRules.map((rule) => rule.cooldown_days || 0), 0);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - Math.max(maxCooldown, 7));

  const { data: recentLogsData, error: recentLogsError } = await params.readClient
    .from('recommendation_log')
    .select('rule_id, status, generated_at')
    .eq('biz_id', params.bizId)
    .in('status', VISIBLE_STATUSES)
    .gte('generated_at', since.toISOString())
    .order('generated_at', { ascending: false });

  if (recentLogsError) {
    throw new Error(`recent_logs_query_failed:${recentLogsError.message}`);
  }

  const latestByRuleId = new Map<string, string>();
  for (const row of recentLogsData || []) {
    const ruleId = (row as { rule_id?: string }).rule_id;
    const generatedAt = (row as { generated_at?: string }).generated_at;
    if (ruleId && generatedAt && !latestByRuleId.has(ruleId)) {
      latestByRuleId.set(ruleId, generatedAt);
    }
  }

  const existingWeekRuleIds = new Set(params.existingLogs.map((row) => row.rule_id));
  const selected: PlaybookRuleRow[] = [];
  const selectedIds = new Set<string>();
  const now = new Date();

  for (const rule of candidateRules) {
    if (selected.length >= needed) break;
    if (existingWeekRuleIds.has(rule.id) || selectedIds.has(rule.id)) continue;
    if (!isCooldownExpired(rule, latestByRuleId, now)) continue;
    selected.push(rule);
    selectedIds.add(rule.id);
  }

  if (selected.length < needed) {
    for (const rule of candidateRules) {
      if (selected.length >= needed) break;
      if (existingWeekRuleIds.has(rule.id) || selectedIds.has(rule.id)) continue;
      selected.push(rule);
      selectedIds.add(rule.id);
    }
  }

  if (selected.length > 0) {
    const playbookVerticalById = new Map(playbooks.map((row) => [row.id, row.vertical]));
    const rowsToInsert = selected.map((rule) => {
      const template = ensureTemplateOrFallback(rule.recommendation_template);
      const templateWithMeta = {
        ...template,
        vertical: playbookVerticalById.get(rule.playbook_id) || params.vertical,
        priority: rule.priority,
      };
      return {
        org_id: params.orgId,
        biz_id: params.bizId,
        rule_id: rule.id,
        week_start: params.weekStart,
        status: 'shown' as const,
        generated_copy: JSON.stringify(templateWithMeta),
      };
    });

    const { error: insertError } = await params.writeClient
      .from('recommendation_log')
      .upsert(rowsToInsert, { onConflict: 'biz_id,rule_id,week_start', ignoreDuplicates: true });

    if (insertError) {
      throw new Error(`insert_logs_failed:${insertError.message}`);
    }
  }

  // Fallback de seguretat: si no hi ha prou regles úniques, reutilitza dismissed de la setmana.
  const refreshedLogs = await fetchWeekLogs({
    readClient: params.readClient,
    bizId: params.bizId,
    weekStart: params.weekStart,
  });
  const refreshedVisible = refreshedLogs.filter((row) => isVisibleStatus(row.status));
  if (refreshedVisible.length >= TARGET_WEEKLY_RECOMMENDATIONS) return;

  const stillMissing = TARGET_WEEKLY_RECOMMENDATIONS - refreshedVisible.length;
  const dismissedToRevive = refreshedLogs
    .filter((row) => row.status === 'dismissed')
    .slice(0, stillMissing)
    .map((row) => row.id);

  if (dismissedToRevive.length === 0) return;

  const { error: reviveError } = await params.writeClient
    .from('recommendation_log')
    .update({ status: 'shown' })
    .in('id', dismissedToRevive);

  if (reviveError) {
    throw new Error(`revive_dismissed_failed:${reviveError.message}`);
  }
}

export async function ensureAndGetWeeklyRecommendations(params: {
  readClient: SupabaseClient;
  writeClient: SupabaseClient;
  bizId: string;
  orgId: string;
  vertical: RecommendationVertical;
  weekStart: string;
}): Promise<{
  items: WeeklyRecommendationItem[];
  visibleCount: number;
}> {
  const initialLogs = await fetchWeekLogs({
    readClient: params.readClient,
    bizId: params.bizId,
    weekStart: params.weekStart,
  });

  await ensureTargetCount({
    readClient: params.readClient,
    writeClient: params.writeClient,
    bizId: params.bizId,
    orgId: params.orgId,
    vertical: params.vertical,
    weekStart: params.weekStart,
    existingLogs: initialLogs,
  });

  const finalLogs = await fetchWeekLogs({
    readClient: params.readClient,
    bizId: params.bizId,
    weekStart: params.weekStart,
  });

  const items = await enrichItemsFromLogs({
    readClient: params.readClient,
    logs: finalLogs,
    fallbackVertical: params.vertical,
  });

  return {
    items: items.slice(0, TARGET_WEEKLY_RECOMMENDATIONS),
    visibleCount: items.length,
  };
}
