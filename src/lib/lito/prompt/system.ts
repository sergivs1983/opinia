import type { LITOChatMode, LITOPayload } from '@/lib/lito/context/types';

function languageInstruction(language: 'ca' | 'es' | 'en'): string {
  if (language === 'es') {
    return 'Responde en español claro y breve.';
  }
  if (language === 'en') {
    return 'Reply in clear and concise English.';
  }
  return 'Respon en català clar i breu.';
}

function formalityInstruction(input: {
  language: 'ca' | 'es' | 'en';
  formality: 'tu' | 'voste' | 'mixt';
}): string {
  if (input.language === 'es') {
    if (input.formality === 'tu') return 'Trata al cliente de tú.';
    if (input.formality === 'voste') return 'Usa tratamiento de usted.';
    return 'Usa un tono mixto, cercano pero profesional.';
  }
  if (input.language === 'en') {
    if (input.formality === 'tu') return 'Use an informal direct tone.';
    if (input.formality === 'voste') return 'Use a formal and respectful tone.';
    return 'Use a mixed tone: warm and professional.';
  }

  if (input.formality === 'tu') return 'Tracta el client de tu.';
  if (input.formality === 'voste') return 'Tracta el client de vostè.';
  return 'Usa un to mixt: proper i professional.';
}

function maxLengthInstruction(input: {
  language: 'ca' | 'es' | 'en';
  maxWords: number;
}): string {
  if (input.language === 'es') return `No superes ${input.maxWords} palabras por respuesta.`;
  if (input.language === 'en') return `Do not exceed ${input.maxWords} words per answer.`;
  return `No superis ${input.maxWords} paraules per resposta.`;
}

function avoidInstruction(input: {
  language: 'ca' | 'es' | 'en';
  values: string[];
}): string {
  if (input.values.length === 0) return '';
  const list = input.values.join(', ');
  if (input.language === 'es') return `Nunca menciones: ${list}.`;
  if (input.language === 'en') return `Never mention: ${list}.`;
  return `No mencionis mai: ${list}.`;
}

function keywordInstruction(input: {
  language: 'ca' | 'es' | 'en';
  values: string[];
}): string {
  if (input.values.length === 0) return '';
  const list = input.values.join(', ');
  if (input.language === 'es') return `Prioriza estas palabras clave cuando encaje: ${list}.`;
  if (input.language === 'en') return `Prioritize these keywords when relevant: ${list}.`;
  return `Prioritza aquestes paraules clau quan encaixi: ${list}.`;
}

function primaryFocusInstruction(input: {
  language: 'ca' | 'es' | 'en';
  focus: 'reviews' | 'social' | 'both';
}): string {
  if (input.language === 'es') {
    if (input.focus === 'reviews') return 'Prioriza acciones y respuestas de reseñas.';
    if (input.focus === 'social') return 'Prioriza acciones y copy de redes sociales.';
    return 'Equilibra entre reseñas y redes sociales.';
  }
  if (input.language === 'en') {
    if (input.focus === 'reviews') return 'Prioritize review response actions.';
    if (input.focus === 'social') return 'Prioritize social media actions and copy.';
    return 'Keep a balanced focus between reviews and social media.';
  }
  if (input.focus === 'reviews') return 'Prioritza accions i respostes de ressenyes.';
  if (input.focus === 'social') return 'Prioritza accions i copy de xarxes socials.';
  return 'Mantén equilibri entre ressenyes i xarxes socials.';
}

export function buildLitoSystemPrompt(input: {
  payload: LITOPayload;
  mode?: LITOChatMode;
}): string {
  const mode = input.mode || 'chat';
  const language = input.payload.business_context.language;
  const langRule = languageInstruction(language);
  const memory = input.payload.business_context.memory;
  const memoryFormality = memory.brand_voice.formality || 'mixt';
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
  const keywordList = memory.brand_voice.keywords.slice(0, 8);

  const modeRule = mode === 'orchestrator'
    ? 'Si el mode és orchestrator, torna només JSON vàlid amb greeting, priority_message i cards.'
    : mode === 'orchestrator_safe'
      ? 'Mode orchestrator_safe: torna només JSON vàlid i no inventis cap card.'
    : 'Mode chat: respon només text natural, sense JSON.';

  return [
    'Ets LITO, assistent d’operacions per petit negoci.',
    langRule,
    'To curt, concret i accionable. Evita tecnicismes.',
    'No executis accions automàtiques ni afirmis que has publicat/aprovat res.',
    'Quan faltin dades, digues-ho i proposa el següent pas en 1 línia.',
    formalityInstruction({ language, formality: memoryFormality }),
    maxLengthInstruction({ language, maxWords }),
    avoidInstruction({ language, values: avoidList }),
    keywordInstruction({ language, values: keywordList }),
    primaryFocusInstruction({ language, focus: memory.policies.primary_focus || 'both' }),
    modeRule,
    'No incloguis dades personals ni cites literals de ressenyes.',
  ].filter(Boolean).join('\n');
}
