# Settings (Configuració)

## Scope
- New Settings page at `/dashboard/settings` with OpinIA look-and-feel.
- New `General` panel persisted per business (`biz_id`) in `public.biz_settings`.
- Sidebar sections:
  - General
  - Integracions
  - Brand Brain
  - Billing
  - Idioma
  - Health

## Data model
- Migration: `supabase/migrations/20260323000000_biz_settings.sql`
- Table: `public.biz_settings`
  - `biz_id` uuid PK FK `businesses(id)` cascade
  - `signature` text
  - `ai_instructions` text (`char_length <= 500`)
  - `keywords_use` text[] default `{}`
  - `keywords_avoid` text[] default `{}`
  - `ai_engine` text default `opinia_ai`
  - `seo_enabled` boolean default `false`
  - `updated_at` timestamptz default `now()`
  - `updated_by` uuid FK `auth.users(id)`

## Security and access
- API: `src/app/api/settings/route.ts`
  - `GET /api/settings?biz_id=...`
    - Pattern B guard via `requireBizAccessPatternB`
    - 404 indistinguishable for cross-tenant/non-existent
    - auto-creates defaults (idempotent upsert) when row missing
  - `PATCH /api/settings?biz_id=...`
    - Pattern B guard + RBAC owner/manager only
    - staff/insufficient role => 404
    - zod + sanitization (instructions, keywords)
    - audit event `settings_updated` with before/after and request context
- RLS:
  - SELECT: accepted org members for biz
  - INSERT/UPDATE: owner/manager only

## Frontend
- UI component: `src/components/settings/SettingsPage.tsx`
- Route entry: `src/app/dashboard/settings/page.tsx`
- Navigation link updated in `src/components/layout/MainLayout.tsx`
- Persistència:
  - load with GET `/api/settings`
  - debounce autosave (500ms) with PATCH
  - success toast: `Desat`
