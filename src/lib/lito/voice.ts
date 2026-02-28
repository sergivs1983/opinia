import { resolveProvider } from '@/lib/ai/provider';

export type LitoVoiceActionKind = 'gbp_update' | 'social_post' | 'customer_email';
export type LitoVoiceActionStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'executed';
export type LitoVoiceUnavailableReason = 'missing_api_key' | 'disabled' | 'ok';

export type LitoVoiceAvailability = {
  enabled: boolean;
  reason: LitoVoiceUnavailableReason;
  provider: 'openai' | 'anthropic' | 'none';
  message: string;
};

export type LitoVoiceDraftPayload = {
  title: string;
  summary: string;
  suggested_channel?: 'instagram' | 'tiktok';
  suggested_format?: 'post' | 'story' | 'reel';
  updates?: {
    hours_note?: string;
    temporary_closure?: boolean;
    incident_note?: string;
  };
  email?: {
    subject: string;
    body_outline: string[];
  };
  notes?: string[];
};

export type LitoVoiceDraftSeed = {
  kind: LitoVoiceActionKind;
  payload: LitoVoiceDraftPayload;
};

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sliceSentence(value: string, max = 180): string {
  const compact = compactText(value);
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trimEnd()}...`;
}

function includesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function detectPreferredChannel(value: string): 'instagram' | 'tiktok' {
  const text = value.toLowerCase();
  if (text.includes('tiktok') || text.includes('tik tok')) return 'tiktok';
  return 'instagram';
}

function detectPreferredFormat(value: string): 'post' | 'story' | 'reel' {
  const text = value.toLowerCase();
  if (text.includes('story') || text.includes('historia')) return 'story';
  if (text.includes('reel')) return 'reel';
  return 'post';
}

export function humanizeVoiceDraftKind(kind: LitoVoiceActionKind): string {
  if (kind === 'gbp_update') return 'Actualitzacio GBP';
  if (kind === 'customer_email') return 'Email clients';
  return 'Post social';
}

export function detectVoiceDraftSeeds(transcriptText: string): LitoVoiceDraftSeed[] {
  const text = compactText(transcriptText);
  const lower = text.toLowerCase();
  const seeds: LitoVoiceDraftSeed[] = [];
  const add = (seed: LitoVoiceDraftSeed) => {
    if (!seeds.some((item) => item.kind === seed.kind)) {
      seeds.push(seed);
    }
  };

  if (includesAny(lower, [
    /tanquem\b/, /tancat\b/, /obrim\b/, /horari\b/, /avaria\b/, /vacances\b/,
    /cerramos\b/, /cerrado\b/, /abrimos\b/, /horario\b/, /aver[ii]a\b/, /feriado\b/,
    /\bclosed\b/, /\bopen\b/, /\bhours\b/, /\bholiday\b/,
  ])) {
    add({
      kind: 'gbp_update',
      payload: {
        title: 'Actualitza Google Business Profile',
        summary: 'Sembla que cal actualitzar horaris o estat del negoci.',
        updates: {
          hours_note: sliceSentence(text, 140),
          temporary_closure: includesAny(lower, [/tanquem\b/, /\bcerramos\b/, /\bclosed\b/]),
          incident_note: includesAny(lower, [/avaria\b/, /\baver[ii]a\b/, /\bincident\b/]) ? 'Revisa incidencies abans de publicar.' : undefined,
        },
        notes: [
          'Revisa horari especial i festius.',
          "Confirma la data d'inici i final del canvi.",
        ],
      },
    });
  }

  if (includesAny(lower, [
    /story\b/, /post\b/, /reel\b/, /promo\b/, /promocio\b/, /promocion\b/,
    /instagram\b/, /tiktok\b/, /publicar\b/, /publica\b/, /contenido\b/, /xarxes?\b/,
  ])) {
    add({
      kind: 'social_post',
      payload: {
        title: 'Prepara contingut social',
        summary: "S'ha detectat una accio de xarxes socials a partir del transcript.",
        suggested_channel: detectPreferredChannel(lower),
        suggested_format: detectPreferredFormat(lower),
        notes: [
          'Mantingues el missatge curt i accionable.',
          'Inclou una crida final per comentar o reservar.',
        ],
      },
    });
  }

  if (includesAny(lower, [
    /email\b/, /correo\b/, /mail\b/, /newsletter\b/, /avisar clients?\b/,
    /avisar clientes?\b/, /campanya\b/, /campana\b/,
  ])) {
    add({
      kind: 'customer_email',
      payload: {
        title: 'Prepara email a clients',
        summary: "S'ha detectat un avís per email a clients.",
        email: {
          subject: 'Actualitzacio important del negoci',
          body_outline: [
            'Context breu del canvi o novetat.',
            'Quina accio ha de fer el client.',
            'Canal de contacte per dubtes.',
          ],
        },
        notes: [
          'Evita text massa llarg al primer paragraf.',
          'Inclou termini o data clau si aplica.',
        ],
      },
    });
  }

  if (seeds.length === 0) {
    add({
      kind: 'social_post',
      payload: {
        title: 'Draft social generic',
        summary: "No s'ha detectat una intencio clara; es crea un draft social generic.",
        suggested_channel: 'instagram',
        suggested_format: 'post',
        notes: [
          'Valida objectiu abans de publicar.',
          'Converteix el missatge en una promesa clara al client.',
        ],
      },
    });
  }

  return seeds.slice(0, 3);
}

export function buildVoiceAssistantMessage(params: {
  transcript: string;
  drafts: Array<{ kind: LitoVoiceActionKind; status?: LitoVoiceActionStatus }>;
}): string {
  const summary = sliceSentence(params.transcript, 180);
  const lines: string[] = [
    `Resum: ${summary}`,
    '',
    'Accions proposades:',
  ];

  params.drafts.forEach((draft, index) => {
    lines.push(`${index + 1}) ${humanizeVoiceDraftKind(draft.kind)} (${draft.status || 'draft'})`);
  });

  lines.push('');
  lines.push(`Drafts generats: ${params.drafts.length}`);
  lines.push('Revisa cada draft i decideix: Confirmar, Editar o Cancel·lar.');
  return lines.join('\n');
}

export function resolveVoiceAvailability(orgProvider?: string | null): LitoVoiceAvailability {
  const providerState = resolveProvider({ orgProvider: orgProvider ?? null });
  if (!providerState.available) {
    return {
      enabled: false,
      reason: 'missing_api_key',
      provider: 'none',
      message: 'LITO Voice no esta disponible: falta configurar la clau del provider.',
    };
  }

  return {
    enabled: true,
    reason: 'ok',
    provider: providerState.provider,
    message: 'LITO Voice disponible.',
  };
}
