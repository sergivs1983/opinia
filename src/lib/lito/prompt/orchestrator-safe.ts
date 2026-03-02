import type { ActionCard, ActionCardMode, ActionCardRole } from '@/types/lito-cards';
import type { LITOPayload } from '@/lib/lito/context/types';

function languageInstruction(language: 'ca' | 'es' | 'en'): string {
  if (language === 'es') return 'Escribe en español breve y cercano.';
  if (language === 'en') return 'Write concise and friendly English.';
  return 'Escriu en català breu i proper.';
}

function modeLimit(mode: ActionCardMode): number {
  return mode === 'advanced' ? 6 : 2;
}

function compactText(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function renderCards(cards: ActionCard[]): string {
  return cards
    .map((card) => {
      const secondary = card.secondary_cta
        ? `secondary={label:${card.secondary_cta.label};action:${card.secondary_cta.action}}`
        : 'secondary={none}';
      return [
        `id=${card.id}`,
        `type=${card.type}`,
        `severity=${card.severity}`,
        `title=${compactText(card.title, 96)}`,
        `subtitle=${compactText(card.subtitle, 120)}`,
        `primary={label:${compactText(card.primary_cta.label, 48)};action:${card.primary_cta.action}}`,
        secondary,
      ].join(' | ');
    })
    .join('\n');
}

export function buildOrchestratorSafePrompt(input: {
  payload: LITOPayload;
  role: ActionCardRole;
  mode: ActionCardMode;
  message: string;
  cards: ActionCard[];
}): string {
  const limit = modeLimit(input.mode);
  const langRule = languageInstruction(input.payload.business_context.language);
  const cardsList = renderCards(input.cards);

  return [
    'Ets LITO Orchestrator SAFE.',
    langRule,
    'No inventis cards noves. Només pots triar IDs de la llista rebuda.',
    `Has de seleccionar entre 1 i ${limit} cards (mode=${input.mode}).`,
    'No incloguis PII, ni tecnicismes, ni promeses d’accions automàtiques.',
    'Pots reescriure title/subtitle/labels, però MAI canviar action ni payload.',
    'Retorna EXCLUSIVAMENT JSON vàlid amb aquest schema:',
    '{ "greeting": string, "priority_message": string, "selected_card_ids": string[], "cards_copy"?: { "<id>": { "title"?: string, "subtitle"?: string, "primary_label"?: string, "secondary_label"?: string } }, "next_question": string }',
    '',
    `role=${input.role}`,
    `mode=${input.mode}`,
    `context_summary=${compactText(input.payload.context_summary, 800)}`,
    `user_message=${compactText(input.message, 280)}`,
    'available_cards:',
    cardsList || '(none)',
    'Output JSON only.',
  ].join('\n');
}
