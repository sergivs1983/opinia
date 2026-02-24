'use client';

import { useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Centralized Supabase browser client hook.
 */
export function useSupabase() {
  return useMemo(() => createClient(), []);
}
