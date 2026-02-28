'use client';

export type LitoViewerRole = 'owner' | 'manager' | 'staff' | null;

export type LitoRecommendationStatus = 'shown' | 'accepted' | 'dismissed' | 'published';

export type LitoRecommendationHowTo = {
  why?: string;
  steps?: string[];
  checklist?: string[];
  assets_needed?: string[];
  time_estimate_min?: number;
};

export type LitoRecommendationSignalMeta = {
  keyword?: string;
  keyword_mentions?: number;
  avg_rating?: number;
  neg_reviews?: number;
  dominant_lang?: string;
  confidence?: 'high' | 'medium' | 'low';
};

export type LitoRecommendationLanguageMeta = {
  base_lang?: string;
  suggested_lang?: string;
  confidence?: 'high' | 'medium' | 'low';
};

export type LitoRecommendationTemplate = {
  format?: string;
  hook?: string;
  idea?: string;
  cta?: string;
  assets_needed?: string[];
  how_to?: LitoRecommendationHowTo;
  signal?: LitoRecommendationSignalMeta;
  language?: LitoRecommendationLanguageMeta;
};

export type LitoRecommendationItem = {
  id: string;
  rule_id: string;
  status: LitoRecommendationStatus;
  /** D1.4: 'signal' = backed by a real data signal; 'evergreen' = generic content idea */
  source?: 'signal' | 'evergreen';
  vertical?: string;
  format: string;
  hook: string;
  idea: string;
  cta: string;
  how_to?: LitoRecommendationHowTo;
  signal_meta?: LitoRecommendationSignalMeta;
  language?: LitoRecommendationLanguageMeta;
  recommendation_template?: LitoRecommendationTemplate;
};

export type LitoThreadItem = {
  id: string;
  biz_id: string;
  recommendation_id: string | null;
  title: string;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  messages_count?: number;
  last_message_preview?: string;
};

export type LitoThreadMessage = {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta?: unknown;
  created_at: string;
};

export type LitoGeneratedCopy = {
  caption_short: string;
  caption_long: string;
  hashtags: string[];
  shotlist: string[];
  image_idea: string;
  execution_checklist: string[];
  stickers: Array<'poll' | 'question' | 'countdown'>;
  director_notes: string[];
  assets_needed: string[];
  format: 'post' | 'story' | 'reel';
  language: 'ca' | 'es' | 'en';
  channel: 'instagram' | 'tiktok' | 'facebook';
  tone: 'formal' | 'neutral' | 'friendly';
};

export type LitoQuotaState = {
  used: number;
  limit: number;
  remaining: number;
};

export type LitoVoiceDraftKind = 'gbp_update' | 'social_post' | 'customer_email';
export type LitoVoiceDraftStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'executed';

export type LitoVoiceActionDraft = {
  id: string;
  org_id: string;
  biz_id: string;
  thread_id: string | null;
  source_voice_clip_id: string | null;
  kind: LitoVoiceDraftKind;
  status: LitoVoiceDraftStatus;
  payload: Record<string, unknown>;
  created_by: string;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};
