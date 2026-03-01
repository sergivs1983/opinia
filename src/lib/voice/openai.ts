import crypto from 'node:crypto';

import { redactPII } from '@/lib/api-handler';

const OPENAI_API_URL = 'https://api.openai.com/v1';
const DEFAULT_STT_MODEL = 'whisper-1';
const DEFAULT_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const FALLBACK_TTS_MODEL = 'tts-1';
const DEFAULT_TTS_VOICE = 'alloy';
const DEFAULT_TTS_FORMAT = 'mp3';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB

export type VoiceProviderUnavailableReason = 'missing_api_key';

export class VoiceProviderUnavailableError extends Error {
  reason: VoiceProviderUnavailableReason;

  constructor(reason: VoiceProviderUnavailableReason, message: string) {
    super(message);
    this.name = 'VoiceProviderUnavailableError';
    this.reason = reason;
  }
}

export type WhisperTranscribeResult = {
  transcript: string;
  language?: string;
  model: string;
};

export type TTSResult = {
  model: string;
  voice: string;
  format: string;
  mimeType: string;
  audioBase64: string;
};

function requireOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key.trim()) {
    throw new VoiceProviderUnavailableError(
      'missing_api_key',
      "Falta configurar la clau d'IA.",
    );
  }
  return key.trim();
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clampText(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max).trimEnd();
}

function extractOpenAIErrorSnippet(raw: string): string {
  const compact = raw.replace(/\s+/g, ' ').trim();
  return compact.slice(0, 280);
}

function normalizeMimeType(contentType: string | null): string {
  const fallback = 'audio/mpeg';
  if (!contentType) return fallback;
  const normalized = contentType.toLowerCase().split(';')[0].trim();
  if (!normalized) return fallback;
  return normalized;
}

async function doTTSRequest(params: {
  apiKey: string;
  model: string;
  voice: string;
  format: string;
  input: string;
}): Promise<TTSResult> {
  const response = await fetch(`${OPENAI_API_URL}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      voice: params.voice,
      format: params.format,
      input: params.input,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`openai_tts_${response.status}:${extractOpenAIErrorSnippet(body)}`);
  }

  const bytes = await response.arrayBuffer();
  const base64 = Buffer.from(bytes).toString('base64');
  return {
    model: params.model,
    voice: params.voice,
    format: params.format,
    mimeType: normalizeMimeType(response.headers.get('content-type')),
    audioBase64: base64,
  };
}

export function sanitizeVoiceTranscript(input: string): string {
  return clampText(compactText(redactPII(input || '')), 4000);
}

export function normalizeVoiceTextForTTS(input: string): string {
  return clampText(compactText(redactPII(input || '')), 2000);
}

export function validateAudioUpload(file: File, durationSeconds?: number): { ok: true } | { ok: false; reason: string } {
  if (!file) return { ok: false, reason: 'missing_audio' };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, reason: 'empty_audio' };
  if (file.size > MAX_AUDIO_BYTES) return { ok: false, reason: 'audio_too_large' };
  if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 120) {
    return { ok: false, reason: 'audio_too_long' };
  }
  return { ok: true };
}

export async function transcribeWithWhisper(params: {
  file: Blob | File;
  fileName?: string;
  language?: string;
  prompt?: string;
}): Promise<WhisperTranscribeResult> {
  const apiKey = requireOpenAIKey();

  const formData = new FormData();
  formData.append('model', DEFAULT_STT_MODEL);
  formData.append('file', params.file, params.fileName || 'voice.webm');
  if (params.language?.trim()) formData.append('language', params.language.trim());
  if (params.prompt?.trim()) formData.append('prompt', clampText(params.prompt.trim(), 500));

  const response = await fetch(`${OPENAI_API_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`openai_stt_${response.status}:${extractOpenAIErrorSnippet(body)}`);
  }

  const json = await response.json().catch(() => ({})) as { text?: string; language?: string };
  const transcript = sanitizeVoiceTranscript(typeof json.text === 'string' ? json.text : '');
  if (!transcript) {
    throw new Error('openai_stt_empty_transcript');
  }

  return {
    transcript,
    language: typeof json.language === 'string' ? json.language : undefined,
    model: DEFAULT_STT_MODEL,
  };
}

export async function synthesizeWithOpenAITTS(params: {
  text: string;
  voice?: string;
  format?: 'mp3' | 'wav' | 'flac' | 'aac' | 'opus' | 'pcm';
}): Promise<TTSResult> {
  const apiKey = requireOpenAIKey();
  const normalizedText = normalizeVoiceTextForTTS(params.text);
  if (!normalizedText) {
    throw new Error('tts_empty_text');
  }

  const voice = (params.voice || DEFAULT_TTS_VOICE).trim() || DEFAULT_TTS_VOICE;
  const format = params.format || DEFAULT_TTS_FORMAT;

  try {
    return await doTTSRequest({
      apiKey,
      model: DEFAULT_TTS_MODEL,
      voice,
      format,
      input: normalizedText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const shouldFallback = DEFAULT_TTS_MODEL !== FALLBACK_TTS_MODEL
      && (message.includes('openai_tts_400') || message.includes('openai_tts_404'));
    if (!shouldFallback) throw error;
    return doTTSRequest({
      apiKey,
      model: FALLBACK_TTS_MODEL,
      voice,
      format,
      input: normalizedText,
    });
  }
}

export function buildTTSAudioDataUrl(params: { mimeType: string; audioBase64: string }): string {
  return `data:${params.mimeType};base64,${params.audioBase64}`;
}

export function buildTTSFingerprint(params: {
  messageId: string;
  text: string;
  lang: string;
  voice: string;
}): string {
  const source = [
    params.messageId,
    normalizeVoiceTextForTTS(params.text).toLowerCase(),
    (params.lang || 'ca').trim().toLowerCase(),
    (params.voice || DEFAULT_TTS_VOICE).trim().toLowerCase(),
  ].join('|');
  return crypto.createHash('sha256').update(source).digest('hex');
}
