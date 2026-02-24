/**
 * Anthropic Provider — raw HTTP call with AbortController timeout.
 * Handles system message extraction (Anthropic API requires separate system field).
 */

import type { LLMRequest, LLMResponse } from '@/lib/llm/provider';

const TIMEOUT_MS = 15_000;

interface AnthropicProviderResponse {
  content?: Array<{ text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export async function callAnthropic(req: LLMRequest): Promise<LLMResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const model = req.model || 'claude-sonnet-4-20250514';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemMsg = req.messages.find(m => m.role === 'system')?.content || '';
  const userMessages = req.messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens ?? 1500,
        system: systemMsg || undefined,
        messages: userMessages.length > 0 ? userMessages : [{ role: 'user', content: '' }],
        temperature: req.temperature ?? 0.7,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as AnthropicProviderResponse;
    const inputTokens = data.usage?.input_tokens;
    const outputTokens = data.usage?.output_tokens;

    return {
      content: data.content?.map((block) => block.text || '').join('') || '',
      provider: 'anthropic',
      model,
      usage:
        typeof inputTokens === 'number' && typeof outputTokens === 'number'
          ? { input_tokens: inputTokens, output_tokens: outputTokens }
          : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}
