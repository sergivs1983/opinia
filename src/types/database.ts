// ============================================================
// OpinIA v2 Types — aligned with schema-v2 + extensions
// ============================================================
import type { JsonObject, JsonValue } from '@/types/json';

// --- Enums ---
export type MemberRole = 'owner' | 'admin' | 'manager' | 'responder' | 'staff';
export type BizType = 'restaurant' | 'hotel' | 'apartment' | 'bar' | 'cafe' | 'shop' | 'other';
export type Formality = 'tu' | 'voste';
export type Sentiment = 'positive' | 'neutral' | 'negative';
export type ReplyTone = 'proper' | 'professional' | 'premium';
export type ReviewSource = 'google' | 'tripadvisor' | 'booking' | 'manual' | 'other';
export type IntegrationProvider = 'google_business' | 'tripadvisor_api' | 'booking_api';
export type SyncStatus = 'pending' | 'running' | 'success' | 'failed';
export type ReplyStatus = 'draft' | 'selected' | 'published' | 'archived';
export type KBEntryType = 'faq' | 'snippet' | 'policy' | 'sensitive';
export type ContentSuggestionType = 'reel' | 'story' | 'post';
export type ContentSuggestionStatus = 'draft' | 'approved' | 'published';
export type ContentAssetFormat = 'story' | 'feed';
export type ContentAssetStatus = 'created' | 'failed';
export type BusinessBrandImageKind = 'logo' | 'cover';
export type ContentTextPostPlatform = 'x' | 'threads';
export type ContentPlannerChannel = 'ig_story' | 'ig_feed' | 'ig_reel' | 'x' | 'threads';
export type ContentPlannerItemType = 'suggestion' | 'asset' | 'text';
export type ContentPlannerStatus = 'planned' | 'published';
export type IntegrationEvent = 'planner.ready' | 'planner.published' | 'reply.approved' | 'asset.created' | 'export.created';
export type ConnectorType = 'webhook';
export type ExportLanguage = 'ca' | 'es' | 'en';
export type ExportKind = 'weekly_pack';
export type ExportStatus = 'ready' | 'failed';

// --- Core entities ---
export interface Organization {
  id: string;
  name: string;
  slug: string | null;
  plan: string;
  plan_code?: string;
  max_businesses: number;
  business_limit?: number;
  max_reviews_mo: number;
  max_team_members: number;
  seats_limit?: number;
  plan_price_cents?: number | null;
  billing_status?: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  locale: string;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  org_id: string;
  role: MemberRole;
  is_default: boolean;
  invited_email: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  // joins
  organization?: Organization;
}

export interface Business {
  id: string;
  org_id: string;
  name: string;
  slug: string | null;
  sort_order?: number;
  type: BizType;
  url: string | null;
  address: string | null;
  city: string | null;
  country: string;
  google_place_id: string | null;
  tags: string[];
  default_signature: string;
  formality: Formality;
  default_language: string;
  ai_instructions: string | null;
  tone_keywords_positive: string[];
  tone_keywords_negative: string[];
  supported_languages: string[];
  response_max_length: number;
  auto_publish_enabled: boolean;
  auto_publish_min_rating: number | null;
  is_active: boolean;
  onboarding_done: boolean;
  llm_provider: 'openai' | 'anthropic';
  llm_model_classify: string | null;
  llm_model_generate: string | null;
  panic_mode: boolean;
  panic_reason: string | null;
  panic_enabled_at: string | null;
  negative_constraints: string[];
  target_keywords: string[];
  seo_mode: boolean;
  seo_aggressiveness: number;
  seo_enabled: boolean;
  seo_keywords: string[];
  seo_rules: SeoRules;
  brand_image_bucket?: string;
  brand_image_path?: string | null;
  brand_image_kind?: BusinessBrandImageKind;
  brand_image_updated_at?: string | null;
  webhook_enabled?: boolean;
  webhook_url?: string | null;
  webhook_secret?: string | null;
  webhook_channels?: ContentPlannerChannel[];
  created_at: string;
  updated_at: string;
}

export interface BusinessMembership {
  id: string;
  org_id: string;
  business_id: string;
  user_id: string;
  role_override: MemberRole | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SeoRules {
  max_keywords_per_reply: number;
  avoid_if_negative: boolean;
  min_rating_for_keywords: number;
}

export interface ActionTrigger {
  id: string;
  org_id: string;
  biz_id: string;
  name: string;
  is_enabled: boolean;
  match_topics: string[];
  match_phrases: string[];
  min_rating: number | null;
  sentiment_filter: 'negative' | 'neutral' | 'positive' | null;
  action_type: 'email' | 'slack' | 'webhook' | 'in_app_alert';
  action_target: string | null;
  action_payload_template: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  org_id: string;
  biz_id: string;
  user_id: string | null;
  review_id: string | null;
  trigger_id: string | null;
  type: string;
  title: string;
  body: string | null;
  payload: JsonObject;
  is_read: boolean;
  created_at: string;
}

export interface Integration {
  id: string;
  biz_id: string;
  org_id: string;
  provider: IntegrationProvider;
  account_id: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: string;
  biz_id: string;
  org_id: string;
  source: ReviewSource;
  external_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  review_text: string;
  rating: number;
  sentiment: Sentiment;
  language_detected: string;
  review_date: string | null;
  is_replied: boolean;
  needs_attention: boolean;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
  // joins
  replies?: Reply[];
}

export interface Reply {
  id: string;
  review_id: string;
  biz_id: string;
  org_id: string;
  tone: ReplyTone;
  content: string;
  status: ReplyStatus;
  is_edited: boolean;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KBEntry {
  id: string;
  biz_id: string;
  org_id: string;
  type: KBEntryType;
  category?: string;
  topic: string;
  content: string;
  language: string;
  is_active: boolean;
  priority: number;
  triggers?: string[];
  valid_from?: string | null;
  valid_until?: string | null;
  used_count: number;
  created_at: string;
  updated_at: string;
}

// --- Workspace context ---
export interface WorkspaceState {
  org: Organization | null;
  biz: Business | null;
  membership: Membership | null;
  orgs: Organization[];
  memberships: Membership[];
  businesses: Business[];
  loading: boolean;
}

// --- API payloads ---
export interface GenerateResponseInput {
  review_id: string;
  review_text: string;
  sentiment: Sentiment;
  rating: number;
  business_profile: {
    business_name: string;
    business_type: BizType;
    tags: string[];
    formality: Formality;
    signature: string;
    language: string;
    ai_instructions: string | null;
    tone_keywords_positive: string[];
    tone_keywords_negative: string[];
  };
  kb_entries: KBEntry[];
  modifier?: 'shorter' | 'formal' | 'empathic' | 'assertive';
}

export interface GenerateResponseOutput {
  language_detected: string;
  option_a: string;
  option_b: string;
  option_c: string;
  guardrail_warnings: GuardrailWarning[];
}

export interface GuardrailWarning {
  tone: ReplyTone;
  type: 'unverified_fact' | 'price_mention' | 'schedule_mention' | 'hallucination';
  text: string;
  span: string;
}

// --- Phase B: Knowledge Base Entries ---
export type KBCategory = 'parking' | 'wifi' | 'horaris' | 'política' | 'menú' | 'equip' | 'instal·lacions' | 'ubicació' | 'promoció' | 'altres';

export const KB_CATEGORIES: { value: KBCategory; label: string; icon: string }[] = [
  { value: 'parking', label: 'Parking', icon: '🅿️' },
  { value: 'wifi', label: 'WiFi', icon: '📶' },
  { value: 'horaris', label: 'Horaris', icon: '🕐' },
  { value: 'política', label: 'Política', icon: '📋' },
  { value: 'menú', label: 'Menú / Cuina', icon: '🍽️' },
  { value: 'equip', label: 'Equip', icon: '👥' },
  { value: 'instal·lacions', label: 'Instal·lacions', icon: '🏢' },
  { value: 'ubicació', label: 'Ubicació', icon: '📍' },
  { value: 'promoció', label: 'Promocions', icon: '🎁' },
  { value: 'altres', label: 'Altres', icon: '📝' },
];

export interface KnowledgeBaseEntry {
  id: string;
  biz_id: string;
  org_id: string;
  category: string;
  triggers: string[];
  content: string;
  sentiment_context: string | null;
  created_at: string;
  updated_at: string;
}

// --- Phase B: Pipeline result ---
export interface PipelineResult {
  classification: {
    language: string;
    sentiment: string;
    topics: string[];
    urgency: string;
  };
  matched_kb: KnowledgeBaseEntry[];
  responses: {
    option_a: string;
    option_b: string;
    option_c: string;
  };
  guardrail_warnings: GuardrailWarning[];
}

// --- Phase C: Review Topics (Insights) ---
export const TOPIC_TAXONOMY = [
  'service', 'staff', 'food', 'breakfast', 'cleanliness', 'noise',
  'location', 'value', 'room', 'wifi', 'parking', 'checkin',
  'ambiance', 'facilities', 'other',
] as const;
export type TopicLabel = typeof TOPIC_TAXONOMY[number];

export const TOPIC_LABELS: Record<string, string> = {
  service: 'Servei', staff: 'Personal', food: 'Menjar', breakfast: 'Esmorzar',
  cleanliness: 'Neteja', noise: 'Soroll', location: 'Ubicació', value: 'Relació qualitat-preu',
  room: 'Habitació', wifi: 'WiFi', parking: 'Parking', checkin: 'Check-in',
  ambiance: 'Ambient', facilities: 'Instal·lacions', other: 'Altres',
};

export const TOPIC_ICONS: Record<string, string> = {
  service: '🛎️', staff: '👤', food: '🍽️', breakfast: '🥐',
  cleanliness: '✨', noise: '🔊', location: '📍', value: '💰',
  room: '🛏️', wifi: '📶', parking: '🅿️', checkin: '🔑',
  ambiance: '🎶', facilities: '🏢', other: '📝',
};

export interface ReviewTopic {
  id: string;
  review_id: string;
  biz_id: string;
  org_id: string;
  topic: string;
  sentiment: Sentiment;
  polarity: 'praise' | 'complaint' | 'neutral';
  urgency: 'low' | 'medium' | 'high';
  confidence: number;
  created_at: string;
}

export interface InsightsSummary {
  top_praises: { topic: string; count: number; pct: number; avg_rating: number }[];
  top_complaints: { topic: string; count: number; pct: number; avg_rating: number; urgency_high_count: number }[];
  timeline: { date_bucket: string; praises_count: number; complaints_count: number; avg_rating: number }[];
  total_reviews: number;
  avg_rating: number;
  period_days: number;
}

export interface ContentInsight {
  id: string;
  business_id: string;
  week_start: string;
  source_platforms: string[];
  language: 'ca' | 'es' | 'en';
  themes: JsonObject;
  derived_business_profile: JsonObject | null;
  created_at: string;
}

export interface ContentSuggestion {
  id: string;
  insight_id: string;
  business_id: string;
  language: 'ca' | 'es' | 'en';
  type: ContentSuggestionType;
  title: string | null;
  hook: string | null;
  shot_list: JsonValue;
  caption: string | null;
  cta: string | null;
  best_time: string | null;
  hashtags: string[];
  evidence: JsonValue;
  status: ContentSuggestionStatus;
  created_at: string;
}

export interface ContentAsset {
  id: string;
  business_id: string;
  suggestion_id: string | null;
  language: 'ca' | 'es' | 'en';
  format: ContentAssetFormat;
  template_id: string;
  payload: JsonObject;
  status: ContentAssetStatus;
  storage_bucket: string;
  storage_path: string;
  width: number;
  height: number;
  bytes: number;
  created_at: string;
}

export interface ContentTextPost {
  id: string;
  business_id: string;
  suggestion_id: string | null;
  language: 'ca' | 'es' | 'en';
  platform: ContentTextPostPlatform;
  variants: string[];
  created_at: string;
}

export interface ContentPlannerItem {
  id: string;
  business_id: string;
  week_start: string;
  scheduled_at: string;
  channel: ContentPlannerChannel;
  item_type: ContentPlannerItemType;
  suggestion_id: string | null;
  asset_id: string | null;
  text_post_id: string | null;
  title: string;
  notes: string | null;
  status: ContentPlannerStatus;
  created_at: string;
}

export interface OnboardingProgress {
  business_id: string;
  step: number;
  completed: boolean;
  dismissed: boolean;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface ExportRecord {
  id: string;
  business_id: string;
  week_start: string;
  language: ExportLanguage;
  kind: ExportKind;
  storage_bucket: string;
  storage_path: string;
  bytes: number;
  items_count: number;
  status: ExportStatus;
  created_at: string;
}

export interface MetricsDaily {
  business_id: string;
  day: string;
  reviews_received: number;
  replies_generated: number;
  replies_approved: number;
  planner_items_added: number;
  planner_items_published: number;
  assets_created: number;
  exports_created: number;
  ai_cost_cents: number;
  ai_tokens_in: number;
  ai_tokens_out: number;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  id: string;
  business_id: string;
  connector_id: string | null;
  planner_item_id: string | null;
  event: IntegrationEvent;
  status: 'sent' | 'failed';
  response_code: number | null;
  error: string | null;
  request_id: string | null;
  created_at: string;
}

export interface Connector {
  id: string;
  business_id: string;
  type: ConnectorType;
  enabled: boolean;
  url: string | null;
  secret: string | null;
  allowed_channels: ContentPlannerChannel[];
  created_at: string;
  updated_at: string;
}

// --- Phase E: Operations Dashboard ---
export interface OpsAction {
  id: string;
  org_id: string;
  biz_id: string;
  theme: string;
  title: string;
  recommendation: string | null;
  status: 'open' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  created_at: string;
  updated_at: string;
  done_at: string | null;
}

export interface OpsIssue {
  theme: string;
  count: number;
  pct: number;
  avg_rating: number;
  urgency_high: number;
  trend: number;           // % change vs previous period (-50 to +200)
  prev_count: number;
}

export interface HeatmapCell {
  day: number;   // 0=Sun..6=Sat
  hour: number;  // 0-23, or -1 for day-only
  count: number;
  avg_rating: number;
}

export interface ReputationScorecard {
  avg_response_time_hours: number;
  pct_replied: number;
  urgent_queue: number;
  rating_trend: { period: string; avg: number }[];
  total_reviews: number;
  total_replied: number;
}
