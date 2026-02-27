import { createClient } from '@supabase/supabase-js';
import { runStartupEnvCheck } from '@/lib/startup/env-check';

/**
 * getAdminClient() — service_role Supabase client.
 *
 * Bypasses RLS. ONLY use in:
 *   - src/app/api/webhooks/**
 *   - src/app/api/jobs/**
 *   - src/app/api/_internal/**
 *
 * Do NOT import this in user-facing routes or shared libs.
 * Use createServerSupabaseClient() for user-scoped access instead.
 */
export function getAdminClient() {
  runStartupEnvCheck();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — required for admin operations.'
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** @deprecated Use getAdminClient() */
export const createAdminClient = getAdminClient;
