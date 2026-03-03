export type NormalizedReview = {
  id: string;
  provider: 'google_business';
  provider_review_id: string;
  rating: number;
  text: string | null;
  created_at: string;
  reply_status: 'pending' | 'replied';
  author_name?: string | null;
  raw_ref?: string | null;
};

export type ProviderSyncResult = {
  imported: number;
  updated: number;
  unchanged: number;
  errors: number;
  needs_reauth: boolean;
  error_code?: string;
  integration_id?: string;
  location_resource?: string | null;
  total_fetched?: number;
  skipped?: 'missing_location' | 'needs_reauth';
};

export type ReviewsProviderListParams = {
  status: 'pending' | 'replied';
  limit: number;
  cursor?: string | null;
};

export interface ReviewsProvider {
  syncReviews(bizId: string): Promise<ProviderSyncResult>;
  listReviews(
    bizId: string,
    params: ReviewsProviderListParams,
  ): Promise<{ items: NormalizedReview[]; next_cursor?: string }>;
}
