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

export function buildLitoSystemPrompt(input: {
  payload: LITOPayload;
  mode?: LITOChatMode;
}): string {
  const mode = input.mode || 'chat';
  const langRule = languageInstruction(input.payload.business_context.language);

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
    modeRule,
    'No incloguis dades personals ni cites literals de ressenyes.',
  ].join('\n');
}
