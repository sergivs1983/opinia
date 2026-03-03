import type { SupabaseClient } from '@supabase/supabase-js';

import { decryptToken } from '@/lib/server/crypto';

export class IntegrationSecretError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'IntegrationSecretError';
    this.code = code;
  }
}

type IntegrationSecretRow = {
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  key_version: number | null;
};

export async function resolveIntegrationSecret(
  admin: SupabaseClient,
  integrationId: string,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const { data, error } = await admin
    .from('integrations_secrets')
    .select('access_token_enc, refresh_token_enc, key_version')
    .eq('integration_id', integrationId)
    .maybeSingle();

  if (error || !data) {
    throw new IntegrationSecretError(
      'integration_secret_missing',
      `No encrypted secrets found for integration ${integrationId}`,
    );
  }

  const secret = data as IntegrationSecretRow;
  if (!secret.access_token_enc || !secret.key_version) {
    throw new IntegrationSecretError(
      'integration_secret_incomplete',
      `Encrypted access token missing for integration ${integrationId}`,
    );
  }

  try {
    const accessToken = decryptToken(secret.access_token_enc, integrationId, secret.key_version);
    const refreshToken = secret.refresh_token_enc
      ? decryptToken(secret.refresh_token_enc, integrationId, secret.key_version)
      : null;

    return { accessToken, refreshToken };
  } catch (decryptError) {
    throw new IntegrationSecretError(
      'integration_secret_invalid',
      decryptError instanceof Error ? decryptError.message : 'Unable to decrypt integration secret',
    );
  }
}
