import type { ActionCard, ActionCardMode } from '@/types/lito-cards';

export type OrchestratorCardCopyOverride = {
  title?: string;
  subtitle?: string;
  primary_label?: string;
  secondary_label?: string;
};

export type LitoOrchestratorSafeOutput = {
  greeting: string;
  priority_message: string;
  selected_card_ids: string[];
  cards_copy?: Record<string, OrchestratorCardCopyOverride>;
  next_question: string;
};

export type ValidateOrchestratorOutputResult =
  | { ok: true; value: LitoOrchestratorSafeOutput }
  | { ok: false; error: string };

const BASIC_MAX = 2;
const ADVANCED_MAX = 6;

function compactText(value: unknown, max = 180): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return '';
  return text.slice(0, max);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseSelectedCardIds(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') return null;
    const id = item.trim();
    if (!id) return null;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function normalizeCopyOverride(input: unknown): OrchestratorCardCopyOverride | null {
  if (!isObject(input)) return null;

  const title = compactText(input.title, 96);
  const subtitle = compactText(input.subtitle, 140);
  const primaryLabel = compactText(input.primary_label, 48);
  const secondaryLabel = compactText(input.secondary_label, 48);

  const out: OrchestratorCardCopyOverride = {};
  if (title) out.title = title;
  if (subtitle) out.subtitle = subtitle;
  if (primaryLabel) out.primary_label = primaryLabel;
  if (secondaryLabel) out.secondary_label = secondaryLabel;
  return out;
}

function parseCardsCopy(input: unknown, allowedIds: Set<string>): Record<string, OrchestratorCardCopyOverride> | undefined {
  if (!isObject(input)) return undefined;
  const out: Record<string, OrchestratorCardCopyOverride> = {};

  for (const [cardId, payload] of Object.entries(input)) {
    if (!allowedIds.has(cardId)) continue;
    const override = normalizeCopyOverride(payload);
    if (!override) continue;
    if (
      override.title
      || override.subtitle
      || override.primary_label
      || override.secondary_label
    ) {
      out[cardId] = override;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function parseJsonString(input: string): unknown {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (!fenced) return null;
    try {
      return JSON.parse(fenced);
    } catch {
      return null;
    }
  }
}

export function validateOrchestratorSafeOutput(input: {
  raw: unknown;
  cards: ActionCard[];
  mode: ActionCardMode;
}): ValidateOrchestratorOutputResult {
  const parsed = typeof input.raw === 'string' ? parseJsonString(input.raw) : input.raw;
  if (!isObject(parsed)) {
    return { ok: false, error: 'output_not_object' };
  }

  const greeting = compactText(parsed.greeting, 140);
  const priority = compactText(parsed.priority_message, 180);
  const nextQuestion = compactText(parsed.next_question, 160);
  if (!greeting || !priority || !nextQuestion) {
    return { ok: false, error: 'missing_required_strings' };
  }

  const selected = parseSelectedCardIds(parsed.selected_card_ids);
  if (!selected) {
    return { ok: false, error: 'selected_card_ids_invalid' };
  }

  const max = input.mode === 'advanced' ? ADVANCED_MAX : BASIC_MAX;
  if (selected.length > max) {
    return { ok: false, error: 'selected_card_ids_out_of_bounds' };
  }

  const allowedIds = new Set(input.cards.map((card) => card.id));
  if (!selected.every((id) => allowedIds.has(id))) {
    return { ok: false, error: 'selected_card_ids_not_allowed' };
  }

  return {
    ok: true,
    value: {
      greeting,
      priority_message: priority,
      selected_card_ids: selected,
      cards_copy: parseCardsCopy(parsed.cards_copy, allowedIds),
      next_question: nextQuestion,
    },
  };
}

export function applyOrchestratorCopyOverrides(input: {
  cards: ActionCard[];
  cardsCopy?: Record<string, OrchestratorCardCopyOverride>;
}): ActionCard[] {
  const copy = input.cardsCopy || {};
  return input.cards.map((card) => {
    const override = copy[card.id];
    if (!override) return card;
    return {
      ...card,
      title: override.title || card.title,
      subtitle: override.subtitle || card.subtitle,
      primary_cta: {
        ...card.primary_cta,
        label: override.primary_label || card.primary_cta.label,
      },
      secondary_cta: card.secondary_cta
        ? {
            ...card.secondary_cta,
            label: override.secondary_label || card.secondary_cta.label,
          }
        : undefined,
    };
  });
}
