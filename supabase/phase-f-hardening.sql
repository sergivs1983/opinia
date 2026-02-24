-- ============================================================
-- OpinIA Phase F — Edge Hardening
-- Run AFTER phase-e-operations.sql
-- Adds: LLM provider config per business
-- ============================================================

-- LLM provider columns on businesses
alter table public.businesses
  add column if not exists llm_provider text not null default 'openai',
  add column if not exists llm_model_classify text,
  add column if not exists llm_model_generate text;

comment on column public.businesses.llm_provider is 'LLM provider: openai | anthropic';
comment on column public.businesses.llm_model_classify is 'Model override for classification step (null = default)';
comment on column public.businesses.llm_model_generate is 'Model override for generation step (null = default)';
