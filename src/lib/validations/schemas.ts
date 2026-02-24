/**
 * ═══════════════════════════════════════════
 * OpinIA — Zod Schemas for API Routes
 * ═══════════════════════════════════════════
 *
 * One schema per payload. Grouped by domain.
 * Import what you need:
 *   import { TeamInviteSchema } from '@/lib/validations/schemas';
 */

import { z } from 'zod';

// ────────────────────────────────────────────
// Shared primitives
// ────────────────────────────────────────────

const uuid = z.string().uuid('Must be a valid UUID');
const nonEmpty = z.string().min(1, 'Required');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Invalid date');

const isoDateTime = z
  .string()
  .trim()
  .min(1, 'Required')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be a valid ISO datetime');

// ────────────────────────────────────────────
// TEAM
// ────────────────────────────────────────────

export const TeamInviteSchema = z.object({
  org_id: uuid,
  email: z.string().email('Must be a valid email'),
  role: z.enum(['owner', 'admin', 'manager', 'responder', 'staff']).default('responder'),
});

export const TeamRoleSchema = z.object({
  membership_id: uuid,
  role: z.enum(['owner', 'admin', 'manager', 'responder', 'staff']),
});

export const AdminBusinessAssignmentsQuerySchema = z.object({
  org_id: uuid,
});

export const AdminBusinessAssignmentsUpdateSchema = z.object({
  org_id: uuid,
  membership_id: uuid,
  business_ids: z.array(uuid).max(200),
  role_override: z.enum(['owner', 'admin', 'manager', 'responder', 'staff']).nullable().optional(),
});

export const AdminBusinessesListQuerySchema = z.object({
  org_id: uuid,
});

export const AdminBusinessCreateSchema = z.object({
  org_id: uuid,
  name: nonEmpty.max(120),
  type: z.enum(['restaurant', 'hotel', 'apartment', 'bar', 'cafe', 'shop', 'other']).default('other'),
  slug: z.string().trim().min(1).max(120).optional().nullable(),
  url: z.string().trim().url().optional().nullable(),
});

export const AdminBusinessUpdateSchema = z.object({
  org_id: uuid,
  business_id: uuid,
  name: z.string().trim().min(1).max(120).optional(),
  type: z.enum(['restaurant', 'hotel', 'apartment', 'bar', 'cafe', 'shop', 'other']).optional(),
  slug: z.string().trim().min(1).max(120).optional().nullable(),
  url: z.string().trim().url().optional().nullable(),
  is_active: z.boolean().optional(),
});

export const AdminBusinessOrderSchema = z.object({
  org_id: uuid,
  items: z.array(
    z.object({
      id: uuid,
      sort_order: z.number().int().min(0).max(10000),
    }),
  ).min(1).max(500),
});

export const WorkspaceActiveOrgSchema = z.object({
  orgId: uuid,
});

// ────────────────────────────────────────────
// KNOWLEDGE BASE
// ────────────────────────────────────────────

export const KBCreateSchema = z.object({
  biz_id: uuid,
  org_id: uuid,
  category: z.enum(['faq', 'snippet', 'policy', 'sensitive']).default('faq'),
  triggers: z.array(z.string()).optional().default([]),
  content: nonEmpty,
  sentiment_context: z.enum(['positive', 'neutral', 'negative']).optional().nullable(),
});

export const KBUpdateSchema = z.object({
  id: uuid,
  category: z.enum(['faq', 'snippet', 'policy', 'sensitive']).optional(),
  triggers: z.array(z.string()).optional(),
  content: z.string().min(1).optional(),
  sentiment_context: z.enum(['positive', 'neutral', 'negative']).optional().nullable(),
});

// ────────────────────────────────────────────
// TRIGGERS
// ────────────────────────────────────────────

export const TriggerCreateSchema = z.object({
  org_id: uuid,
  biz_id: uuid,
  name: nonEmpty,
  match_topics: z.array(z.string()).optional().default([]),
  match_phrases: z.array(z.string()).optional().default([]),
  min_rating: z.number().int().min(1).max(5).optional().nullable(),
  sentiment_filter: z.enum(['positive', 'neutral', 'negative']).optional().nullable(),
  action_type: z.enum(['webhook', 'email', 'slack', 'flag', 'tag']),
  action_target: z.string().optional().default(''),
  action_payload_template: z.string().optional().nullable(),
});

export const TriggerUpdateSchema = z.object({
  id: uuid,
  name: z.string().min(1).optional(),
  match_topics: z.array(z.string()).optional(),
  match_phrases: z.array(z.string()).optional(),
  min_rating: z.number().int().min(1).max(5).optional().nullable(),
  sentiment_filter: z.enum(['positive', 'neutral', 'negative']).optional().nullable(),
  action_type: z.enum(['webhook', 'email', 'slack', 'flag', 'tag']).optional(),
  action_target: z.string().optional(),
  action_payload_template: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
});

export const TriggerTestSchema = z.object({
  biz_id: uuid,
  test_text: nonEmpty,
  test_rating: z.number().int().min(1).max(5).optional().default(3),
  test_sentiment: z.enum(['positive', 'neutral', 'negative']).optional().default('neutral'),
});

// ────────────────────────────────────────────
// GROWTH LINKS
// ────────────────────────────────────────────

export const GrowthLinkCreateSchema = z.object({
  biz_id: uuid,
  org_id: uuid,
  target_url: z.string().url('Must be a valid URL'),
  type: z.enum(['google', 'tripadvisor', 'booking', 'custom']).default('google'),
});

// ────────────────────────────────────────────
// COMPETITORS
// ────────────────────────────────────────────

export const CompetitorCreateSchema = z.object({
  biz_id: uuid,
  org_id: uuid,
  name: nonEmpty,
  place_id: z.string().optional().nullable(),
  public_url: z.string().url().optional().nullable(),
  avg_rating: z.number().min(0).max(5).optional().nullable(),
  review_count: z.number().int().min(0).optional().nullable(),
});

// ────────────────────────────────────────────
// BILLING
// ────────────────────────────────────────────

export const BillingUpdateSchema = z.object({
  org_id: uuid,
  plan_id: nonEmpty,
});

export const OrgSetPlanParamsSchema = z.object({
  orgId: uuid,
});

export const OrgSetPlanSchema = z.object({
  plan_code: z.enum(['starter_49', 'pro_149']),
});

// ────────────────────────────────────────────
// AUDIT
// ────────────────────────────────────────────

export const AuditLogSchema = z.object({
  action: nonEmpty,
  org_id: uuid,
  biz_id: uuid.optional().nullable(),
  metadata: z.record(z.unknown()).optional().default({}),
});

// ────────────────────────────────────────────
// LOCALE
// ────────────────────────────────────────────

export const LocaleSchema = z.object({
  locale: z.enum(['ca', 'es', 'en']),
});

// ────────────────────────────────────────────
// OPS ACTIONS
// ────────────────────────────────────────────

export const OpsActionCreateSchema = z.object({
  biz_id: uuid,
  org_id: uuid,
  theme: nonEmpty,
  title: nonEmpty,
  recommendation: z.string().optional().default(''),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});

export const OpsActionUpdateSchema = z.object({
  id: uuid,
  status: z.enum(['open', 'in_progress', 'done', 'dismissed']).optional(),
  notes: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

// ────────────────────────────────────────────
// JOBS
// ────────────────────────────────────────────

export const JobRunSchema = z.discriminatedUnion('job', [
  z.object({
    job: z.literal('rebuild_insights'),
    biz_id: uuid,
    org_id: uuid,
  }),
  z.object({
    job: z.literal('rebuild_all_insights'),
  }),
  z.object({
    job: z.literal('sync_reviews'),
    biz_id: uuid.optional(),
    org_id: uuid.optional(),
  }),
]);

// ────────────────────────────────────────────
// DLQ
// ────────────────────────────────────────────

export const DLQActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('retry'),
    failed_job_id: uuid,
  }),
  z.object({
    action: z.literal('retry_batch'),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.object({
    action: z.literal('resolve'),
    failed_job_id: uuid,
  }),
]);

// ────────────────────────────────────────────
// DEMO
// ────────────────────────────────────────────

export const DemoGenerateSchema = z.object({
  review_text: z.string().trim().min(10, 'Review text too short').max(5000),
  rating: z.number().int().min(1).max(5),
  language: z.string().optional(),
});

export const DemoSeedSchema = z.object({
  biz_id: uuid,
  org_id: uuid,
});

// ────────────────────────────────────────────
// REVIEW AUDIT
// ────────────────────────────────────────────

export const ReviewAuditSchema = z.object({
  reviews: z.array(z.object({
    text: z.string().min(5),
    rating: z.number().int().min(1).max(5),
    source: z.string().optional(),
  })).min(1, 'At least one review required').max(20),
  business_name: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
});

// ────────────────────────────────────────────
// CONTENT INTELLIGENCE
// ────────────────────────────────────────────

export const ContentIntelGenerateSchema = z.object({
  businessId: uuid,
  weekStart: isoDate,
  platforms: z.array(z.enum(['google', 'tripadvisor'])).optional().default([]),
  maxReviews: z.coerce.number().int().min(1).max(200).optional().default(50),
  language: z.enum(['ca', 'es', 'en']).optional(),
});

export const ContentSuggestionParamsSchema = z.object({
  id: uuid,
});

export const ContentSuggestionPatchSchema = z.object({
  status: z.enum(['draft', 'approved', 'published']),
});

// ────────────────────────────────────────────
// CONTENT STUDIO
// ────────────────────────────────────────────

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a valid hex color');

export const ContentStudioRenderSchema = z.object({
  suggestionId: uuid.optional(),
  sourceAssetId: uuid.optional(),
  format: z.enum(['story', 'feed']),
  templateId: z.enum(['quote-clean', 'feature-split', 'top3-reasons', 'behind-scenes']),
  language: z.enum(['ca', 'es', 'en']).optional(),
  debugBase64: z.boolean().optional().default(false),
  brand: z.object({
    primary: hexColor.optional(),
    secondary: hexColor.optional(),
    text: hexColor.optional(),
    logo_url: z.string().url('Must be a valid URL').optional(),
  }).optional(),
}).refine((value) => !!value.suggestionId || !!value.sourceAssetId, {
  message: 'suggestionId or sourceAssetId is required',
  path: ['suggestionId'],
});

export const ContentStudioXGenerateSchema = z.object({
  suggestionId: uuid,
  platform: z.enum(['x', 'threads']).optional().default('x'),
  language: z.enum(['ca', 'es', 'en']).optional(),
  tone: z.enum(['professional', 'friendly', 'bold']).optional().default('friendly'),
});

export const ContentStudioAssetParamsSchema = z.object({
  id: uuid,
});

export const ContentStudioAssetsListQuerySchema = z.object({
  businessId: uuid.optional(),
  weekStart: isoDate.optional(),
  format: z.enum(['story', 'feed']).optional(),
  language: z.enum(['ca', 'es', 'en']).optional(),
  templateId: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['created', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  cursor: z.string().trim().min(1).max(200).optional(),
});

// ────────────────────────────────────────────
// PLANNER
// ────────────────────────────────────────────

const plannerChannelSchema = z.enum(['ig_story', 'ig_feed', 'ig_reel', 'x', 'threads']);
const integrationWebhookChannelSchema = z.enum(['ig_story', 'ig_feed', 'ig_reel']);
const plannerItemTypeSchema = z.enum(['suggestion', 'asset', 'text']);
const plannerStatusSchema = z.enum(['planned', 'published']);
const businessBrandImageKindSchema = z.enum(['logo', 'cover']);
export const IntegrationEventSchema = z.enum([
  'planner.ready',
  'planner.published',
  'reply.approved',
  'asset.created',
  'export.created',
]);
const webhookEventSchema = z.enum(['planner.ready', 'planner.published']);

export const PlannerListQuerySchema = z.object({
  weekStart: isoDate,
  businessId: uuid.optional(),
  channel: plannerChannelSchema.optional(),
  status: plannerStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export const PlannerCreateSchema = z.object({
  businessId: uuid,
  weekStart: isoDate,
  scheduledAt: isoDateTime,
  channel: plannerChannelSchema,
  itemType: plannerItemTypeSchema,
  suggestionId: uuid.optional(),
  assetId: uuid.optional(),
  textPostId: uuid.optional(),
  title: z.string().trim().min(1, 'Required').max(220),
  notes: z.string().trim().max(2000).optional(),
}).superRefine((value, ctx) => {
  if (value.itemType === 'suggestion' && !value.suggestionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['suggestionId'],
      message: 'suggestionId is required when itemType is suggestion',
    });
  }

  if (value.itemType === 'asset' && !value.assetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assetId'],
      message: 'assetId is required when itemType is asset',
    });
  }

  if (value.itemType === 'text' && !value.textPostId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['textPostId'],
      message: 'textPostId is required when itemType is text',
    });
  }
});

export const PlannerItemParamsSchema = z.object({
  id: uuid,
});

export const PlannerPatchSchema = z.object({
  status: plannerStatusSchema.optional(),
  scheduledAt: isoDateTime.optional(),
  notes: z.string().trim().max(2000).optional(),
}).refine((value) => value.status !== undefined || value.scheduledAt !== undefined || value.notes !== undefined, {
  message: 'At least one field is required',
});

export const PlannerSendSchema = z.object({
  event: webhookEventSchema.optional().default('planner.ready'),
});

// ────────────────────────────────────────────
// INTEGRATIONS HUB
// ────────────────────────────────────────────

export const IntegrationsConnectorParamsSchema = z.object({
  id: uuid,
});

export const IntegrationsConnectorsUpsertSchema = z.object({
  type: z.literal('webhook').optional().default('webhook'),
  enabled: z.coerce.boolean(),
  url: z.string().trim().url('Must be a valid URL').max(2000).nullable().optional(),
  allowed_channels: z.array(integrationWebhookChannelSchema).optional().default([]),
  regenerateSecret: z.coerce.boolean().optional().default(false),
}).superRefine((value, ctx) => {
  if (value.enabled && !value.url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['url'],
      message: 'url is required when webhook is enabled',
    });
  }
});

export const IntegrationsConnectorPatchSchema = z.object({
  enabled: z.coerce.boolean().optional(),
  url: z.string().trim().url('Must be a valid URL').max(2000).nullable().optional(),
  allowed_channels: z.array(integrationWebhookChannelSchema).optional(),
  regenerateSecret: z.coerce.boolean().optional().default(false),
}).refine((value) => (
  value.enabled !== undefined
  || value.url !== undefined
  || value.allowed_channels !== undefined
  || value.regenerateSecret !== undefined
), {
  message: 'At least one field is required',
});

export const IntegrationsTestSchema = z.object({
  connectorId: uuid,
  event: IntegrationEventSchema.refine((value) => value === 'planner.ready', {
    message: 'Only planner.ready is supported in test endpoint',
  }).optional().default('planner.ready'),
  channel: integrationWebhookChannelSchema.optional().default('ig_feed'),
  demo: z.coerce.boolean().optional().default(true),
});

// ────────────────────────────────────────────
// WEBHOOKS
// ────────────────────────────────────────────

export const WebhookConfigSchema = z.object({
  enabled: z.coerce.boolean(),
  url: z.string().trim().url('Must be a valid URL').max(2000).nullable().optional(),
  channels: z.array(plannerChannelSchema).optional().default([]),
}).superRefine((value, ctx) => {
  if (value.enabled && !value.url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['url'],
      message: 'url is required when webhook is enabled',
    });
  }
});

export const WebhookTestSchema = z.object({
  event: webhookEventSchema.optional().default('planner.ready'),
  webhookUrl: z.string().trim().url('Must be a valid URL').max(2000).optional(),
  channel: plannerChannelSchema.optional().default('ig_feed'),
  language: z.enum(['ca', 'es', 'en']).optional(),
});

// ────────────────────────────────────────────
// EXPORTS
// ────────────────────────────────────────────

export const ExportWeeklyBodySchema = z.object({
  weekStart: isoDate,
  language: z.enum(['ca', 'es', 'en']).optional(),
  includeAssets: z.coerce.boolean().optional().default(true),
  includeTexts: z.coerce.boolean().optional().default(true),
  includeCsv: z.coerce.boolean().optional().default(true),
  includeReadme: z.coerce.boolean().optional().default(true),
  debug: z.coerce.boolean().optional().default(false),
});

export const ExportParamsSchema = z.object({
  id: uuid,
});

export const ExportsListQuerySchema = z.object({
  weekStart: isoDate.optional(),
  language: z.enum(['ca', 'es', 'en']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

// ────────────────────────────────────────────
// BUSINESS BRAND IMAGE
// ────────────────────────────────────────────

export const BusinessBrandImageParamsSchema = z.object({
  id: uuid,
});

export const BusinessBrandImageUploadSchema = z.object({
  kind: businessBrandImageKindSchema.optional().default('logo'),
});

// ────────────────────────────────────────────
// METRICS
// ────────────────────────────────────────────

export const MetricsSummaryQuerySchema = z.object({
  range: z.enum(['7', '30', '90']).optional().default('30'),
});

export const MetricsRebuildBodySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional().default(30),
});

// ────────────────────────────────────────────
// ONBOARDING
// ────────────────────────────────────────────

export const OnboardingPatchSchema = z.object({
  step: z.coerce.number().int().min(1).max(4).optional(),
  completed: z.coerce.boolean().optional(),
  dismissed: z.coerce.boolean().optional(),
}).refine((value) => (
  value.step !== undefined
  || value.completed !== undefined
  || value.dismissed !== undefined
), {
  message: 'At least one field is required',
});

export const OnboardingSeedSchema = z.object({
  businessId: uuid,
  language: z.enum(['ca', 'es', 'en']).optional(),
  count: z.coerce.number().int().min(1).max(10).optional().default(5),
  force: z.coerce.boolean().optional().default(false),
});

// ────────────────────────────────────────────
// REPLIES
// ────────────────────────────────────────────

export const ApproveReplySchema = z.object({
  final_content: z.string().min(1, 'Final content cannot be empty').max(10000),
});

// ────────────────────────────────────────────
// GENERATE (lightweight — full refactor at Pas 8)
// ────────────────────────────────────────────

export const GenerateModifierSchema = z.object({
  modifier: z.enum(['shorter', 'formal', 'empathic', 'assertive']).optional().nullable(),
});

export const ReviewGenerateParamsSchema = z.object({
  reviewId: uuid,
});

export const ReviewGenerateBodySchema = z.object({
  platform: z.enum(['google', 'tripadvisor', 'booking', 'manual', 'other']),
  rating: z.coerce.number().int().min(1).max(5),
  language: z.string().trim().min(2).max(12).optional().nullable(),
  regenerate: z.coerce.boolean().optional().default(false),
  modifier: z.enum(['shorter', 'formal', 'empathic', 'assertive']).optional().nullable(),
  request_id: z.string().trim().min(1).max(128).optional(),
});

export function resolveGenerateSeoStrategy(rating: number): 'primary' | 'secondary' {
  return rating <= 2 ? 'secondary' : 'primary';
}

// ────────────────────────────────────────────
// PROFILE DETECT
// ────────────────────────────────────────────

export const ProfileDetectSchema = z.object({
  url: z.string().trim().min(1, 'URL is required'),
});
