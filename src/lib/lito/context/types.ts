export type LITOChatMode = 'chat' | 'orchestrator' | 'orchestrator_safe';

export type LITOBusinessContext = {
  biz_id: string;
  org_id: string;
  business_name: string;
  vertical: string;
  city: string | null;
  country: string | null;
  language: 'ca' | 'es' | 'en';
  formality: 'tu' | 'voste' | 'neutral';
  ai_provider_preference: 'auto' | 'openai' | 'anthropic';
  channels: Array<'instagram' | 'tiktok' | 'facebook'>;
};

export type LITOLearnedContext = {
  memory_available: boolean;
  profile_points: string[];
  voice_points: string[];
  policy_points: string[];
};

export type LITOStateContext = {
  due_today_count: number;
  scheduled_this_week_count: number;
  pending_drafts_count: number;
  approved_drafts_count: number;
  snoozed_or_missed_count: number;
  published_last_14d_count: number;
  days_since_last_published: number | null;
};

export type LITOSignalContextItem = {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  metric: string;
};

export type LITOSignalsContext = {
  active_count: number;
  top: LITOSignalContextItem[];
};

export type LITOPayload = {
  generated_at: string;
  biz_id: string;
  user_id: string;
  business_context: LITOBusinessContext;
  learned_context: LITOLearnedContext;
  state_context: LITOStateContext;
  signals_context: LITOSignalsContext;
  context_summary: string;
};
