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
