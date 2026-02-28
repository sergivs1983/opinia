import {
  ensureTemplateOrFallback,
  parseTemplateFromGeneratedCopy,
  type RecommendationTemplate,
  type RecommendationSignalMeta,
} from '@/lib/recommendations/d0';

export type IkeaVertical = 'general' | 'restaurant' | 'hotel';
export type IkeaFormat = 'post' | 'story' | 'reel';
export type CopyRefineMode = 'shorter' | 'funny' | 'formal' | 'translate_es' | 'translate_en';

export type IkeaPayload = {
  format: IkeaFormat;
  steps: string[];
  director_notes: string[];
  copy_short: string;
  copy_long: string;
  hashtags: string[];
  assets_needed: string[];
};

type BuildInput = {
  templateRaw: unknown;
  generatedCopyRaw: string | null;
  vertical: IkeaVertical;
  signal?: RecommendationSignalMeta;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFormat(value: unknown): IkeaFormat {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'story' || normalized === 'reel') return normalized;
  return 'post';
}

function uniq(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.trim().length > 0))];
}

function withMaxLength(input: string, max: number): string {
  const value = input.trim();
  if (value.length <= max) return value;
  const sliced = value.slice(0, max);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace <= 50) return `${sliced.trim()}…`;
  return `${sliced.slice(0, lastSpace).trim()}…`;
}

function defaultSteps(format: IkeaFormat, hook: string, idea: string, cta: string): string[] {
  if (format === 'story') {
    return [
      `Obre amb una frase gran: ${hook}`,
      `Afegeix 1 imatge o vídeo curt que mostri ${idea.toLowerCase()}.`,
      'Posa un sticker de pregunta o enquesta per activar resposta.',
      `Tanca l’story amb CTA: ${cta}`,
      'Publica i revisa respostes en les properes 2 hores.',
    ];
  }
  if (format === 'reel') {
    return [
      `0-3s: hook en pantalla (${hook}).`,
      `3-10s: mostra l’acció principal (${idea.toLowerCase()}).`,
      'Afegeix text curt en vídeo perquè s’entengui sense so.',
      'Selecciona música coherent amb el to del negoci.',
      `Caption final amb CTA: ${cta}`,
      'Publica en horari de màxima activitat del teu local.',
    ];
  }
  return [
    `Obre el post amb el hook: ${hook}`,
    `Desenvolupa la idea en 2-3 frases: ${idea}`,
    'Inclou una prova visual real del negoci (sense stock).',
    `Acaba amb CTA concret: ${cta}`,
    'Afegeix ubicació i publica en l’horari de més resposta.',
  ];
}

function defaultDirectorNotes(format: IkeaFormat, vertical: IkeaVertical): string[] {
  const verticalNote = vertical === 'restaurant'
    ? 'Prioritza plans curts de plats i equip en acció.'
    : vertical === 'hotel'
      ? 'Mostra espais amb llum natural i ordre visual.'
      : 'Mostra persones reals i el resultat del servei.';

  if (format === 'story') {
    return [
      'Text gran, màxim 8-10 paraules per story.',
      'Mantén contrast alt perquè es llegeixi ràpid.',
      verticalNote,
      'Usa una sola idea per story (evita saturar).',
    ];
  }
  if (format === 'reel') {
    return [
      'Primer pla potent en els 3 primers segons.',
      'Durada recomanada: 12-20 segons.',
      verticalNote,
      'Transicions simples; el missatge és més important que l’efecte.',
    ];
  }
  return [
    'Foto principal clara i amb punt focal únic.',
    'Evita blocs llargs de text; màxim 3 línies inicials.',
    verticalNote,
    'Mantén coherència de colors amb la marca.',
  ];
}

function defaultAssets(format: IkeaFormat, vertical: IkeaVertical): string[] {
  if (format === 'story') {
    return uniq([
      '1 captura vertical del local o servei',
      'Text curt en sobreimpressió',
      vertical === 'restaurant' ? 'Detall de plat o cuina' : '',
      vertical === 'hotel' ? 'Detall d’habitació o recepció' : '',
    ]);
  }
  if (format === 'reel') {
    return uniq([
      '3 clips verticals curts',
      'Música sense copyright',
      'Text subtítols simple',
      vertical === 'restaurant' ? 'Clip de preparació' : '',
      vertical === 'hotel' ? 'Clip de check-in o espai comú' : '',
    ]);
  }
  return uniq([
    '1 foto principal real',
    '1 foto de suport o detall',
    'Text curt (hook + CTA)',
    vertical === 'restaurant' ? 'Foto de plat estrella' : '',
    vertical === 'hotel' ? 'Foto d’espai destacat' : '',
  ]);
}

function buildHashtags(vertical: IkeaVertical, format: IkeaFormat, keyword?: string): string[] {
  const base = ['#OpinIA', '#Ressenyes', '#NegociLocal'];
  const byVertical = vertical === 'restaurant'
    ? ['#Restaurant', '#Gastronomia', '#CuinaLocal']
    : vertical === 'hotel'
      ? ['#Hotel', '#Hospitalitat', '#Travel']
      : ['#ServeiLocal', '#Confiança', '#Pime'];
  const byFormat = format === 'reel' ? ['#Reel'] : format === 'story' ? ['#Story'] : ['#Post'];
  const keywordTag = keyword ? [`#${keyword.replace(/\s+/g, '')}`] : [];
  return uniq([...keywordTag, ...base, ...byVertical, ...byFormat]).slice(0, 8);
}

function normalizeTemplate(input: BuildInput): RecommendationTemplate {
  const fromGenerated = parseTemplateFromGeneratedCopy(input.generatedCopyRaw);
  if (fromGenerated) return fromGenerated;
  return ensureTemplateOrFallback(input.templateRaw);
}

export function buildIkeaPayload(input: BuildInput): IkeaPayload {
  const template = normalizeTemplate(input);
  const format = normalizeFormat(template.format);
  const keyword = asString(input.signal?.keyword);
  const assetsNeeded = template.assets_needed.length > 0
    ? template.assets_needed
    : defaultAssets(format, input.vertical);

  const steps = template.how_to?.steps?.length
    ? template.how_to.steps.slice(0, 9)
    : defaultSteps(format, template.hook, template.idea, template.cta);

  const directorNotes = defaultDirectorNotes(format, input.vertical);

  const copyShortBase = `${template.hook}. ${template.cta}`;
  const copyLongBase = `${template.hook}\n\n${template.idea}\n\n${template.cta}`;

  return {
    format,
    steps,
    director_notes: directorNotes,
    copy_short: withMaxLength(copyShortBase, 120),
    copy_long: withMaxLength(copyLongBase, 500),
    hashtags: buildHashtags(input.vertical, format, keyword || undefined),
    assets_needed: uniq(assetsNeeded),
  };
}

function toFunny(text: string): string {
  if (!text) return text;
  if (text.includes('😄')) return text;
  return `${text} 😄`;
}

function toFormal(text: string): string {
  return text
    .replace(/\bgràcies\b/gi, 'moltes gràcies')
    .replace(/\bhola\b/gi, 'bon dia')
    .replace(/\bens encanta\b/gi, 'ens complau')
    .replace(/\s+😄/g, '')
    .trim();
}

function translatePrefix(text: string, locale: 'es' | 'en'): string {
  if (!text) return text;
  const prefix = locale === 'es' ? 'Versión ES: ' : 'EN version: ';
  if (text.startsWith(prefix)) return text;
  return `${prefix}${text}`;
}

export function refineIkeaCopy(input: {
  currentShort: string;
  currentLong: string;
  currentHashtags: string[];
  mode: CopyRefineMode;
}): { copy_short: string; copy_long: string; hashtags: string[] } {
  let nextShort = input.currentShort;
  let nextLong = input.currentLong;
  let nextTags = [...input.currentHashtags];

  switch (input.mode) {
    case 'shorter':
      nextShort = withMaxLength(nextShort, 90);
      nextLong = withMaxLength(nextLong, 320);
      break;
    case 'funny':
      nextShort = withMaxLength(toFunny(nextShort), 120);
      nextLong = withMaxLength(toFunny(nextLong), 500);
      if (!nextTags.includes('#BonRotllo')) nextTags.push('#BonRotllo');
      break;
    case 'formal':
      nextShort = withMaxLength(toFormal(nextShort), 120);
      nextLong = withMaxLength(toFormal(nextLong), 500);
      nextTags = nextTags.filter((tag) => tag !== '#BonRotllo');
      break;
    case 'translate_es':
      nextShort = withMaxLength(translatePrefix(nextShort, 'es'), 120);
      nextLong = withMaxLength(translatePrefix(nextLong, 'es'), 500);
      if (!nextTags.includes('#ES')) nextTags.push('#ES');
      break;
    case 'translate_en':
      nextShort = withMaxLength(translatePrefix(nextShort, 'en'), 120);
      nextLong = withMaxLength(translatePrefix(nextLong, 'en'), 500);
      if (!nextTags.includes('#EN')) nextTags.push('#EN');
      break;
    default:
      break;
  }

  return {
    copy_short: nextShort.trim(),
    copy_long: nextLong.trim(),
    hashtags: uniq(nextTags).slice(0, 8),
  };
}
