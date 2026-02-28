import { getAIProviderState, type AIProviderState } from '@/lib/ai/provider';

export type LitoCopyStatusReason = 'missing_api_key' | 'paused' | 'disabled' | 'ok';

export type LitoCopyStatus = {
  enabled: boolean;
  reason: LitoCopyStatusReason;
  provider: 'openai' | 'anthropic' | 'none';
};

function isDisabledByEnvFlag(): boolean {
  const raw = (
    process.env.LITO_COPY_ENABLED
    ?? process.env.NEXT_PUBLIC_LITO_COPY_ENABLED
    ?? ''
  )
    .trim()
    .toLowerCase();

  return raw === '0'
    || raw === 'false'
    || raw === 'off'
    || raw === 'no'
    || raw === 'disabled';
}

export function resolveLitoCopyStatus(params?: {
  providerState?: AIProviderState;
  paused?: boolean;
  disabled?: boolean;
}): LitoCopyStatus {
  const providerState = params?.providerState ?? getAIProviderState();
  const disabled = params?.disabled ?? isDisabledByEnvFlag();
  const paused = Boolean(params?.paused);

  if (disabled) {
    return { enabled: false, reason: 'disabled', provider: 'none' };
  }

  if (paused) {
    return { enabled: false, reason: 'paused', provider: 'none' };
  }

  if (!providerState.available) {
    return { enabled: false, reason: 'missing_api_key', provider: 'none' };
  }

  return { enabled: true, reason: 'ok', provider: providerState.provider };
}

export function litoCopyUnavailableMessage(reason: LitoCopyStatusReason): string {
  if (reason === 'missing_api_key') return "Falta configurar la clau d'IA.";
  if (reason === 'disabled' || reason === 'paused') return "Funció desactivada pel manager.";
  return 'LITO Copy està disponible.';
}
