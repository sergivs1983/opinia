type GuardrailDevHooks = {
  forceRateLimit: boolean;
  forceOrchestratorCap: boolean;
};

function isEnabledValue(value: string | null | undefined): boolean {
  return (value || '').trim() === '1';
}

export function isGuardrailDevHooksEnabled(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== 'production';
}

export function resolveGuardrailDevHooks(
  request: Pick<Request, 'url' | 'headers'>,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): GuardrailDevHooks {
  if (!isGuardrailDevHooksEnabled(nodeEnv)) {
    return {
      forceRateLimit: false,
      forceOrchestratorCap: false,
    };
  }

  const url = new URL(request.url);

  return {
    forceRateLimit:
      isEnabledValue(url.searchParams.get('__force_rate_limit'))
      || isEnabledValue(request.headers.get('x-opinia-force-rate-limit')),
    forceOrchestratorCap:
      isEnabledValue(url.searchParams.get('__force_orchestrator_cap'))
      || isEnabledValue(request.headers.get('x-opinia-force-orchestrator-cap')),
  };
}
