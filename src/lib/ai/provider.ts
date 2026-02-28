import { getDefaultModel, type LLMProvider } from '@/lib/llm/provider';

export type AIProvider = LLMProvider;
export type AIProviderPreference = 'auto' | AIProvider;

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

function normalizePreference(input: string | null | undefined): AIProviderPreference {
  const normalized = (input || '').trim().toLowerCase();
  if (normalized === 'openai') return 'openai';
  if (normalized === 'anthropic') return 'anthropic';
  return 'auto';
}

export function getConfiguredAIProviderPreference(): AIProviderPreference {
  return normalizePreference(process.env.IA_PROVIDER || process.env.AI_PROVIDER || 'auto');
}

export function getConfiguredAIProvider(): AIProvider {
  return resolveProvider().provider;
}

export function getProviderModel(provider: AIProvider, override?: string | null): string {
  const explicit = (override || process.env.DEFAULT_MODEL || '').trim();
  if (explicit.length > 0) return explicit;
  if (provider === 'openai') return 'gpt-4o-mini';
  return getDefaultModel(provider, 'main');
}

export function resolveProvider(options?: {
  orgProvider?: string | null;
  overrideModel?: string | null;
}): AIProviderState {
  const preference = normalizePreference(options?.orgProvider || getConfiguredAIProviderPreference());
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  let provider: AIProvider;
  let available: boolean;

  if (preference === 'openai') {
    provider = 'openai';
    available = hasOpenAI;
  } else if (preference === 'anthropic') {
    provider = 'anthropic';
    available = hasAnthropic;
  } else if (hasOpenAI) {
    provider = 'openai';
    available = true;
  } else if (hasAnthropic) {
    provider = 'anthropic';
    available = true;
  } else {
    provider = 'openai';
    available = false;
  }

  const model = getProviderModel(provider, options?.overrideModel);

  if (!SUPPORTED.includes(provider)) {
    return {
      provider: 'openai',
      model: getProviderModel('openai', options?.overrideModel),
      available: false,
      reason: 'unsupported_provider',
    };
  }

  return {
    provider,
    model,
    available,
    reason: available ? undefined : 'missing_api_key',
  };
}

export function getAIProviderState(overrideProvider?: string | null, overrideModel?: string | null): AIProviderState {
  return resolveProvider({
    orgProvider: overrideProvider,
    overrideModel,
  });
}

export function aiAvailable(overrideProvider?: string | null): boolean {
  return getAIProviderState(overrideProvider).available;
}
