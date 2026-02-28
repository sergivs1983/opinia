export type RecommendationVertical = 'general' | 'restaurant' | 'hotel';
export type RecommendationFormat = 'post' | 'story' | 'reel';

export type HowToGuide = {
  objective: string;
  eta_minutes: 5 | 10 | 15 | 30;
  checklist: string[];
  script: {
    hook: string;
    bullets: string[];
    cta: string;
  };
  shotlist: string[];
  pitfalls: string[];
  caption_tips?: string[];
};

export type InlineIkeaHowTo = {
  format: RecommendationFormat;
  steps: string[];
  photo_notes: string[];
};

type InlineIkeaInput = {
  format?: string | null;
  hook?: string | null;
  idea?: string | null;
  cta?: string | null;
  vertical?: string | null;
};

type BuildHowToInput = {
  vertical: RecommendationVertical;
  format: RecommendationFormat;
  trigger_type: string;
  template: {
    hook: string;
    idea: string;
    cta: string;
    format: RecommendationFormat;
  };
};

function baseObjective(vertical: RecommendationVertical): string {
  if (vertical === 'restaurant') return 'Mostrar el valor real del teu local per generar noves reserves.';
  if (vertical === 'hotel') return 'Convertir interès en reserves amb una peça clara i útil.';
  return 'Crear una publicació clara que augmenti confiança i acció.';
}

function buildChecklist(format: RecommendationFormat): string[] {
  if (format === 'story') {
    return [
      'Defineix una sola idea principal.',
      'Prepara una imatge o vídeo vertical net.',
      'Posa un titular gran i llegible.',
      'Afegeix sticker (pregunta o enquesta).',
      'Tanca amb CTA curt.',
    ];
  }
  if (format === 'reel') {
    return [
      'Grava un ganxo visual de 0-3s.',
      'Afegeix 3-5 clips curts.',
      'Inclou text inicial amb la promesa.',
      'Mantén ritme àgil i àudio net.',
      'Tanca amb CTA a caption.',
      'Publica amb hashtags coherents.',
    ];
  }
  return [
    'Escull foto/carrusel principal.',
    'Escriu hook en la primera línia.',
    'Afegeix 3 punts de valor.',
    'Inclou ubicació/context real.',
    'Tanca amb CTA accionable.',
  ];
}

function normalizeFormat(value: string | null | undefined): RecommendationFormat {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'story' || normalized === 'reel') return normalized;
  return 'post';
}

function normalizeVertical(value: string | null | undefined): RecommendationVertical {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'restaurant' || normalized === 'hotel') return normalized;
  return 'general';
}

function fallbackHook(vertical: RecommendationVertical): string {
  if (vertical === 'restaurant') return 'Aquest cap de setmana et proposem un pla amb sabor local';
  if (vertical === 'hotel') return 'Un racó del teu allotjament que la gent ha de conèixer';
  return 'Una escena real del teu negoci que genera confiança';
}

function fallbackIdea(vertical: RecommendationVertical): string {
  if (vertical === 'restaurant') return 'Mostra un plat estrella i el moment de servei a sala';
  if (vertical === 'hotel') return 'Ensenya un detall de l’habitació i una experiència del client';
  return 'Ensenya un resultat concret del teu servei amb una situació real';
}

function fallbackCta(vertical: RecommendationVertical): string {
  if (vertical === 'restaurant') return 'Reserva taula i vine a tastar-ho aquesta setmana';
  if (vertical === 'hotel') return 'Consulta disponibilitat i planifica la teva estada';
  return 'Contacta’ns i t’ajudem a trobar la millor opció';
}

function buildInlineSteps(
  format: RecommendationFormat,
  hook: string,
  idea: string,
  cta: string,
): string[] {
  if (format === 'story') {
    return [
      `Story 1: obre amb el titular: “${hook}”.`,
      `Story 2: mostra una prova visual real de: ${idea}.`,
      'Afegeix text gran i llegible (màx. 8 paraules per pantalla).',
      'Posa un sticker (pregunta/enquesta) per activar respostes.',
      `Tanca amb una CTA clara: ${cta}.`,
    ];
  }

  if (format === 'reel') {
    return [
      `0-3s: obre amb hook a pantalla: “${hook}”.`,
      `3-10s: mostra l’acció principal: ${idea}.`,
      'Grava 3-5 clips curts verticals amb ritme àgil.',
      'Afegeix text inicial i subtítols curts per entendre-ho sense so.',
      `Caption final amb CTA: ${cta}.`,
      'Publica en una franja amb activitat alta del teu públic.',
    ];
  }

  return [
    `Obre el copy amb el hook: “${hook}”.`,
    `Explica la idea en 2-3 línies: ${idea}.`,
    'Afegeix una foto/carrusel real del negoci (no stock).',
    'Inclou ubicació i context perquè sigui accionable.',
    `Tanca amb una CTA concreta: ${cta}.`,
  ];
}

function buildPhotoNotes(format: RecommendationFormat, vertical: RecommendationVertical): string[] {
  const verticalTip = vertical === 'restaurant'
    ? 'Prioritza primers plans de plats i mans en acció.'
    : vertical === 'hotel'
      ? 'Prioritza espais ordenats amb llum natural i profunditat.'
      : 'Prioritza cares reals, equip i resultat final del servei.';

  if (format === 'story') {
    return [
      'Format vertical 9:16 i contrast alt per llegibilitat.',
      verticalTip,
      'Una idea per story, sense saturar text ni adhesius.',
    ];
  }

  if (format === 'reel') {
    return [
      'Primer pla potent als 2-3 primers segons.',
      'Moviments simples i estables (evita plans massa llargs).',
      verticalTip,
    ];
  }

  return [
    'Tria una foto hero amb punt focal clar.',
    verticalTip,
    'Mantén la paleta de colors coherent amb la marca.',
  ];
}

export function buildInlineIkeaHowTo(input: InlineIkeaInput): InlineIkeaHowTo {
  const format = normalizeFormat(input.format);
  const vertical = normalizeVertical(input.vertical);

  const hook = (input.hook || '').trim() || fallbackHook(vertical);
  const idea = (input.idea || '').trim() || fallbackIdea(vertical);
  const cta = (input.cta || '').trim() || fallbackCta(vertical);

  return {
    format,
    steps: buildInlineSteps(format, hook, idea, cta),
    photo_notes: buildPhotoNotes(format, vertical),
  };
}

function buildShotlist(format: RecommendationFormat): string[] {
  if (format === 'story') return ['Pla 1: titular', 'Pla 2: prova visual', 'Pla 3: CTA + sticker'];
  if (format === 'reel') return ['Pla 1: ganxo', 'Pla 2: detall producte/servei', 'Pla 3: prova social', 'Pla 4: CTA'];
  return ['Foto 1: hero', 'Foto 2: detall', 'Foto 3: context/equip'];
}

export function buildHowToGuide(input: BuildHowToInput): HowToGuide {
  const bullets = [input.template.idea, 'Fes-ho específic i visual', 'Acaba amb acció clara'];
  return {
    objective: baseObjective(input.vertical),
    eta_minutes: input.format === 'reel' ? 15 : 10,
    checklist: buildChecklist(input.format),
    script: {
      hook: input.template.hook,
      bullets,
      cta: input.template.cta,
    },
    shotlist: buildShotlist(input.format),
    pitfalls: [
      'No intentis explicar-ho tot en una sola peça.',
      'Evita text massa llarg al primer impacte.',
      'No publiquis sense CTA clar.',
    ],
    caption_tips: ['Primera línia forta.', 'Una idea, una acció.', 'Hashtags rellevants i curts.'],
  };
}
