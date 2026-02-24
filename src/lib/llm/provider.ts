/**
 * LLM Provider Abstraction for OpinIA.
 * Supports: openai, anthropic.
 * Features: timeout (15s), 1 retry with 2s backoff, provider fallback.
 */

export type LLMProvider = 'openai' | 'anthropic';

export interface LLMRequest {
  provider: LLMProvider;
  model?: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;       // hint for JSON response
}

export interface LLMResponse {
  content: string;
  provider: LLMProvider;
  model: string;
  usage?: { input_tokens: number; output_tokens: number };
}

const DEFAULTS: Record<LLMProvider, { model_fast: string; model_main: string }> = {
  openai: { model_fast: 'gpt-4o-mini', model_main: 'gpt-4o' },
  anthropic: { model_fast: 'claude-sonnet-4-20250514', model_main: 'claude-sonnet-4-20250514' },
};

const TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 2_000;

interface OpenAIChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface AnthropicMessageResponse {
  content?: Array<{ text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ============================================================
// MAIN CALL FUNCTION
// ============================================================
export async function callLLM(req: LLMRequest): Promise<LLMResponse> {
  const provider = req.provider;
  const callFn = provider === 'anthropic' ? callAnthropic : callOpenAI;

  // Attempt 1
  try {
    return await callFn(req);
  } catch (err: unknown) {
    // Retry once with backoff
    console.warn(`[llm] ${provider} attempt 1 failed: ${getErrorMessage(err)}. Retrying in ${RETRY_DELAY_MS}ms...`);
    await sleep(RETRY_DELAY_MS);

    try {
      return await callFn(req);
    } catch (retryErr: unknown) {
      throw new Error(`[llm] ${provider} failed after retry: ${getErrorMessage(retryErr)}`);
    }
  }
}

/**
 * Call with fallback: try provider A, if fails try provider B.
 */
export async function callLLMWithFallback(
  req: LLMRequest,
  fallbackProvider: LLMProvider
): Promise<LLMResponse> {
  try {
    return await callLLM(req);
  } catch (err: unknown) {
    console.warn(`[llm] Primary ${req.provider} failed, falling back to ${fallbackProvider}: ${getErrorMessage(err)}`);
    return await callLLM({ ...req, provider: fallbackProvider, model: undefined });
  }
}

/**
 * Get default model for a provider and tier.
 */
export function getDefaultModel(provider: LLMProvider, tier: 'fast' | 'main'): string {
  return tier === 'fast' ? DEFAULTS[provider].model_fast : DEFAULTS[provider].model_main;
}

// ============================================================
// OPENAI IMPLEMENTATION
// ============================================================
async function callOpenAI(req: LLMRequest): Promise<LLMResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const model = req.model || DEFAULTS.openai.model_main;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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
      const errBody = await res.text().catch(() => 'unknown');
      throw new Error(`OpenAI ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = (await res.json()) as OpenAIChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content || '';

    const inputTokens = data.usage?.prompt_tokens;
    const outputTokens = data.usage?.completion_tokens;

    return {
      content,
      provider: 'openai',
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

// ============================================================
// ANTHROPIC IMPLEMENTATION
// ============================================================
async function callAnthropic(req: LLMRequest): Promise<LLMResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const model = req.model || DEFAULTS.anthropic.model_main;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // Convert messages: Anthropic uses system separately
  const systemMsg = req.messages.find(m => m.role === 'system')?.content || '';
  const userMessages = req.messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

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
      const errBody = await res.text().catch(() => 'unknown');
      throw new Error(`Anthropic ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = (await res.json()) as AnthropicMessageResponse;
    const content = data.content?.map((block) => block.text || '').join('') || '';

    const inputTokens = data.usage?.input_tokens;
    const outputTokens = data.usage?.output_tokens;

    return {
      content,
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
