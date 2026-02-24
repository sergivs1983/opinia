'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Business } from '@/types/database';
import { useSupabase } from './useSupabase';

interface UseBusinessResult {
  business: Business | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useBusiness(bizId?: string | null): UseBusinessResult {
  const supabase = useSupabase();
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!bizId) {
      setBusiness(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', bizId)
      .single();

    if (queryError) {
      setBusiness(null);
      setError(queryError.message);
      setLoading(false);
      return;
    }

    setBusiness((data as Business) || null);
    setLoading(false);
  }, [supabase, bizId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { business, loading, error, refetch };
}
