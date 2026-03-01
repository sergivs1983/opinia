import { resolveProvider } from '@/lib/ai/provider';

export type LitoVoiceActionKind = 'gbp_update' | 'social_post' | 'customer_email';
export type LitoVoiceActionStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'executed';
export type LitoVoicePrepareMode = 'record' | 'paste_transcript_only';
export type LitoVoiceUnavailableReason = 'disabled' | 'ok';

type LitoVoiceGbpUpdatePayload = {
  action: 'set_hours' | 'set_status' | 'post_update';
  fields: {
    hours_note?: string;
    temporary_closure?: boolean;
    incident_note?: string;
  };
  human_summary: string;
};

type LitoVoiceSocialPostPayload = {
  channel: 'instagram' | 'tiktok';
  format: 'post' | 'story' | 'reel';
  caption?: string;
  ikea_steps?: string[];
  assets_needed?: string[];
  human_summary: string;
};

type LitoVoiceCustomerEmailPayload = {
  subject?: string;
  body?: string;
  audience: 'recent_customers' | 'all';
  send_mode: 'manual';
  human_summary: string;
};

export type LitoVoiceDraftPayload =
  | LitoVoiceGbpUpdatePayload
  | LitoVoiceSocialPostPayload
  | LitoVoiceCustomerEmailPayload;

export type LitoVoiceDraftSeed = {
  kind: LitoVoiceActionKind;
  payload: LitoVoiceDraftPayload;
};

export type LitoVoiceCapabilities = {
  enabled: boolean;
  reason: LitoVoiceUnavailableReason;
  provider: 'openai' | 'anthropic' | 'none';
  mode: LitoVoicePrepareMode;
  message: string;
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
    const isClosure = includesAny(lower, [/tanquem\b/, /\bcerramos\b/, /\bclosed\b/]);
    const hasIncident = includesAny(lower, [/avaria\b/, /\baver[ii]a\b/, /\bincident\b/]);
    add({
      kind: 'gbp_update',
      payload: {
        action: isClosure ? 'set_status' : 'set_hours',
        fields: {
          hours_note: sliceSentence(text, 140),
          temporary_closure: isClosure,
          incident_note: hasIncident ? 'Revisa incidencies abans de publicar.' : undefined,
        },
        human_summary: 'Sembla que cal actualitzar horaris o estat del negoci.',
      },
    });
  }

  if (includesAny(lower, [
    /story\b/, /post\b/, /reel\b/, /promo\b/, /promocio\b/, /promocion\b/,
    /instagram\b/, /tiktok\b/, /publicar\b/, /publica\b/, /contenido\b/, /xarxes?\b/,
  ])) {
    const format = detectPreferredFormat(lower);
    add({
      kind: 'social_post',
      payload: {
        channel: detectPreferredChannel(lower),
        format,
        caption: sliceSentence(text, 180),
        ikea_steps: format === 'story'
          ? [
            'Defineix una frase gran en pantalla.',
            'Afegeix sticker de pregunta o enquesta.',
            'Tanca amb una CTA curta.',
          ]
          : format === 'reel'
            ? [
              'Ganxo visual als primers 2 segons.',
              'Mostra 3-5 clips curts i clars.',
              'Acaba amb una CTA de comentari.',
            ]
            : [
              'Tria una foto clara del producte o servei.',
              'Escriu caption curt amb benefici principal.',
              'Tanca amb CTA simple.',
            ],
        assets_needed: format === 'reel'
          ? ['Video vertical 9:16', 'Text breu en pantalla', 'CTA final']
          : ['Imatge principal', 'Copy curt', 'CTA visible'],
        human_summary: "S'ha detectat una accio de xarxes socials a partir del transcript.",
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
        subject: 'Actualitzacio important del negoci',
        body: [
          'Context breu del canvi o novetat.',
          'Que ha de fer el client a continuacio.',
          'Canal de contacte per dubtes.',
        ].join('\n'),
        audience: 'recent_customers',
        send_mode: 'manual',
        human_summary: "S'ha detectat un avís per email a clients.",
      },
    });
  }

  if (seeds.length === 0) {
    add({
      kind: 'social_post',
      payload: {
        channel: 'instagram',
        format: 'post',
        caption: sliceSentence(text, 160),
        ikea_steps: [
          'Defineix una idea principal en una frase.',
          'Afegeix una imatge clara i neta.',
          'Tanca amb una pregunta per obtenir resposta.',
        ],
        assets_needed: ['Foto principal', 'CTA de comentari', 'Ubicacio si aplica'],
        human_summary: "No s'ha detectat una intencio clara; es crea un draft social generic.",
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
  lines.push(`Drafts generats: ${params.drafts.length}.`);
  lines.push('Revisa cada accio i decideix: editar, enviar a revisio o confirmar.');
  return lines.join('\n');
}

export function resolveVoiceCapabilities(orgProvider?: string | null): LitoVoiceCapabilities {
  const providerState = resolveProvider({ orgProvider: orgProvider ?? null });
  const manualDisabled = String(process.env.LITO_VOICE_MANUAL_DISABLED || '').toLowerCase() === 'true';
  const recordingEnabled = String(process.env.LITO_VOICE_RECORDING_ENABLED || '').toLowerCase() === 'true';
  const mode: LitoVoicePrepareMode = recordingEnabled && providerState.available
    ? 'record'
    : 'paste_transcript_only';

  if (manualDisabled) {
    return {
      enabled: false,
      reason: 'disabled',
      provider: providerState.available ? providerState.provider : 'none',
      mode: 'paste_transcript_only',
      message: 'LITO Voice desactivat per configuracio.',
    };
  }

  return {
    enabled: true,
    reason: 'ok',
    provider: providerState.available ? providerState.provider : 'none',
    mode,
    message: mode === 'record'
      ? 'LITO Voice disponible en mode gravacio.'
      : 'LITO Voice disponible en mode transcript manual.',
  };
}
