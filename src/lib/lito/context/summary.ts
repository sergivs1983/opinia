import type { LITOPayload } from '@/lib/lito/context/types';

type SummaryLanguage = 'ca' | 'es' | 'en';

const MAX_WORDS = 160;
const MAX_LINES = 6;

function compactLine(value: string, max = 150): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function trimWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value.trim();
  return words.slice(0, maxWords).join(' ').trim();
}

function joinPoints(values: string[], max = 2): string {
  return values
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max)
    .join(' · ');
}

function buildLinesByLanguage(input: {
  language: SummaryLanguage;
  payload: Omit<LITOPayload, 'context_summary'>;
}): string[] {
  const { payload, language } = input;
  const b = payload.business_context;
  const s = payload.state_context;
  const signals = payload.signals_context;
  const topSignal = signals.top[0];
  const memory = b.memory;
  const toneHint = joinPoints(memory.brand_voice.tone, 2) || '-';
  const keywordHint = joinPoints(memory.brand_voice.keywords, 3) || '-';
  const avoidHint = joinPoints(memory.brand_voice.avoid, 2) || joinPoints(memory.policies.never_mention, 2) || '-';

  if (language === 'es') {
    return [
      compactLine(`Negocio: ${b.business_name} (${b.vertical}) · idioma ${b.language}.`),
      compactLine(`Hoy: ${s.due_today_count} publicaciones pendientes. Semana: ${s.scheduled_this_week_count} programadas.`),
      compactLine(`Borradores: ${s.pending_drafts_count} pendientes y ${s.approved_drafts_count} aprobados.`),
      compactLine(topSignal ? `Señal clave: ${topSignal.title} · ${topSignal.metric}.` : `Señales activas: ${signals.active_count}.`),
      compactLine(
        s.days_since_last_published === null
          ? 'No consta publicación reciente.'
          : `Última publicación hace ${s.days_since_last_published} días.`,
      ),
      compactLine(`Tono: ${toneHint} / Palabras clave: ${keywordHint} / Evitar: ${avoidHint}.`),
    ];
  }

  if (language === 'en') {
    return [
      compactLine(`Business: ${b.business_name} (${b.vertical}) · language ${b.language}.`),
      compactLine(`Today: ${s.due_today_count} posts due. Week: ${s.scheduled_this_week_count} scheduled.`),
      compactLine(`Drafts: ${s.pending_drafts_count} pending and ${s.approved_drafts_count} approved.`),
      compactLine(topSignal ? `Top signal: ${topSignal.title} · ${topSignal.metric}.` : `Active signals: ${signals.active_count}.`),
      compactLine(
        s.days_since_last_published === null
          ? 'No recent publication registered.'
          : `Last publication ${s.days_since_last_published} days ago.`,
      ),
      compactLine(`Voice tone: ${toneHint} / Keywords: ${keywordHint} / Avoid: ${avoidHint}.`),
    ];
  }

  return [
    compactLine(`Negoci: ${b.business_name} (${b.vertical}) · idioma ${b.language}.`),
    compactLine(`Avui: ${s.due_today_count} publicacions pendents. Setmana: ${s.scheduled_this_week_count} programades.`),
    compactLine(`Esborranys: ${s.pending_drafts_count} pendents i ${s.approved_drafts_count} aprovats.`),
    compactLine(topSignal ? `Senyal clau: ${topSignal.title} · ${topSignal.metric}.` : `Senyals actives: ${signals.active_count}.`),
    compactLine(
      s.days_since_last_published === null
        ? 'No consta cap publicació recent.'
        : `Última publicació fa ${s.days_since_last_published} dies.`,
    ),
    compactLine(`To de veu: ${toneHint} / Paraules clau: ${keywordHint} / Evitar: ${avoidHint}.`),
  ];
}

export function buildContextSummary(payload: Omit<LITOPayload, 'context_summary'>): string {
  const language = payload.business_context.language;
  const lines = buildLinesByLanguage({
    language,
    payload,
  }).filter(Boolean);

  const trimmedLines = lines.slice(0, MAX_LINES);
  const wordCount = trimmedLines.join(' ').split(/\s+/).filter(Boolean).length;
  if (wordCount <= MAX_WORDS) {
    return trimmedLines.join('\n');
  }

  return trimWords(trimmedLines.join(' '), MAX_WORDS);
}
