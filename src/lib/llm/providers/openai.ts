/**
 * OpenAI Provider — raw HTTP call with AbortController timeout.
 */

import type { LLMRequest, LLMResponse } from '@/lib/llm/provider';

const TIMEOUT_MS = 15_000;

export async function callOpenAI(req: LLMRequest): Promise<LLMResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const model = req.model || 'gpt-4o';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 1500,
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    return {
      content: data.choices?.[0]?.message?.content || '',
      provider: 'openai',
      model,
      usage: data.usage
        ? { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens }
        : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}
