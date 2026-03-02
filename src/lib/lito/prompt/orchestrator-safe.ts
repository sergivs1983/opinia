import type { ActionCard, ActionCardMode, ActionCardRole } from '@/types/lito-cards';
import type { LITOPayload } from '@/lib/lito/context/types';

function languageInstruction(language: 'ca' | 'es' | 'en'): string {
  if (language === 'es') return 'Escribe en español breve y cercano.';
  if (language === 'en') return 'Write concise and friendly English.';
  return 'Escriu en català breu i proper.';
}

function formalityInstruction(input: {
  language: 'ca' | 'es' | 'en';
  formality: 'tu' | 'voste' | 'mixt';
}): string {
  if (input.language === 'es') {
    if (input.formality === 'tu') return 'Tratamiento obligatorio: tú.';
    if (input.formality === 'voste') return 'Tratamiento obligatorio: usted.';
    return 'Tratamiento obligatorio: mixto (cercano y profesional).';
  }
  if (input.language === 'en') {
    if (input.formality === 'tu') return 'Required tone: informal direct.';
    if (input.formality === 'voste') return 'Required tone: formal and respectful.';
    return 'Required tone: mixed, warm and professional.';
  }

  if (input.formality === 'tu') return 'Tractament obligatori: tu.';
  if (input.formality === 'voste') return 'Tractament obligatori: vostè.';
  return 'Tractament obligatori: mixt (proper i professional).';
}

function modeLimit(mode: ActionCardMode): number {
  return mode === 'advanced' ? 6 : 2;
}

function resolveLanguage(value: unknown): 'ca' | 'es' | 'en' {
  if (value === 'es' || value === 'en') return value;
  return 'ca';
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
  const language = resolveLanguage(input.payload.business_context.language ?? 'ca');
  const langRule = languageInstruction(language);
  const memory = input.payload.business_context.memory;
  const maxWords = Number.isFinite(memory.policies.max_length_words)
    ? Math.max(20, Math.min(300, Math.floor(memory.policies.max_length_words)))
    : 120;
  const avoidList = Array.from(
    new Set(
      [...memory.brand_voice.avoid, ...memory.policies.never_mention]
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 8);
  const avoidLine = avoidList.length > 0
    ? (
      language === 'es'
        ? `Nunca menciones: ${avoidList.join(', ')}.`
        : language === 'en'
          ? `Never mention: ${avoidList.join(', ')}.`
          : `No mencionis mai: ${avoidList.join(', ')}.`
    )
    : (
      language === 'es'
        ? 'No menciones contenido sensible ni datos privados.'
        : language === 'en'
          ? 'Do not mention sensitive content or private data.'
          : 'No mencionis contingut sensible ni dades privades.'
    );
  const cardsList = renderCards(input.cards);

  return [
    'Ets LITO Orchestrator SAFE.',
    langRule,
    `Idioma obligatori de sortida: ${language}.`,
    formalityInstruction({ language, formality: memory.brand_voice.formality || 'mixt' }),
    `Límit de longitud: màxim ${maxWords} paraules per camp textual (greeting, priority_message, next_question, labels).`,
    avoidLine,
    'No inventis cards noves. Només pots triar IDs de la llista rebuda.',
    `Has de seleccionar entre 1 i ${limit} cards (mode=${input.mode}).`,
    'No incloguis PII, ni tecnicismes, ni promeses d’accions automàtiques.',
    'Pots reescriure title/subtitle/labels, però MAI canviar action ni payload.',
    'greeting, priority_message i next_question han d’estar SEMPRE en l’idioma obligatori.',
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
