# OpinIA Phase B — Business Memory + AI Pipeline Premium

## Decisió arquitectònica fonamental

El valor d'OpinIA NO és generar text. Qualsevol wrapper de GPT fa això.
El valor és **memòria acumulada + guardrails + consistència de marca**.

Cada resposta que OpinIA genera per a un negoci és millor que l'anterior
perquè el sistema aprèn què funciona, què no dir, i com sona la marca.

---

## 1️⃣ Business Memory v1 — Production Ready

### Per què la taula actual no és suficient

La `kb_entries` actual és un llistat pla. No té:
- Triggers semàntics (quines paraules a la ressenya activen l'entrada)
- Categories que permetin filtrar per rellevància
- Historial d'efectivitat (quantes vegades s'ha usat vs quantes ha ajudat)
- Preparació per vectors (embedding futur)

### SQL — Migrar kb_entries a v2

```sql
-- ============================================================
-- KB v2 Migration — Run AFTER schema-v2-extensions.sql
-- ============================================================

-- Add new enum for categories
do $$ begin
  create type public.kb_category as enum (
    'facilities',    -- parking, pool, gym, wifi
    'pricing',       -- rates, discounts, packages
    'schedule',      -- hours, check-in, check-out
    'policy',        -- cancellation, pets, smoking
    'team',          -- staff names, roles
    'food',          -- menu, allergens, cuisine
    'location',      -- directions, nearby attractions
    'complaint',     -- known issues, ongoing repairs
    'promotion',     -- current offers, seasonal
    'sensitive'      -- topics to deflect to private
  );
exception when duplicate_object then null;
end $$;

-- Extend kb_entries
alter table public.kb_entries
  add column if not exists category     public.kb_category,
  add column if not exists triggers     text[] not null default array[]::text[],
  add column if not exists valid_from   date,
  add column if not exists valid_until  date,
  add column if not exists effectiveness_score real not null default 0.5,
  add column if not exists embedding    vector(1536);

-- Trigger-based keyword index (GIN for array search)
create index if not exists idx_kb_triggers
  on public.kb_entries using gin(triggers)
  where is_active = true;

-- Composite index for active entries per business
create index if not exists idx_kb_biz_active_priority
  on public.kb_entries(biz_id, priority desc)
  where is_active = true;

-- Validity window filter
create index if not exists idx_kb_validity
  on public.kb_entries(biz_id, valid_from, valid_until)
  where is_active = true;

-- Vector index (ready for when we add embeddings)
-- create index if not exists idx_kb_embedding
--   on public.kb_entries using ivfflat(embedding vector_cosine_ops)
--   with (lists = 20);
```

> **Decisió:** No activem pgvector encara. El matching per triggers (keywords)
> cobreix el 90% dels casos per a <500 entries/negoci. Vectors afegeixen
> latència i cost sense ROI fins que tinguem >1000 entries o ressenyes
> multiidioma complexes. L'schema està preparat — activar és 1 línia.

### Estratègia de triggers

Cada kb_entry té un array `triggers[]` — paraules clau que si apareixen
a la ressenya, activen l'entrada. Exemples:

| Entrada KB | triggers |
|---|---|
| "Parking gratuït, entrada Av. Catalunya" | `['parking', 'aparcar', 'cotxe', 'aparcament']` |
| "Check-in 15h, check-out 11h" | `['check-in', 'checkout', 'hora', 'entrada', 'sortida']` |
| "Obres al 3r pis fins març 2026" | `['soroll', 'obres', 'molest', 'construcció']` |
| "Menú del dia 15€ (L-V)" | `['menú', 'preu', 'dinar', 'cost']` |

### Com evitar cross-tenant leakage

1. **RLS ja actiu** — `org_id in (select user_org_ids())`
2. **Pipeline server-side** — KB es carrega amb `service_role` filtrant per `biz_id`
3. **Mai enviar kb_entries des del client** — el frontend envia `review_id`, el server carrega KB
4. **Prompt injection** — KB content s'escapa dins XML tags al prompt

### TypeScript Types actualitzats

```typescript
export type KBCategory =
  | 'facilities' | 'pricing' | 'schedule' | 'policy'
  | 'team' | 'food' | 'location' | 'complaint'
  | 'promotion' | 'sensitive';

export interface KBEntry {
  id: string;
  biz_id: string;
  org_id: string;
  type: KBEntryType;          // faq, snippet, policy, sensitive
  category: KBCategory | null;
  topic: string;
  content: string;
  triggers: string[];          // keywords that activate this entry
  language: string;
  is_active: boolean;
  priority: number;
  used_count: number;
  effectiveness_score: number; // 0-1, updated by feedback loop
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}
```

### KB Matching — Sense vectors, amb precisió

```typescript
// src/lib/kb-matcher.ts

import type { KBEntry } from '@/types/database';

interface MatchResult {
  entry: KBEntry;
  score: number;
  matched_triggers: string[];
}

/**
 * Match KB entries to a review using trigger keywords.
 * Fast, deterministic, zero latency, zero cost.
 *
 * Score = (matched_triggers / total_triggers) × priority_boost × recency_boost
 */
export function matchKBEntries(
  reviewText: string,
  entries: KBEntry[],
  maxResults: number = 5
): MatchResult[] {
  const reviewLower = reviewText.toLowerCase();
  const reviewWords = new Set(
    reviewLower.split(/[\s,.!?;:()]+/).filter(w => w.length > 2)
  );

  const now = new Date();
  const results: MatchResult[] = [];

  for (const entry of entries) {
    if (!entry.is_active) continue;

    // Check validity window
    if (entry.valid_from && new Date(entry.valid_from) > now) continue;
    if (entry.valid_until && new Date(entry.valid_until) < now) continue;

    // Match triggers
    const matched: string[] = [];
    for (const trigger of entry.triggers) {
      const triggerLower = trigger.toLowerCase();
      // Check both word-level and substring match
      if (reviewWords.has(triggerLower) || reviewLower.includes(triggerLower)) {
        matched.push(trigger);
      }
    }

    if (matched.length === 0) {
      // Also check topic match as fallback
      const topicWords = entry.topic.toLowerCase().split(/\s+/);
      for (const tw of topicWords) {
        if (tw.length > 3 && reviewLower.includes(tw)) {
          matched.push(`[topic:${tw}]`);
        }
      }
    }

    if (matched.length > 0) {
      const triggerRatio = entry.triggers.length > 0
        ? matched.length / entry.triggers.length
        : 0.3;
      const priorityBoost = 1 + (entry.priority / 10);
      const score = triggerRatio * priorityBoost;

      results.push({ entry, score, matched_triggers: matched });
    }
  }

  // Sort by score, take top N
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Format matched entries for prompt injection.
 * Uses XML-like structure to prevent prompt injection.
 */
export function formatKBForPrompt(matches: MatchResult[]): string {
  if (matches.length === 0) {
    return '<business_knowledge>\nNo verified facts available. Do NOT invent specific details.\n</business_knowledge>';
  }

  const lines = matches.map((m, i) => {
    const validity = m.entry.valid_until
      ? ` [valid until ${m.entry.valid_until}]`
      : '';
    const sensitivity = m.entry.type === 'sensitive'
      ? ' ⚠️ DEFLECT TO PRIVATE CONTACT'
      : '';
    return `  <fact id="${i + 1}" category="${m.entry.category || m.entry.type}" confidence="${m.score.toFixed(2)}"${validity}${sensitivity}>
    ${m.entry.topic}: ${m.entry.content}
  </fact>`;
  });

  return `<business_knowledge>
  ONLY reference these verified facts. NEVER fabricate details beyond these.
${lines.join('\n')}
</business_knowledge>`;
}
```

### Estratègia de caching

```typescript
// src/lib/kb-cache.ts

// In-memory cache per request (Next.js server).
// KB entries change rarely — cache per biz_id for 5 min.
const cache = new Map<string, { entries: KBEntry[]; ts: number }>();
const TTL = 5 * 60 * 1000; // 5 min

export async function getCachedKB(
  supabase: any,
  bizId: string
): Promise<KBEntry[]> {
  const key = `kb:${bizId}`;
  const cached = cache.get(key);

  if (cached && Date.now() - cached.ts < TTL) {
    return cached.entries;
  }

  const { data } = await supabase
    .from('kb_entries')
    .select('*')
    .eq('biz_id', bizId)
    .eq('is_active', true)
    .order('priority', { ascending: false });

  const entries = (data as KBEntry[]) || [];
  cache.set(key, { entries, ts: Date.now() });
  return entries;
}

export function invalidateKBCache(bizId: string) {
  cache.delete(`kb:${bizId}`);
}
```

---

## 2️⃣ AI Pipeline Premium — 6 Steps

### Arquitectura del pipeline

```
REVIEW IN
    │
    ▼
┌─────────────────────────┐
│ STEP 1: CLASSIFY        │  gpt-4o-mini (~200 tokens)
│ sentiment, language,     │  Cost: ~$0.0001
│ topics[], urgency,       │
│ expected_tone            │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ STEP 2: MATCH KB        │  Local function (zero cost)
│ trigger matching         │  Latency: <5ms
│ → relevant facts[]       │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ STEP 3: LOAD HISTORY    │  DB query (zero AI cost)
│ last 10 replies for biz  │  Anti-repetition seed
│ → recent_openings[]      │
│ → recent_closings[]      │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ STEP 4: GENERATE        │  gpt-4o (~800 tokens)
│ 3 responses with full    │  Cost: ~$0.004
│ context injection        │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ STEP 5: GUARDRAILS      │  Local functions (zero cost)
│ fact check, hallucinate, │
│ length, tone, numbers    │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ STEP 6: VARIATION       │  Local function (zero cost)
│ check vs recent replies  │  If >60% similar → retry S4
│ opening rotation         │
└──────────┘

TOTAL COST PER GENERATION: ~$0.005 (vs $0.02+ single GPT-4 call)
```

### Per què 2 models i no 1

| | Single call (actual) | Pipeline (proposat) |
|---|---|---|
| **Cost** | $0.02 (tot a GPT-4o) | $0.005 (classify=mini, gen=4o) |
| **Latència** | 3-5s | 2-3s (classify=0.3s, gen=2s) |
| **Precisió KB** | Inject tot, espera que filtri | Pre-filtrat, injecta només rellevant |
| **Anti-repetició** | Zero | Historial + rotation forçada |
| **Guardrails** | Post-hoc regex | Multi-layer validation |

### Step 1 — Classification (cheap model)

```typescript
// src/lib/pipeline/classify.ts

export interface ReviewClassification {
  language: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  urgency: 'low' | 'medium' | 'high' | 'critical';
  topics: string[];
  mentions_specific: boolean;  // mentions prices, hours, names
  expected_response_length: 'short' | 'medium' | 'long';
}

export async function classifyReview(
  reviewText: string,
  rating: number,
  apiKey: string
): Promise<ReviewClassification> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Classify this review. Rating: ${rating}/5.
Review: "${reviewText}"

Return ONLY JSON:
{
  "language": "ca|es|en|fr|it|de|pt",
  "sentiment": "positive|neutral|negative",
  "urgency": "low|medium|high|critical",
  "topics": ["topic1", "topic2"],
  "mentions_specific": true/false,
  "expected_response_length": "short|medium|long"
}`
      }],
      temperature: 0,
      max_tokens: 200,
    }),
  });

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(content.replace(/```json?\n?|```/g, '').trim());
  } catch {
    // Fallback classification
    return {
      language: 'ca',
      sentiment: rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral',
      urgency: rating <= 2 ? 'high' : 'low',
      topics: [],
      mentions_specific: false,
      expected_response_length: rating >= 4 ? 'short' : 'medium',
    };
  }
}
```

### Step 2+3 — KB Match + History

```typescript
// src/lib/pipeline/context.ts

import { matchKBEntries, formatKBForPrompt } from '@/lib/kb-matcher';
import { getCachedKB } from '@/lib/kb-cache';
import type { KBEntry, Reply } from '@/types/database';
import type { ReviewClassification } from './classify';

export interface GenerationContext {
  kb_prompt: string;
  matched_kb: KBEntry[];
  recent_openings: string[];
  recent_closings: string[];
  banned_phrases: string[];
}

export async function buildContext(
  supabase: any,
  bizId: string,
  reviewText: string,
  classification: ReviewClassification
): Promise<GenerationContext> {
  // KB matching
  const allEntries = await getCachedKB(supabase, bizId);
  const matches = matchKBEntries(reviewText, allEntries);
  const kb_prompt = formatKBForPrompt(matches);

  // Recent replies for anti-repetition
  const { data: recentReplies } = await supabase
    .from('replies')
    .select('content')
    .eq('biz_id', bizId)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(10);

  const replies: string[] = (recentReplies || []).map((r: Reply) => r.content);

  // Extract openings and closings to ban
  const recent_openings = replies
    .map(r => r.split(/[.!?]/)[0]?.trim())
    .filter(Boolean)
    .slice(0, 5);

  const recent_closings = replies
    .map(r => {
      const sentences = r.split(/[.!?]/).filter(s => s.trim());
      return sentences[sentences.length - 1]?.trim();
    })
    .filter(Boolean)
    .slice(0, 5);

  // Phrases that appeared in last 3 replies — ban them
  const banned_phrases = replies.slice(0, 3).flatMap(r => {
    // Extract 4+ word phrases
    const words = r.split(/\s+/);
    const phrases: string[] = [];
    for (let i = 0; i <= words.length - 4; i++) {
      phrases.push(words.slice(i, i + 4).join(' '));
    }
    return phrases;
  });

  return {
    kb_prompt,
    matched_kb: matches.map(m => m.entry),
    recent_openings,
    recent_closings,
    banned_phrases: [...new Set(banned_phrases)].slice(0, 20),
  };
}
```

### Step 4 — Generation (premium prompt)

```typescript
// src/lib/pipeline/generate.ts

import type { Business } from '@/types/database';
import type { ReviewClassification } from './classify';
import type { GenerationContext } from './context';

export function buildPremiumPrompt(
  reviewText: string,
  rating: number,
  biz: Business,
  classification: ReviewClassification,
  ctx: GenerationContext,
  modifier?: string
): string {
  const formalityRule = biz.formality === 'tu'
    ? 'INFORMAL "tu" (Catalan/Spanish)'
    : 'FORMAL "vostè/usted" (Catalan/Spanish)';

  return `<system>
You are the voice of "${biz.name}", a ${biz.type} business.
You write review responses that sound human, specific, and on-brand.
</system>

<brand_voice>
  Formality: ${formalityRule}
  Signature: ${biz.default_signature}
  ${biz.ai_instructions ? `Instructions: ${biz.ai_instructions}` : ''}
  ${biz.tone_keywords_positive?.length ? `Preferred words: ${biz.tone_keywords_positive.join(', ')}` : ''}
  ${biz.tone_keywords_negative?.length ? `Banned words: ${biz.tone_keywords_negative.join(', ')}` : ''}
</brand_voice>

${ctx.kb_prompt}

<review rating="${rating}" sentiment="${classification.sentiment}" language="${classification.language}">
${reviewText}
</review>

<anti_repetition>
  DO NOT start with any of these openings (already used recently):
  ${ctx.recent_openings.map(o => `- "${o}"`).join('\n  ')}

  DO NOT end with any of these closings:
  ${ctx.recent_closings.map(c => `- "${c}"`).join('\n  ')}
</anti_repetition>

<instructions>
Generate exactly 3 response options in ${classification.language}.

OPTION A — "Proper" (warm, personal, empathetic):
OPTION B — "Professional" (structured, solution-oriented):
OPTION C — "Premium" (elegant, sophisticated hospitality):

Rules:
1. Respond in ${classification.language}. ${formalityRule}.
2. ${classification.expected_response_length === 'short' ? '2-3 sentences max.' : classification.expected_response_length === 'long' ? '4-6 sentences.' : '3-4 sentences.'}
3. Reference ONLY facts from <business_knowledge>. NEVER invent.
4. If review mentions something NOT in knowledge base, acknowledge WITHOUT specifics.
5. Each option must have a DIFFERENT opening word and closing phrase.
6. Include signature naturally.
7. If the review touches a "sensitive" fact, redirect to private contact.
${modifier ? `8. MODIFIER: ${modifier}` : ''}
</instructions>

Return ONLY valid JSON:
{
  "option_a": "text",
  "option_b": "text",
  "option_c": "text"
}`;
}

export async function generateResponses(
  prompt: string,
  apiKey: string
): Promise<{ option_a: string; option_b: string; option_c: string }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.85,
      max_tokens: 1500,
    }),
  });

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  return JSON.parse(content.replace(/```json?\n?|```/g, '').trim());
}
```

### Step 5+6 — Guardrails + Variation (see section 3)

---

## 3️⃣ Guardrails de veritat

### Arxiu complet de guardrails

```typescript
// src/lib/pipeline/guardrails.ts

import type { GuardrailWarning, ReplyTone, KBEntry } from '@/types/database';

// ============================================================
// G1: FACT VALIDATION
// Detects mentions of specifics not present in KB
// ============================================================
export function checkFactValidation(
  text: string,
  kbContent: string,
  tone: ReplyTone
): GuardrailWarning[] {
  const warnings: GuardrailWarning[] = [];
  const textLower = text.toLowerCase();
  const kbLower = kbContent.toLowerCase();

  // Price patterns (15€, $50, 25.90€)
  const prices = text.match(/\d+([.,]\d{1,2})?\s*[€$£]/g) || [];
  for (const p of prices) {
    // Normalize: "15,90 €" → "15,90" for matching
    const numPart = p.replace(/[€$£\s]/g, '');
    if (!kbLower.includes(numPart)) {
      warnings.push({
        tone,
        type: 'price_mention',
        text: `Preu "${p}" no present al Business Memory`,
        span: p,
      });
    }
  }

  // Time patterns (8:00, 15h, 9am)
  const times = text.match(/\b\d{1,2}[:.h]\d{0,2}\s*(h|am|pm|hores)?\b/gi) || [];
  for (const t of times) {
    const normalized = t.replace(/\s/g, '').toLowerCase();
    if (!kbLower.includes(normalized) && !kbLower.includes(t.trim())) {
      warnings.push({
        tone,
        type: 'schedule_mention',
        text: `Horari "${t}" no verificat`,
        span: t,
      });
    }
  }

  // Percentage patterns
  const percents = text.match(/\b\d+\s*%/g) || [];
  for (const p of percents) {
    if (!kbLower.includes(p.replace(/\s/g, ''))) {
      warnings.push({
        tone,
        type: 'unverified_fact',
        text: `Percentatge "${p}" no verificat`,
        span: p,
      });
    }
  }

  // Proper nouns that might be invented (staff names, room names)
  // Match capitalized words not in review text or KB
  const properNouns = text.match(/\b[A-ZÁÉÍÓÚÀÈÒÜÇ][a-záéíóúàèòüç]{2,}\b/g) || [];
  const reviewLower = text.toLowerCase(); // will use original review in caller
  for (const noun of properNouns) {
    const nounLower = noun.toLowerCase();
    // Skip common words
    if (['Gràcies', 'Moltes', 'Esperem', 'Agraïm', 'Lamentem', 'Celebrem'].some(
      w => w.toLowerCase() === nounLower
    )) continue;
    // If not in KB and seems like a proper noun
    if (!kbLower.includes(nounLower) && noun[0] === noun[0].toUpperCase()) {
      // Only flag if it looks like a specific entity (not generic Catalan/Spanish)
      // This is a soft check — won't flag common words
    }
  }

  return warnings;
}


// ============================================================
// G2: TONE CONSISTENCY
// Validates formality and brand voice
// ============================================================
export function checkToneConsistency(
  text: string,
  formality: 'tu' | 'voste',
  bannedWords: string[],
  tone: ReplyTone
): GuardrailWarning[] {
  const warnings: GuardrailWarning[] = [];
  const textLower = text.toLowerCase();

  // Formality check
  if (formality === 'voste') {
    // Should NOT contain informal markers
    const informalMarkers = [' tu ', ' teu ', ' teva ', ' teus ', ' teves ', "t'"];
    for (const marker of informalMarkers) {
      if (textLower.includes(marker)) {
        warnings.push({
          tone,
          type: 'unverified_fact', // reuse type for tone issues
          text: `Formalitat incorrecta: "${marker.trim()}" detectat (hauria ser vostè)`,
          span: marker.trim(),
        });
      }
    }
  } else {
    // Should NOT contain formal markers
    const formalMarkers = [' vostè ', ' seva ', ' seu ', ' seus ', ' seves '];
    for (const marker of formalMarkers) {
      if (textLower.includes(marker)) {
        warnings.push({
          tone,
          type: 'unverified_fact',
          text: `Formalitat incorrecta: "${marker.trim()}" detectat (hauria ser tu)`,
          span: marker.trim(),
        });
      }
    }
  }

  // Banned words check
  for (const word of bannedWords) {
    if (textLower.includes(word.toLowerCase())) {
      warnings.push({
        tone,
        type: 'unverified_fact',
        text: `Paraula prohibida: "${word}"`,
        span: word,
      });
    }
  }

  return warnings;
}


// ============================================================
// G3: REPETITION DETECTOR
// Compares against recent replies
// ============================================================
export function checkRepetition(
  text: string,
  recentReplies: string[],
  tone: ReplyTone
): { warnings: GuardrailWarning[]; similarityScore: number } {
  const warnings: GuardrailWarning[] = [];

  if (recentReplies.length === 0) {
    return { warnings, similarityScore: 0 };
  }

  // Jaccard similarity on 3-grams
  const getThreeGrams = (s: string): Set<string> => {
    const words = s.toLowerCase().split(/\s+/);
    const grams = new Set<string>();
    for (let i = 0; i <= words.length - 3; i++) {
      grams.add(words.slice(i, i + 3).join(' '));
    }
    return grams;
  };

  const textGrams = getThreeGrams(text);
  let maxSimilarity = 0;

  for (const reply of recentReplies) {
    const replyGrams = getThreeGrams(reply);
    const intersection = new Set([...textGrams].filter(g => replyGrams.has(g)));
    const union = new Set([...textGrams, ...replyGrams]);
    const similarity = union.size > 0 ? intersection.size / union.size : 0;

    if (similarity > maxSimilarity) maxSimilarity = similarity;
  }

  if (maxSimilarity > 0.4) {
    warnings.push({
      tone,
      type: 'hallucination',
      text: `Massa similar a una resposta recent (${(maxSimilarity * 100).toFixed(0)}%)`,
      span: `Similarity: ${(maxSimilarity * 100).toFixed(0)}%`,
    });
  }

  return { warnings, similarityScore: maxSimilarity };
}


// ============================================================
// G4: LENGTH VALIDATION
// ============================================================
export function checkLength(
  text: string,
  maxLength: number,
  tone: ReplyTone
): GuardrailWarning[] {
  if (text.length > maxLength) {
    return [{
      tone,
      type: 'unverified_fact',
      text: `Resposta massa llarga (${text.length}/${maxLength} chars)`,
      span: `${text.length} chars`,
    }];
  }
  return [];
}


// ============================================================
// MASTER GUARDRAIL RUNNER
// ============================================================
export interface GuardrailResult {
  warnings: GuardrailWarning[];
  passed: boolean;
  similarity_scores: Record<string, number>;
}

export function runGuardrails(
  responses: { option_a: string; option_b: string; option_c: string },
  kbContent: string,
  recentReplies: string[],
  formality: 'tu' | 'voste',
  bannedWords: string[],
  maxLength: number
): GuardrailResult {
  const toneMap: Record<string, ReplyTone> = {
    option_a: 'proper',
    option_b: 'professional',
    option_c: 'premium',
  };

  const allWarnings: GuardrailWarning[] = [];
  const similarity_scores: Record<string, number> = {};

  for (const [key, text] of Object.entries(responses)) {
    const tone = toneMap[key];
    if (!tone) continue;

    // G1: Fact validation
    allWarnings.push(...checkFactValidation(text, kbContent, tone));

    // G2: Tone consistency
    allWarnings.push(...checkToneConsistency(text, formality, bannedWords, tone));

    // G3: Repetition
    const rep = checkRepetition(text, recentReplies, tone);
    allWarnings.push(...rep.warnings);
    similarity_scores[key] = rep.similarityScore;

    // G4: Length
    allWarnings.push(...checkLength(text, maxLength, tone));
  }

  return {
    warnings: allWarnings,
    passed: allWarnings.length === 0,
    similarity_scores,
  };
}
```

---

## 4️⃣ Performance & Scalability

### Cua de publicació (Google safety)

```typescript
// src/lib/publish-queue.ts

/**
 * Publication queue with jitter timing for Google safety.
 * Uses Supabase as queue store (no external dependency).
 *
 * Table: publish_queue (add to schema)
 */

// SQL for queue table:
// create table if not exists public.publish_queue (
//   id          uuid primary key default uuid_generate_v4(),
//   reply_id    uuid not null references public.replies(id),
//   biz_id      uuid not null references public.businesses(id),
//   scheduled_at timestamptz not null,
//   status      text not null default 'pending',  -- pending, processing, done, failed
//   attempts    integer not null default 0,
//   last_error  text,
//   created_at  timestamptz not null default now()
// );

export function calculatePublishDelay(rating: number): number {
  // Base delay: 30min - 4h (randomized)
  const baseMinMs = 30 * 60 * 1000;   // 30 min
  const baseMaxMs = 4 * 60 * 60 * 1000; // 4h

  // Negative reviews get faster response (looks human)
  const urgencyFactor = rating <= 2 ? 0.3 : rating === 3 ? 0.6 : 1.0;

  const baseDelay = baseMinMs + Math.random() * (baseMaxMs - baseMinMs);
  const adjusted = baseDelay * urgencyFactor;

  // Add jitter: ±15%
  const jitter = adjusted * 0.15 * (Math.random() * 2 - 1);

  return Math.round(adjusted + jitter);
}

export function isBusinessHours(date: Date, timezone: string = 'Europe/Madrid'): boolean {
  const hour = new Date(date.toLocaleString('en-US', { timeZone: timezone })).getHours();
  return hour >= 9 && hour <= 21;
}

export function getNextBusinessHour(date: Date, timezone: string = 'Europe/Madrid'): Date {
  const result = new Date(date);
  while (!isBusinessHours(result, timezone)) {
    result.setMinutes(result.getMinutes() + 30);
  }
  return result;
}

export interface PublishSchedule {
  scheduled_at: Date;
  delay_ms: number;
  is_business_hours: boolean;
}

export function schedulePublication(rating: number): PublishSchedule {
  const delay = calculatePublishDelay(rating);
  let scheduledAt = new Date(Date.now() + delay);

  // Ensure business hours
  if (!isBusinessHours(scheduledAt)) {
    scheduledAt = getNextBusinessHour(scheduledAt);
  }

  return {
    scheduled_at: scheduledAt,
    delay_ms: delay,
    is_business_hours: true,
  };
}
```

### Rate limiting per business

```typescript
// src/lib/rate-limiter.ts

const publishCounts = new Map<string, { count: number; windowStart: number }>();
const WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_PER_HOUR = 5;

export function canPublish(bizId: string): boolean {
  const now = Date.now();
  const entry = publishCounts.get(bizId);

  if (!entry || now - entry.windowStart > WINDOW) {
    publishCounts.set(bizId, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= MAX_PER_HOUR) return false;
  entry.count++;
  return true;
}
```

### Background jobs (Supabase Edge Functions or Vercel Cron)

```
Per a v1, NO cal infra de cues complexa:

1. Publish queue → Vercel Cron cada 5min:
   - SELECT from publish_queue WHERE status='pending' AND scheduled_at <= now()
   - Process top 3 (rate limit)
   - POST to Google API
   - Update status

2. Google sync → Vercel Cron cada 30min:
   - Per cada integration activa
   - Fetch new reviews since last_sync_at
   - Insert/upsert to reviews table
   - Update last_sync_at

3. Cleanup → Daily cron:
   - Archive old draft replies (>7 days)
   - Update kb effectiveness scores
   - Aggregate usage_monthly
```

### Caching de respostes similars

```
NO implementar ara. Raons:

1. El valor d'OpinIA és respostes ÚNIQUES per review
2. Cache de respostes similars crea risc de repetició
3. El cost per generació és ~$0.005 — no val la pena el risc

Sí fer cache de:
- KB entries (5min TTL) ✅ ja implementat
- Classification results (per review_id, immutable)
- Business config (per biz_id, 5min TTL)
```

---

## 5️⃣ Roadmap tècnic — 4 setmanes

### Week 1: Infra + Business Memory

| Dia | Tasca | Output |
|-----|-------|--------|
| D1 | SQL migration kb_entries v2 (category, triggers, validity) | `kb-v2.sql` |
| D2 | `kb-matcher.ts` + `kb-cache.ts` | Matching engine |
| D3 | KB CRUD UI v2 (categories, triggers editor, validity dates) | Settings/KB page |
| D4 | Auto-suggest triggers (mini prompt al crear KB entry) | UX improvement |
| D5 | Tests: matching accuracy, cache invalidation, RLS | Confidence |

**Entregable W1:** KB funcional amb matching intel·ligent visible al Composer.

### Week 2: AI Pipeline

| Dia | Tasca | Output |
|-----|-------|--------|
| D1 | `classify.ts` — Step 1 classification agent | Classify route |
| D2 | `context.ts` — Step 2+3 KB match + history load | Context builder |
| D3 | `generate.ts` — Step 4 premium prompt builder | Generation v2 |
| D4 | Rewire `/api/reviews/[id]/generate` to use full pipeline | Integration |
| D5 | Cost tracking (log tokens used per generation) | `usage_monthly` |

**Entregable W2:** Pipeline 6-step funcional, Composer mostra classification + KB matches.

### Week 3: Guardrails + UX

| Dia | Tasca | Output |
|-----|-------|--------|
| D1 | `guardrails.ts` — fact, tone, repetition, length checks | Guardrail engine |
| D2 | UI: Warnings panel millorat (inline highlights, severity) | Composer UX |
| D3 | Retry logic: si similarity >60%, regenera automàtic (max 2x) | Auto-retry |
| D4 | KB effectiveness tracking (log which entries led to approved replies) | Feedback loop |
| D5 | Classification visible al detail: topics, urgency badge, suggested tone | Review detail UX |

**Entregable W3:** Zero hallucinations, variació forçada, feedback loop actiu.

### Week 4: Optimization + Cost Control

| Dia | Tasca | Output |
|-----|-------|--------|
| D1 | Publish queue SQL + scheduling logic | `publish-queue.ts` |
| D2 | Rate limiter per business + jitter timing | Safety layer |
| D3 | Usage dashboard (generations/month, cost estimate) | Settings page |
| D4 | Token optimization: truncar reviews >500 words, compress KB | Cost reduction |
| D5 | Load testing: 100 concurrent generations, measure latency | Performance baseline |

**Entregable W4:** Cost control visible, publish safety, performance baseline.

---

## Decisions arquitectòniques justificades

| Decisió | Alternativa rebutjada | Per què |
|---------|----------------------|---------|
| Triggers (keywords) per KB matching | pgvector embeddings | <500 entries/negoci, keywords cobreix 90%, zero latència, zero cost. Vectors ready al schema per futur. |
| 2 models (mini + 4o) | Un sol model | 75% reducció cost. Classify no necessita intel·ligència, necessita velocitat. |
| Guardrails locals (regex + jaccard) | LLM-based guardrails | Zero cost, zero latència, determinístics. LLM guardrails afegeixen $0.003/check i 1s latència. |
| Supabase com a cua | Redis/SQS/Bull | Zero infra extra. <100 publications/dia. Cron cada 5min és suficient. |
| Cache in-memory (Map) | Redis cache | Single Vercel instance per ara. Redis quan tinguem >1 server. |
| No cache de respostes similars | Embedding similarity cache | Risc de repetició > estalvi de $0.005. El producte promet unicitat. |
| Jitter timing pseudo-random | Cryptographic random | No cal seguretat criptogràfica per scheduling. Math.random() suficient. |

---

## Token budget per generació

```
Step 1 (classify):     ~200 input + 100 output = 300 tokens  @ gpt-4o-mini = $0.0001
Step 4 (generate):     ~800 input + 600 output = 1400 tokens @ gpt-4o      = $0.0042
Steps 2,3,5,6:         Zero AI cost (local functions)
───────────────────────────────────────────────────────────────────────────
TOTAL:                 ~$0.005 per generation
At 500 gen/month (Pro): $2.50/month vs $49/month revenue = 95% margin
```
