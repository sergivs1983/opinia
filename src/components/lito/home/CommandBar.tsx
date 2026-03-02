'use client';

import { useCallback, useState } from 'react';

import type { ActionCard, ActionCardMode } from '@/types/lito-cards';

type CommandPanelState = {
  loading: boolean;
  text: string;
  error: string | null;
};

export type OrchestratorSafeJsonEvent = {
  greeting: string;
  priority_message: string;
  next_question: string;
  selected_card_ids: string[];
  cards_final: ActionCard[];
  queue_count?: number;
  mode?: ActionCardMode;
};

type CommandBarProps = {
  bizId: string | null;
  placeholder: string;
  sendLabel: string;
  micLabel: string;
  value: string;
  mode?: 'chat' | 'orchestrator_safe';
  missingBizLabel: string;
  fallbackErrorLabel: string;
  onChange: (value: string) => void;
  onMic: () => void;
  onPanelStateChange: (next: CommandPanelState) => void;
  onOrchestratorJson?: (payload: OrchestratorSafeJsonEvent) => void;
};

function createClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function extractErrorMessage(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  const message = record.message;
  const code = record.code;
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (typeof code === 'string' && code.trim()) return code.trim();
  return '';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeOrchestratorIntent(message: string): boolean {
  const normalized = message.toLowerCase().trim();
  const patterns = [
    'què toca avui',
    'que toca avui',
    'resum del dia',
    'què he de fer avui',
    'que he de fer avui',
    'resumen del día',
    'resumen del dia',
    'qué toca hoy',
    'que toca hoy',
    'what should i do today',
    'what is due today',
    'daily summary',
  ];
  return patterns.some((pattern) => normalized.includes(pattern));
}

function parseOrchestratorJson(input: unknown): OrchestratorSafeJsonEvent | null {
  if (!isObject(input)) return null;
  const greeting = typeof input.greeting === 'string' ? input.greeting.trim() : '';
  const priority = typeof input.priority_message === 'string' ? input.priority_message.trim() : '';
  const nextQuestion = typeof input.next_question === 'string' ? input.next_question.trim() : '';
  const cards = Array.isArray(input.cards_final) ? input.cards_final as ActionCard[] : [];
  const selectedIds = Array.isArray(input.selected_card_ids)
    ? input.selected_card_ids.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  if (!greeting || !priority || !nextQuestion) return null;
  if (!Array.isArray(cards)) return null;
  return {
    greeting,
    priority_message: priority,
    next_question: nextQuestion,
    cards_final: cards,
    selected_card_ids: selectedIds,
    queue_count: typeof input.queue_count === 'number' ? input.queue_count : undefined,
    mode: input.mode === 'advanced' ? 'advanced' : 'basic',
  };
}

export default function CommandBar({
  bizId,
  placeholder,
  sendLabel,
  micLabel,
  value,
  mode = 'chat',
  missingBizLabel,
  fallbackErrorLabel,
  onChange,
  onMic,
  onPanelStateChange,
  onOrchestratorJson,
}: CommandBarProps) {
  const [submitting, setSubmitting] = useState(false);

  const readEventStream = useCallback(async (response: Response): Promise<string> => {
    const stream = response.body;
    if (!stream) return '';

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;

      buffer += decoder.decode(chunk, { stream: true });

      let delimiter = buffer.indexOf('\n\n');
      while (delimiter >= 0) {
        const raw = buffer.slice(0, delimiter);
        buffer = buffer.slice(delimiter + 2);

        const lines = raw.split(/\r?\n/).filter(Boolean);
        let eventName = 'message';
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim() || 'message';
            continue;
          }
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }

        const rawData = dataLines.join('\n');
        if (!rawData) {
          delimiter = buffer.indexOf('\n\n');
          continue;
        }

        let parsed: unknown = null;
        try {
          parsed = JSON.parse(rawData);
        } catch {
          parsed = null;
        }

        if (eventName === 'token') {
          const delta = (parsed as { delta?: unknown } | null)?.delta;
          if (typeof delta === 'string' && delta.length > 0) {
            fullText += delta;
            onPanelStateChange({
              loading: true,
              text: fullText,
              error: null,
            });
          }
        } else if (eventName === 'json') {
          const parsedJson = parseOrchestratorJson(parsed);
          if (parsedJson) {
            fullText = `${parsedJson.priority_message}\n${parsedJson.next_question}`;
            onOrchestratorJson?.(parsedJson);
            onPanelStateChange({
              loading: false,
              text: fullText,
              error: null,
            });
          }
        } else if (eventName === 'done') {
          const finalText = (parsed as { text?: unknown } | null)?.text;
          if (typeof finalText === 'string' && finalText.trim().length > 0) {
            fullText = finalText;
          }
          onPanelStateChange({
            loading: false,
            text: fullText,
            error: null,
          });
        } else if (eventName === 'error') {
          const message = extractErrorMessage(parsed) || fallbackErrorLabel;
          onPanelStateChange({
            loading: false,
            text: fullText,
            error: message,
          });
          throw new Error(message);
        }

        delimiter = buffer.indexOf('\n\n');
      }
    }

    return fullText;
  }, [fallbackErrorLabel, onOrchestratorJson, onPanelStateChange]);

  const submitToChat = useCallback(async () => {
    const message = value.trim();
    if (!message || submitting) return;

    if (!bizId) {
      onPanelStateChange({
        loading: false,
        text: '',
        error: missingBizLabel,
      });
      return;
    }

    setSubmitting(true);
    onPanelStateChange({
      loading: true,
      text: '',
      error: null,
    });

    try {
      const resolvedMode = looksLikeOrchestratorIntent(message) ? 'orchestrator_safe' : mode;
      const response = await fetch('/api/lito/chat', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'x-request-id': createClientRequestId(),
        },
        body: JSON.stringify({
          biz_id: bizId,
          message,
          mode: resolvedMode,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const messageFromApi = extractErrorMessage(payload);
        throw new Error(messageFromApi || fallbackErrorLabel);
      }

      await readEventStream(response);
      onChange('');
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : fallbackErrorLabel;
      onPanelStateChange({
        loading: false,
        text: '',
        error: message,
      });
    } finally {
      setSubmitting(false);
    }
  }, [value, submitting, bizId, onPanelStateChange, missingBizLabel, mode, fallbackErrorLabel, readEventStream, onChange]);

  const canSubmit = value.trim().length > 0 && !submitting;

  return (
    <div className="lito-command-bar-wrap">
      <div className="lito-command-bar" role="search">
        <input
          type="text"
          value={value}
          className="lito-command-input"
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submitToChat();
            }
          }}
        />

        <button type="button" className="lito-command-mic" aria-label={micLabel} onClick={onMic}>
          <span aria-hidden="true">🎙</span>
        </button>

        <button
          type="button"
          className="lito-command-send"
          onClick={() => void submitToChat()}
          disabled={!canSubmit}
        >
          {submitting ? '...' : sendLabel}
        </button>
      </div>
    </div>
  );
}
