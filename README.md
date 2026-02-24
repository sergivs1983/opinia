# OpinIA

Genera respostes professionals amb IA a ressenyes de negocis (restaurants, hotels, apartaments) amb perfil de marca personalitzat.

## Stack

- **Next.js 14** (App Router) + TypeScript
- **Tailwind CSS** (custom design system)
- **Supabase** (Auth + PostgreSQL + RLS)
- **OpenAI** (GPT-4o-mini per generació)
- Deploy a **Vercel**

## Funcionalitats

- Login amb Google, Apple i correu (Supabase Auth)
- Auto-detecció de perfil de negoci des d'URL
- Generació de 3 tons de resposta: Proper, Professional, Premium
- Selector d'estrelles (1-5) amb sentiment automàtic
- Detecció automàtica d'idioma (CA/ES/EN/FR)
- Historial de ressenyes amb filtres
- Mode demo sense login (1 prova)
- RLS complet per organització

## Setup

### 1. Clonar i instal·lar

```bash
git clone <repo>
cd opinia
npm install
```

### 2. Supabase

1. Crea un projecte a [supabase.com](https://supabase.com)
2. Ves a **SQL Editor** i executa el contingut de `supabase/schema.sql`
3. Ves a **Authentication > Providers** i activa:
   - Email (activat per defecte)
   - Google (necessites OAuth credentials de Google Cloud)
   - Apple (opcional, necessites Apple Developer account)
4. Ves a **Authentication > URL Configuration** i afegeix:
   - Site URL: `http://localhost:3000`
   - Redirect URLs: `http://localhost:3000/callback`

### 3. Variables d'entorn

Copia `.env.local.example` a `.env.local`:

```bash
cp .env.local.example .env.local
```

Omple les variables:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- `SUPABASE_URL` i `ANON_KEY`: Settings > API al dashboard de Supabase
- `OPENAI_API_KEY`: [platform.openai.com](https://platform.openai.com)
  - **Opcional**: sense API key l'app funciona amb respostes demo

### 4. Run local

```bash
npm run dev
```

Obre [http://localhost:3000](http://localhost:3000)

### 5. Deploy a Vercel

1. Puja el projecte a GitHub
2. Importa a [vercel.com](https://vercel.com)
3. Afegeix les env vars al dashboard de Vercel
4. Actualitza les URLs de redirect a Supabase:
   - Site URL: `https://el-teu-domini.vercel.app`
   - Redirect URLs: `https://el-teu-domini.vercel.app/callback`

## Estructura del projecte

```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx        # Login page
│   │   └── callback/route.ts     # OAuth callback
│   ├── api/
│   │   ├── profile-detect/       # POST - auto-detect business profile
│   │   └── generate-response/    # POST - generate AI responses
│   ├── dashboard/
│   │   ├── layout.tsx            # Dashboard shell
│   │   ├── page.tsx              # Main - review input & generation
│   │   └── history/page.tsx      # Review history
│   ├── onboarding/page.tsx       # Business profile setup
│   ├── page.tsx                  # Landing page
│   ├── layout.tsx                # Root layout
│   └── globals.css               # Global styles + Tailwind
├── components/ui/
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── Logo.tsx
│   ├── ResponseCard.tsx
│   ├── StarRating.tsx
│   └── TagInput.tsx
├── lib/
│   ├── prompts.ts                # AI prompt builders
│   ├── utils.ts                  # Utility functions
│   └── supabase/
│       ├── client.ts             # Browser client
│       ├── server.ts             # Server client
│       └── middleware.ts         # Session management
├── middleware.ts                  # Route protection
└── types/
    └── database.ts               # TypeScript types
```

## Database Schema

Executar `supabase/schema.sql` crea:

- `organizations` - Cada negoci
- `profiles` - Vinculat a auth.users, auto-creat amb trigger
- `settings` - Configuració de marca per org
- `reviews` - Ressenyes guardades amb rating (1-5)
- `replies` - Respostes generades (3 per ressenya)

Amb RLS complet: cada usuari només veu la seva organització.

## Notes

- Sense `OPENAI_API_KEY`, l'app genera respostes demo funcionals en CA/ES/EN
- El mode demo permet 1 prova sense registre
- El sentiment es calcula automàticament pel rating (1-2: negatiu, 3: neutre, 4-5: positiu) amb opció de canvi manual
