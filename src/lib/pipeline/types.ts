/**
 * ═══════════════════════════════════════════
 * Pipeline Types — shared contracts between stages
 * ═══════════════════════════════════════════
 */

import type { Business, KnowledgeBaseEntry, GuardrailWarning, ReplyTone } from '@/types/database';
import type { LLMProvider } from '@/lib/llm/provider';
import type { SupabaseClient } from '@supabase/supabase-js';

export type SentimentLabel = 'positive' | 'neutral' | 'negative' | 'very_positive' | 'very_negative' | 'mixed';
export type UrgencyLabel = 'low' | 'medium' | 'high' | 'critical';
export type TopicPolarity = 'praise' | 'complaint' | 'neutral';

// ── Classification output ──

export interface TopicDetail {
  topic: string;
  polarity: TopicPolarity;
  confidence: number;
}

export interface Classification {
  language: string;
  sentiment: SentimentLabel;
  topics: string[];
  urgency: UrgencyLabel;
  mentions_specific: boolean;
  topic_details: TopicDetail[];
}

// ── RAG context ──

export interface MatchedKB extends KnowledgeBaseEntry {
  match_score: number;
}

export interface RAGContext {
  allKB: KnowledgeBaseEntry[];
  relevantKB: MatchedKB[];
  recentReplies: string[];
  recentOpenings: string[];
  recentClosings: string[];
}

// ── Generation output ──

export interface GeneratedResponses {
  option_a: string;
  option_b: string;
  option_c: string;
}

// ── Trigger output ──

export interface FiredTrigger {
  triggerId: string;
  triggerName: string;
}

// ── Full pipeline context (passed between stages) ──

export interface PipelineInput {
  reviewId: string;
  reviewText: string;
  rating: number;
  review: {
    id: string;
    biz_id: string;
    org_id: string;
    language_detected: string | null;
    sentiment: SentimentLabel | null;
    review_text: string;
    rating: number;
  };
  biz: Business;
  modifier: Modifier | null;
  userId: string;
  requestId: string;
  llmProvider: LLMProvider;
  hasApiKey: boolean;
  admin: SupabaseClient;
}

export interface PipelineOutput {
  language_detected: string;
  classification: Classification;
  matched_kb: { id: string; category: string; content: string; triggers: string[] }[];
  option_a: string;
  option_b: string;
  option_c: string;
  guardrail_warnings: GuardrailWarning[];
  triggers_fired: FiredTrigger[];
}

export type Modifier = 'shorter' | 'formal' | 'empathic' | 'assertive';

export const MODIFIER_INSTRUCTIONS: Record<Modifier, string> = {
  shorter:   'Make 30-40% shorter, maximum 2-3 sentences',
  formal:    'Increase formality significantly',
  empathic:  'Increase emotional warmth and empathy',
  assertive: 'Be more direct, solution-focused, less apologetic',
};
