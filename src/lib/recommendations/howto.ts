export type RecommendationVertical = 'general' | 'restaurant' | 'hotel';
export type RecommendationFormat = 'post' | 'story' | 'reel';
export type RecommendationChannel = 'instagram' | 'tiktok';
export type RecommendationLocale = 'ca' | 'es' | 'en';

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
  channel: RecommendationChannel;
  locale: RecommendationLocale;
  hook: {
    value?: string;
    fallbackKey: string;
  };
  idea: {
    value?: string;
    fallbackKey: string;
  };
  cta: {
    value?: string;
    fallbackKey: string;
  };
  steps: Array<{
    key: string;
    vars?: Record<string, string | number>;
  }>;
  photo_notes: Array<{
    key: string;
    vars?: Record<string, string | number>;
  }>;
  channel_notes: Array<{
    key: string;
    vars?: Record<string, string | number>;
  }>;
};

type InlineIkeaInput = {
  format?: string | null;
  hook?: string | null;
  idea?: string | null;
  cta?: string | null;
  vertical?: string | null;
  channel?: RecommendationChannel | null;
  locale?: RecommendationLocale | null;
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

function normalizeChannel(value: RecommendationChannel | null | undefined): RecommendationChannel {
  return value === 'tiktok' ? 'tiktok' : 'instagram';
}

function normalizeLocale(value: RecommendationLocale | null | undefined): RecommendationLocale {
  if (value === 'es' || value === 'en') return value;
  return 'ca';
}

function fallbackHookKey(vertical: RecommendationVertical): string {
  return `dashboard.home.recommendations.d0.ikea.fallback.hook.${vertical}`;
}

function fallbackIdeaKey(vertical: RecommendationVertical): string {
  return `dashboard.home.recommendations.d0.ikea.fallback.idea.${vertical}`;
}

function fallbackCtaKey(vertical: RecommendationVertical): string {
  return `dashboard.home.recommendations.d0.ikea.fallback.cta.${vertical}`;
}

function buildInlineSteps(
  format: RecommendationFormat,
  channel: RecommendationChannel,
): Array<{ key: string; vars?: Record<string, string | number> }> {
  if (format === 'story') {
    if (channel === 'tiktok') {
      return [
        { key: 'dashboard.home.recommendations.d0.ikea.steps.story.common.open' },
        { key: 'dashboard.home.recommendations.d0.ikea.steps.story.common.visual' },
        { key: 'dashboard.home.recommendations.d0.ikea.steps.story.tiktok.bigText' },
        { key: 'dashboard.home.recommendations.d0.ikea.steps.story.tiktok.comments' },
        { key: 'dashboard.home.recommendations.d0.ikea.steps.story.common.close' },
      ];
    }

    return [
      { key: 'dashboard.home.recommendations.d0.ikea.steps.story.common.open' },
      { key: 'dashboard.home.recommendations.d0.ikea.steps.story.common.visual' },
      { key: 'dashboard.home.recommendations.d0.ikea.steps.story.instagram.sticker' },
      { key: 'dashboard.home.recommendations.d0.ikea.steps.story.instagram.link' },
      { key: 'dashboard.home.recommendations.d0.ikea.steps.story.common.close' },
    ];
  }

  if (format === 'reel') {
    if (channel === 'tiktok') {
      return [
        { key: 'dashboard.home.recommendations.d0.ikea.steps.reel.tiktok.hook2s' },
        { key: 'dashboard.home.recommendations.d0.ikea.steps.reel.common.action' },
        { key: 'dashboard.home.recommendations.d0.ikea.steps.reel.common.clips' },
        { key: 'dashboard.home.recommendations.d0.ikea.steps.reel.tiktok.onScreenText' },
        { key: 'dashboard.home.recommendations.d0.ikea.steps.reel.tiktok.followCta' },
        { key: 'dashboard.home.recommendations.d0.ikea.steps.reel.common.caption' },
      ];
    }

    return [
      { key: 'dashboard.home.recommendations.d0.ikea.steps.reel.instagram.hook3s' },
      { key: 'dashboard.home.recommendations.d0.ikea.steps.reel.common.action' },
      { key: 'dashboard.home.recommendations.d0.ikea.steps.reel.instagram.music' },
      { key: 'dashboard.home.recommendations.d0.ikea.steps.reel.instagram.text3s' },
      { key: 'dashboard.home.recommendations.d0.ikea.steps.reel.common.caption' },
      { key: 'dashboard.home.recommendations.d0.ikea.steps.reel.common.publish' },
    ];
  }

  if (channel === 'tiktok') {
    return [
      { key: 'dashboard.home.recommendations.d0.ikea.steps.post.common.open' },
      { key: 'dashboard.home.recommendations.d0.ikea.steps.post.tiktok.directLine' },
      { key: 'dashboard.home.recommendations.d0.ikea.steps.post.common.visual' },
      { key: 'dashboard.home.recommendations.d0.ikea.steps.post.tiktok.comments' },
      { key: 'dashboard.home.recommendations.d0.ikea.steps.post.common.close' },
    ];
  }

  return [
    { key: 'dashboard.home.recommendations.d0.ikea.steps.post.common.open' },
    { key: 'dashboard.home.recommendations.d0.ikea.steps.post.common.explain' },
    { key: 'dashboard.home.recommendations.d0.ikea.steps.post.common.visual' },
    { key: 'dashboard.home.recommendations.d0.ikea.steps.post.instagram.location' },
    { key: 'dashboard.home.recommendations.d0.ikea.steps.post.instagram.hashtags' },
  ];
}

function buildPhotoNotes(
  format: RecommendationFormat,
  vertical: RecommendationVertical,
): Array<{ key: string; vars?: Record<string, string | number> }> {
  const notes: Array<{ key: string; vars?: Record<string, string | number> }> = [
    { key: `dashboard.home.recommendations.d0.ikea.photo.${format}.framing` },
    { key: `dashboard.home.recommendations.d0.ikea.photo.${format}.pace` },
    { key: `dashboard.home.recommendations.d0.ikea.photo.vertical.${vertical}` },
  ];
  return notes;
}

function buildChannelNotes(channel: RecommendationChannel): Array<{ key: string }> {
  return [
    { key: `dashboard.home.recommendations.d0.ikea.channelNotes.${channel}.one` },
    { key: `dashboard.home.recommendations.d0.ikea.channelNotes.${channel}.two` },
  ];
}

export function buildInlineIkeaHowTo(input: InlineIkeaInput): InlineIkeaHowTo {
  const format = normalizeFormat(input.format);
  const vertical = normalizeVertical(input.vertical);
  const channel = normalizeChannel(input.channel);
  const locale = normalizeLocale(input.locale);
  const hook = (input.hook || '').trim();
  const idea = (input.idea || '').trim();
  const cta = (input.cta || '').trim();

  return {
    format,
    channel,
    locale,
    hook: {
      value: hook || undefined,
      fallbackKey: fallbackHookKey(vertical),
    },
    idea: {
      value: idea || undefined,
      fallbackKey: fallbackIdeaKey(vertical),
    },
    cta: {
      value: cta || undefined,
      fallbackKey: fallbackCtaKey(vertical),
    },
    steps: buildInlineSteps(format, channel),
    photo_notes: buildPhotoNotes(format, vertical),
    channel_notes: buildChannelNotes(channel),
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
