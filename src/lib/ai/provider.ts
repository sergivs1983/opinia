import { getDefaultModel, type LLMProvider } from '@/lib/llm/provider';

export type AIProvider = LLMProvider;

export type AIProviderState = {
  provider: AIProvider;
  model: string;
  available: boolean;
  reason?: string;
};

const SUPPORTED: AIProvider[] = ['openai', 'anthropic'];

function normalizeProvider(input: string | null | undefined): AIProvider {
  const normalized = (input || '').trim().toLowerCase();
  if (normalized === 'anthropic') return 'anthropic';
  return 'openai';
}

export function getConfiguredAIProvider(): AIProvider {
  return normalizeProvider(process.env.IA_PROVIDER || process.env.AI_PROVIDER || 'openai');
}

export function getProviderModel(provider: AIProvider, override?: string | null): string {
  const explicit = (override || process.env.DEFAULT_MODEL || '').trim();
  if (explicit.length > 0) return explicit;
  if (provider === 'openai') return 'gpt-4o-mini';
  return getDefaultModel(provider, 'main');
}

export function getAIProviderState(overrideProvider?: string | null, overrideModel?: string | null): AIProviderState {
  const provider = normalizeProvider(overrideProvider || getConfiguredAIProvider());
  const model = getProviderModel(provider, overrideModel);

  if (!SUPPORTED.includes(provider)) {
    return {
      provider: 'openai',
      model: getProviderModel('openai', overrideModel),
      available: false,
      reason: 'unsupported_provider',
    };
  }

  const hasKey = provider === 'anthropic'
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY);

  return {
    provider,
    model,
    available: hasKey,
    reason: hasKey ? undefined : 'missing_api_key',
  };
}

export function aiAvailable(overrideProvider?: string | null): boolean {
  return getAIProviderState(overrideProvider).available;
}
