/**
 * D1.4 Signals → Weekly Recommendations mapper
 *
 * Pure functions — no DB I/O, deterministic output.
 * Maps D1.3 SignalCard[] to recommendation candidates ready for insertion
 * into recommendation_log (source='signal', steps, assets, priority).
 */

import type { SignalCard } from '@/lib/signals/d13';

// ── Public types ───────────────────────────────────────────────────────────────

export type RecoFormat = 'post' | 'story' | 'reel';
export type RecoPriority = 1 | 2 | 3 | 4 | 5;

/** Shape that matches recommendation_log columns for signal-backed rows */
export type RecoCandidate = {
  /** Stable key derived from signal.id — used for dedup in generated_copy */
  signal_id: string;
  format: RecoFormat;
  hook: string;
  idea: string;
  cta: string;
  why: string;
  steps: string[];
  checklist: string[];
  assets_needed: string[];
  time_estimate_min: number;
  /** 1 = highest priority (alerts+high) … 5 = lowest (evergreen) */
  priority: RecoPriority;
  source: 'signal' | 'evergreen';
  /** Persisted to recommendation_log.signal jsonb */
  signal_jsonb: {
    signal_id: string;
    kind: string;
    reason: string;
    metrics_snapshot: Record<string, unknown>;
    day_range: number;
  };
};

type StepsDef = {
  hook: string;
  idea: string;
  cta: string;
  why: string;
  steps: string[];
  checklist: string[];
  assets_needed: string[];
  time_estimate_min: number;
};

// ── Content templates per signal kind ─────────────────────────────────────────

const SIGNAL_STEPS: Record<string, StepsDef> = {
  reputation_drop: {
    hook: 'Resposta proactiva als comentaris recents',
    idea: "Comunica una millora concreta ja aplicada per abordar els comentaris negatius d'aquesta setmana.",
    cta: 'Convida a tornar i a compartir la nova experiència.',
    why: "Respondre públicament als senyals negatius redueix l'impacte i reforça la credibilitat de marca.",
    steps: [
      "Identifica l'àrea de millora principal esmentada en les ressenyes recents.",
      "Defineix una acció concreta ja aplicada (procés, atenció, temps d'espera...).",
      "Redacta un missatge honest i proper en format Story.",
      'Publica i monitoritza les reaccions durant 24h.',
    ],
    checklist: ['Millora verificable', 'To responsable', 'Sense culpabilitzar'],
    assets_needed: ["Story amb text sobre fons neutre", "Foto de l'equip o del local"],
    time_estimate_min: 10,
  },
  inactivity: {
    hook: 'El teu negoci, actiu avui',
    idea: 'Publica un moment real del dia a dia per recordar la teva presència als clients habituals.',
    cta: 'Convida a visitar i a deixar ressenya.',
    why: "La inactivitat redueix la visibilitat local. Un post senzill reactiva l'algorisme.",
    steps: [
      'Captura un moment espontani del servei actual.',
      'Escriu un text curt i directe (2-3 línies).',
      'Afegeix una crida suau a la visita o ressenya.',
      'Publica i etiqueta la ubicació.',
    ],
    checklist: ['Imatge nítida', 'Text breu', 'Etiqueta de lloc'],
    assets_needed: ['Foto o vídeo curt del local en funcionament'],
    time_estimate_min: 8,
  },
  language_shift: {
    hook: 'Parlem el teu idioma',
    idea: "Publica contingut en l'idioma predominant de les teves ressenyes recents per connectar millor.",
    cta: "Convida a escriure l'experiència en qualsevol idioma.",
    why: "Adaptar la comunicació a l'idioma dels clients augmenta la confiança i la conversió.",
    steps: [
      "Identifica la llengua predominant en les ressenyes dels últims 7 dies.",
      'Prepara un post curt en aquella llengua.',
      'Mantén la versió original si escau (bilingüe o separat).',
      "Publica i observa l'engagement.",
    ],
    checklist: ['Idioma correcte', "Text natural (no traduït per màquina)", 'CTA amable'],
    assets_needed: ['Imatge del local o servei', 'Text curt bilingüe opcional'],
    time_estimate_min: 12,
  },
  high_avg: {
    hook: 'Els clients ho han dit tot',
    idea: "Destaca la valoració excel·lent d'aquesta setmana amb una publicació que mostri el que us diferencia.",
    cta: "Convida nous clients a viure l'experiència.",
    why: "Una bona valoració pública és la millor publicitat. Cal amplificar-la amb contingut visual.",
    steps: [
      'Tria una ressenya positiva representativa (sense identificar el client).',
      'Complementa-la amb una imatge del moment destacat.',
      'Escriu un text que reforci el valor diferencial.',
      'Publica en Reel per màxim abast orgànic.',
    ],
    checklist: ['Ressenya autèntica', 'Visual de qualitat', 'Missatge clar'],
    assets_needed: ['Foto o clip de 5-10s del servei o producte destacat'],
    time_estimate_min: 12,
  },
};

const EVERGREEN_STEPS: StepsDef = {
  hook: 'Contingut fresc per a aquesta setmana',
  idea: 'Publica un contingut regular que mostri el millor del teu negoci.',
  cta: 'Convida a visitar i a compartir.',
  why: 'La consistència en la publicació millora la visibilitat orgànica local.',
  steps: [
    'Escull un moment representatiu del servei.',
    'Prepara una peça visual de qualitat.',
    'Escriu un text curt i directe.',
    'Publica i etiqueta la ubicació.',
  ],
  checklist: ['Imatge o vídeo de qualitat', 'Text curt', 'CTA final'],
  assets_needed: ['Foto o vídeo curt del local'],
  time_estimate_min: 10,
};

// ── Priority + format decision ─────────────────────────────────────────────────

/**
 * Format decision:
 *   - alerts (urgency)     → story  (immediate, ephemeral)
 *   - opportunities (grow) → reel   (wide reach)
 *   - evergreen            → post   (social proof, discoverability)
 */
export function signalToFormat(signal: Pick<SignalCard, 'type' | 'severity'>): RecoFormat {
  if (signal.type === 'alert') return 'story';
  if (signal.type === 'opportunity') return 'reel';
  return 'post';
}

/**
 * Priority:  1 = highest … 5 = lowest
 *   alert+high → 1, alert+med → 2, alert+low → 3
 *   opportunity → 4, evergreen → 5
 */
export function signalToPriority(signal: Pick<SignalCard, 'type' | 'severity'>): RecoPriority {
  if (signal.type === 'alert') {
    if (signal.severity === 'high') return 1;
    if (signal.severity === 'med') return 2;
    return 3;
  }
  if (signal.type === 'opportunity') return 4;
  return 5;
}

// ── Core mapper ────────────────────────────────────────────────────────────────

export function signalToCandidate(signal: SignalCard, dayRange = 7): RecoCandidate {
  const tpl = SIGNAL_STEPS[signal.id] ?? EVERGREEN_STEPS;
  const format = signalToFormat(signal);
  const priority = signalToPriority(signal);
  const source: 'signal' | 'evergreen' = signal.type === 'evergreen' ? 'evergreen' : 'signal';

  return {
    signal_id: signal.id,
    format,
    hook: tpl.hook,
    idea: tpl.idea,
    cta: tpl.cta,
    why: tpl.why,
    steps: tpl.steps,
    checklist: tpl.checklist,
    assets_needed: tpl.assets_needed,
    time_estimate_min: tpl.time_estimate_min,
    priority,
    source,
    signal_jsonb: {
      signal_id: signal.id,
      kind: signal.id,
      reason: signal.reason,
      metrics_snapshot: {},
      day_range: dayRange,
    },
  };
}

/** Maps an array of SignalCards sorted by priority (1 = highest first) */
export function signalsToCandidates(signals: SignalCard[], dayRange = 7): RecoCandidate[] {
  return signals
    .map((s) => signalToCandidate(s, dayRange))
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Builds the `generated_copy` jsonb for recommendation_log.
 * Follows the same shape as D0's `RecommendationTemplate` so downstream
 * consumers (workbench, chat) can parse it with `parseTemplateFromGeneratedCopy`.
 */
export function candidateToGeneratedCopy(
  candidate: RecoCandidate,
  baseLang = 'ca',
): Record<string, unknown> {
  return {
    format: candidate.format,
    hook: candidate.hook,
    idea: candidate.idea,
    cta: candidate.cta,
    assets_needed: candidate.assets_needed,
    how_to: {
      why: candidate.why,
      steps: candidate.steps,
      checklist: candidate.checklist,
      assets_needed: candidate.assets_needed,
      time_estimate_min: candidate.time_estimate_min,
    },
    signal: {
      signal_id: candidate.signal_jsonb.signal_id,
      kind: candidate.signal_jsonb.kind,
    },
    language: {
      base_lang: baseLang,
      suggested_lang: baseLang,
      confidence: 'low',
    },
  };
}

/**
 * Build a signal-aware chat bootstrap message.
 * Used by the thread creation endpoint when source='signal'.
 */
export function buildSignalBootstrapMessage(candidate: RecoCandidate): string {
  const { signal_jsonb, format, hook } = candidate;
  const reasonLine = signal_jsonb.reason ? `He detectat: ${signal_jsonb.reason}` : `He detectat una oportunitat important.`;
  const formatLabel = format === 'story' ? 'Story' : format === 'reel' ? 'Reel' : 'Post';
  return [
    reasonLine,
    '',
    `T'he preparat una proposta: ${hook}`,
    '',
    `Vols que la convertim en un ${formatLabel}, una Story o un Reel?`,
  ].join('\n');
}
