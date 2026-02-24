# OpinIA v2 — Migration Guide & Testing

## Què ha canviat

### Fitxers NOUS (creats des de zero)
```
src/contexts/WorkspaceContext.tsx          — Workspace state (org/biz switcher)
src/app/dashboard/inbox/page.tsx          — Unified Inbox amb filtres
src/app/dashboard/inbox/[reviewId]/page.tsx — Review Detail + Composer (split view)
src/app/dashboard/settings/page.tsx       — Settings: Brand Voice + KB + Integrations
src/app/dashboard/page.tsx                — Redirect → /inbox
src/app/api/reviews/[reviewId]/generate/route.ts — AI generation amb KB + guardrails
src/app/api/replies/[replyId]/approve/route.ts   — Approve & publish reply
src/app/api/kb/route.ts                   — Knowledge Base CRUD
```

### Fitxers REESCRITS (100% nou contingut)
```
src/types/database.ts          — Tots els tipus v2 (Business, Membership, KBEntry, etc.)
src/lib/utils.ts               — Helpers ampliats (tone, status, source, workspace persistence)
src/lib/prompts.ts             — Prompts amb KB injection + guardrail detection
src/app/dashboard/layout.tsx   — Layout amb org/biz workspace switcher
src/app/onboarding/page.tsx    — Onboarding que crea Business sota memberships
src/app/(auth)/callback/route.ts — Callback via memberships (no profiles.org_id)
src/components/ui/ResponseCard.tsx — Adaptat a v2 types
```

### Fitxers ELIMINATS
```
src/app/dashboard/history/page.tsx    — Substituït per Inbox
src/app/api/generate-response/route.ts — Substituït per /api/reviews/[id]/generate
```

### Fitxers SENSE CANVIS
```
src/app/page.tsx                   — Landing page (funciona amb ResponseCard v2)
src/app/(auth)/login/page.tsx      — Login page
src/app/layout.tsx                 — Root layout
src/middleware.ts                  — Auth middleware
src/lib/supabase/client.ts        — Supabase client
src/lib/supabase/server.ts        — Supabase server
src/lib/supabase/middleware.ts     — Supabase middleware
src/app/api/profile-detect/route.ts — Profile detection
src/components/ui/Button.tsx       — Button component
src/components/ui/Input.tsx        — Input component
src/components/ui/Logo.tsx         — Logo component
src/components/ui/StarRating.tsx   — Star rating
src/components/ui/TagInput.tsx     — Tag input
tailwind.config.ts                 — (no changes needed)
```


## SQL de migració

Has de córrer els dos SQL en ordre sobre un Supabase project net:

```bash
# 1. Schema base (orgs, memberships, businesses, reviews, replies, integrations, sync_log)
# Fitxer: supabase/schema-v2.sql

# 2. Extensions (KB, topics, activity, growth, usage)
# Fitxer: supabase/schema-v2-extensions.sql
```

Si tens dades del v1, consulta la secció "Migration Path from v1" al `docs/architecture-v2.md`.


## Dependència de la vella tabla `settings`

**ZERO.** Tota la config de negoci ara viu a `businesses`:
- `businesses.name` = antic `settings.business_name`
- `businesses.type` = antic `settings.business_type`
- `businesses.tags` = antic `settings.tags`
- `businesses.formality` = antic `settings.formality`
- `businesses.default_signature` = antic `settings.default_signature`
- `businesses.default_language` = antic `settings.default_language`
- `businesses.onboarding_done` = antic `settings.onboarding_complete`

La taula `settings` ja NO existeix al schema v2.


## Dependència de `profiles.org_id`

**ZERO.** El camp `org_id` ja no existeix a `profiles`. La relació user → org passa per `memberships`:

```sql
-- Antic (v1):
SELECT org_id FROM profiles WHERE id = auth.uid()

-- Nou (v2):
SELECT org_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
```

El `WorkspaceContext` gestiona tot això automàticament al frontend.


## Passos per provar en local

### 1. Setup Supabase

```bash
# Opció A: Supabase Cloud (recomanat per provar ràpid)
# Crea projecte a supabase.com
# Ves a SQL Editor → New query → Enganxa schema-v2.sql → Run
# Ves a SQL Editor → New query → Enganxa schema-v2-extensions.sql → Run

# Opció B: Supabase Local
npx supabase init
npx supabase start
npx supabase db reset  # aplica migrations
```

### 2. Config Auth

Al dashboard de Supabase:
- Authentication → Providers → Google: activa i configura OAuth credentials
- Authentication → URL Configuration:
  - Site URL: `http://localhost:3000`
  - Redirect URLs: `http://localhost:3000/callback`

### 3. Env vars

```bash
cp .env.local.example .env.local
# Edita amb les teves claus:
```

`.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhb...
OPENAI_API_KEY=sk-...        # Opcional: sense ella, funciona amb respostes demo
```

### 4. Run

```bash
npm install
npm run dev
# Obre http://localhost:3000
```

### 5. Test flow

1. **Login** → Google OAuth o email/password
2. **Onboarding** → Crear negoci (nom, tipus, ciutat, veu)
3. **Inbox** → Clic "+ Afegir ressenya" → Enganxa text + rating
4. **Review Detail** → Clic la ressenya → "Generar respostes"
5. **Composer** → Selecciona to → Edita inline → Prova modificadors (Més curt, Més empàtic...)
6. **Guardrails** → Si la resposta menciona preus/horaris sense KB, apareix warning vermell
7. **Approve** → "Aprovar i publicar" → Canvia status a published
8. **Settings** → Veu IA: canvia signatura, instruccions
9. **Settings** → Business Memory: afegeix entries (parking, horaris, etc.)
10. **Regenerar** → Torna a una ressenya → Regenera → Ara utilitza el KB

### 6. Test workspace switcher

Si vols testejar multi-org o multi-business:

```sql
-- Crea un segon negoci per al mateix org
INSERT INTO businesses (org_id, name, type, slug, onboarding_done, default_language)
SELECT org_id, 'Restaurant El Serrallo', 'restaurant', 'serrallo', true, 'ca'
FROM businesses LIMIT 1;
```

Recarrega la pàgina → El switcher al header mostrarà 2 negocis.


## Arquitectura de flux de dades

```
Login → callback/route.ts
  ↓ checks memberships (NOT profiles.org_id)
  ↓ redirects to /onboarding if no business
  
Onboarding → creates business under membership's org_id
  ↓ INSERT INTO businesses
  ↓ redirects to /dashboard/inbox

Dashboard Layout
  ↓ WorkspaceProvider loads: memberships → orgs → businesses
  ↓ Persists selection in localStorage
  ↓ Provides org/biz to all child pages

Inbox → reads reviews WHERE biz_id = selected biz
  ↓ filters: status, sentiment, source, rating, language

Review Detail → loads review + replies + kb_entries
  ↓ POST /api/reviews/[id]/generate
      → builds prompt with KB + brand voice
      → calls OpenAI (or demo fallback)
      → runs guardrail detection
      → saves 3 replies as drafts
  ↓ User selects tone, edits, approves
  ↓ reply.status = 'published', others = 'archived'
  ↓ review.is_replied = true
```


## Què NO s'ha implementat (de moment)

- Google Business Profile OAuth flow real (estructura `integrations` preparada)
- TripAdvisor/Booking import per URL/CSV (estructura `review_source` preparada)
- Analytics/Insights dashboard (taula `review_topics` preparada)
- Growth/QR (taula `growth_links` preparada)
- Team invitations (memberships INSERT policy preparada)
- Cron sync jobs (taula `sync_log` preparada)
- Stripe billing
- Auto-publish (camp `auto_publish_enabled` a businesses)

Tot això està preparat a schema + types, llest per implementar seguint el roadmap del Platform Blueprint.
