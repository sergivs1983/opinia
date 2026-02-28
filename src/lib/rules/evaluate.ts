import type { SupabaseClient } from '@supabase/supabase-js';

import type { ReviewTriage } from '@/lib/rules/triage';

type RuleRow = {
  id: string;
  org_id: string;
  biz_id: string | null;
  provider: string | null;
  status: 'active' | 'disabled';
  priority: number | null;
  allow_auto_publish: boolean | null;
};

type RuleConditionRow = {
  id: string;
  rule_id: string;
  field: string;
  op: 'eq' | 'neq' | 'in' | 'contains' | 'gte' | 'lte' | 'exists';
  value: unknown;
  created_at: string | null;
};

type RuleActionRow = {
  id: string;
  rule_id: string;
  type: 'require_approval' | 'draft' | 'auto_publish_template';
  template: string | null;
  template_version: number | null;
  created_at: string | null;
};

export type RuleMatchCondition = {
  condition_id: string;
  field: string;
  op: RuleConditionRow['op'];
  expected: unknown;
  actual: unknown;
};

export type RuleMatch = {
  rule_id: string;
  action_id: string;
  action_type: RuleActionRow['type'];
  template: string | null;
  template_version: number;
  allow_auto_publish: boolean;
  matched_conditions: RuleMatchCondition[];
};

type EvaluateRuleInput = {
  admin: SupabaseClient;
  orgId: string;
  bizId: string;
  provider: string | null;
  triage: ReviewTriage;
};

function normalize(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function compareEq(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' || typeof right === 'number') {
    const a = asNumber(left);
    const b = asNumber(right);
    if (a !== null && b !== null) return a === b;
  }
  return normalize(String(left)) === normalize(String(right));
}

function resolveFieldValue(triage: ReviewTriage, field: string): unknown {
  if (field === 'rating') return triage.rating;
  if (field === 'has_text') return triage.has_text;
  if (field === 'text_len') return triage.text_len;
  if (field === 'has_question_mark') return triage.has_question_mark;
  if (field.startsWith('keyword_flags.')) {
    const key = field.slice('keyword_flags.'.length) as keyof ReviewTriage['keyword_flags'];
    return triage.keyword_flags[key];
  }
  return null;
}

function evaluateCondition(condition: RuleConditionRow, triage: ReviewTriage): RuleMatchCondition | null {
  const actual = resolveFieldValue(triage, condition.field);
  const expected = condition.value;

  switch (condition.op) {
    case 'eq':
      return compareEq(actual, expected) ? {
        condition_id: condition.id,
        field: condition.field,
        op: condition.op,
        expected,
        actual,
      } : null;
    case 'neq':
      return !compareEq(actual, expected) ? {
        condition_id: condition.id,
        field: condition.field,
        op: condition.op,
        expected,
        actual,
      } : null;
    case 'in': {
      const list = Array.isArray(expected) ? expected : [];
      const pass = list.some((entry) => compareEq(actual, entry));
      return pass ? {
        condition_id: condition.id,
        field: condition.field,
        op: condition.op,
        expected,
        actual,
      } : null;
    }
    case 'contains': {
      if (typeof actual === 'string') {
        const pass = normalize(actual).includes(normalize(String(expected ?? '')));
        return pass ? {
          condition_id: condition.id,
          field: condition.field,
          op: condition.op,
          expected,
          actual,
        } : null;
      }
      if (Array.isArray(actual)) {
        const pass = actual.some((entry) => compareEq(entry, expected));
        return pass ? {
          condition_id: condition.id,
          field: condition.field,
          op: condition.op,
          expected,
          actual,
        } : null;
      }
      return null;
    }
    case 'gte': {
      const a = asNumber(actual);
      const b = asNumber(expected);
      return (a !== null && b !== null && a >= b) ? {
        condition_id: condition.id,
        field: condition.field,
        op: condition.op,
        expected,
        actual,
      } : null;
    }
    case 'lte': {
      const a = asNumber(actual);
      const b = asNumber(expected);
      return (a !== null && b !== null && a <= b) ? {
        condition_id: condition.id,
        field: condition.field,
        op: condition.op,
        expected,
        actual,
      } : null;
    }
    case 'exists': {
      const expectedBoolean = typeof expected === 'boolean' ? expected : true;
      const exists = actual !== null && actual !== undefined;
      return (exists === expectedBoolean) ? {
        condition_id: condition.id,
        field: condition.field,
        op: condition.op,
        expected,
        actual,
      } : null;
    }
    default:
      return null;
  }
}

export async function evaluateRules(input: EvaluateRuleInput): Promise<RuleMatch | null> {
  const { admin, orgId, bizId, provider, triage } = input;
  const normalizedProvider = normalize(provider || 'google_business');

  const { data: rulesData, error: rulesError } = await admin
    .from('rules')
    .select('id, org_id, biz_id, provider, status, priority, allow_auto_publish')
    .eq('org_id', orgId)
    .eq('status', 'active');

  if (rulesError) {
    throw new Error(rulesError.message || 'rules_fetch_failed');
  }

  const rules = ((rulesData || []) as RuleRow[])
    .filter((rule) => (rule.biz_id === bizId || rule.biz_id === null))
    .filter((rule) => (rule.provider === null || normalize(rule.provider) === normalizedProvider))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  if (rules.length === 0) return null;

  const ruleIds = rules.map((rule) => rule.id);

  const [{ data: conditionsData, error: conditionsError }, { data: actionsData, error: actionsError }] = await Promise.all([
    admin
      .from('rule_conditions')
      .select('id, rule_id, field, op, value, created_at')
      .in('rule_id', ruleIds),
    admin
      .from('rule_actions')
      .select('id, rule_id, type, template, template_version, created_at')
      .in('rule_id', ruleIds),
  ]);

  if (conditionsError) {
    throw new Error(conditionsError.message || 'rule_conditions_fetch_failed');
  }
  if (actionsError) {
    throw new Error(actionsError.message || 'rule_actions_fetch_failed');
  }

  const conditionsByRule = new Map<string, RuleConditionRow[]>();
  for (const condition of (conditionsData || []) as RuleConditionRow[]) {
    const next = conditionsByRule.get(condition.rule_id) || [];
    next.push(condition);
    conditionsByRule.set(condition.rule_id, next);
  }

  const actionsByRule = new Map<string, RuleActionRow[]>();
  for (const action of (actionsData || []) as RuleActionRow[]) {
    const next = actionsByRule.get(action.rule_id) || [];
    next.push(action);
    actionsByRule.set(action.rule_id, next);
  }

  for (const rule of rules) {
    const conditions = (conditionsByRule.get(rule.id) || []).sort(
      (a, b) => (a.created_at || '').localeCompare(b.created_at || ''),
    );
    const matchedConditions: RuleMatchCondition[] = [];
    let allPass = true;

    for (const condition of conditions) {
      const matched = evaluateCondition(condition, triage);
      if (!matched) {
        allPass = false;
        break;
      }
      matchedConditions.push(matched);
    }

    if (!allPass) continue;

    const actions = (actionsByRule.get(rule.id) || []).sort(
      (a, b) => (a.created_at || '').localeCompare(b.created_at || ''),
    );
    const selectedAction = actions[0];
    if (!selectedAction) continue;

    return {
      rule_id: rule.id,
      action_id: selectedAction.id,
      action_type: selectedAction.type,
      template: selectedAction.template,
      template_version: selectedAction.template_version || 1,
      allow_auto_publish: Boolean(rule.allow_auto_publish),
      matched_conditions: matchedConditions,
    };
  }

  return null;
}
