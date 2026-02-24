'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Review, ReviewSource, Sentiment } from '@/types/database';
import { useSupabase } from './useSupabase';

export type ReviewStatusFilter = 'all' | 'pending' | 'replied';

interface UseReviewsParams {
  bizId?: string | null;
  status?: ReviewStatusFilter;
  sentiment?: Sentiment | 'all';
  source?: ReviewSource | 'all';
  rating?: number;
  limit?: number;
}

interface UseReviewsResult {
  reviews: Review[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useReviews({
  bizId,
  status = 'all',
  sentiment = 'all',
  source = 'all',
  rating = 0,
  limit = 100,
}: UseReviewsParams): UseReviewsResult {
  const supabase = useSupabase();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!bizId) {
      setReviews([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    let query = supabase
      .from('reviews')
      .select('*, replies(id, tone, status)')
      .eq('biz_id', bizId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status === 'pending') query = query.eq('is_replied', false);
    if (status === 'replied') query = query.eq('is_replied', true);
    if (sentiment !== 'all') query = query.eq('sentiment', sentiment);
    if (source !== 'all') query = query.eq('source', source);
    if (rating > 0) query = query.eq('rating', rating);

    const { data, error: queryError } = await query;

    if (queryError) {
      setReviews([]);
      setError(queryError.message);
      setLoading(false);
      return;
    }

    setReviews((data as Review[]) || []);
    setLoading(false);
  }, [supabase, bizId, status, sentiment, source, rating, limit]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { reviews, loading, error, refetch };
}
