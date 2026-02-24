import type { GenerateResponseInput, GuardrailWarning, ReplyTone } from '@/types/database';

function getRatingGuidance(rating: number): string {
  const guides: Record<number, string> = {
    5: 'Rating 5: Express sincere gratitude. Reinforce positives mentioned. Warmly invite to return.',
    4: 'Rating 4: Thank warmly. Acknowledge positives and any detail. Gently note commitment to perfection.',
    3: 'Rating 3: Thank sincerely. Acknowledge mixed experience. Show commitment to improvement. Offer contact optionally.',
    2: 'Rating 2: Clear, sincere apology. Acknowledge issues. Describe actions to improve. Offer private contact.',
    1: 'Rating 1: Humble apology. Take responsibility. Describe immediate actions. Offer private resolution.',
  };
  return guides[rating] || '';
}

export function buildGeneratePrompt(input: GenerateResponseInput): string {
  const { review_text, sentiment, rating, business_profile, kb_entries, modifier } = input;
  const { business_name, business_type, tags, formality, signature, language, ai_instructions, tone_keywords_positive, tone_keywords_negative } = business_profile;

  const formalityGuide = formality === 'tu'
    ? 'Use INFORMAL "tu" form (Catalan/Spanish) or equivalent casual tone.'
    : 'Use FORMAL "vostè/usted" form (Catalan/Spanish) or equivalent formal tone.';

  const kbSection = kb_entries.length > 0
    ? `\nBUSINESS KNOWLEDGE BASE (facts you CAN reference if relevant — NEVER invent beyond these):\n${kb_entries.map(e => `- [${e.type}] ${e.topic}: ${e.content}`).join('\n')}`
    : '\nNo knowledge base entries available. Do NOT invent any specific facts.';

  const keywordsSection = (tone_keywords_positive.length || tone_keywords_negative.length)
    ? `\nVOCABULARY RULES:\n${tone_keywords_positive.length ? `- PREFER using: ${tone_keywords_positive.join(', ')}` : ''}${tone_keywords_negative.length ? `\n- NEVER use: ${tone_keywords_negative.join(', ')}` : ''}`
    : '';

  const modifierSection = modifier
    ? `\nMODIFIER — Apply this adjustment to ALL 3 options:\n${({
        shorter: 'Make responses 30-40% SHORTER. Be concise. Maximum 2-3 sentences.',
        formal: 'Increase formality significantly. More structured, business-appropriate language.',
        empathic: 'Increase emotional warmth. More personal, caring, understanding tone.',
        assertive: 'Be more direct and confident. Solution-focused. Less apologetic (unless 1-2 stars).',
      })[modifier]}`
    : '';

  return `You are an expert response writer for hospitality businesses. Generate 3 response options.

BUSINESS: ${business_name} (${business_type})
Tags: ${tags.join(', ')}
Signature: ${signature || business_name}
${ai_instructions ? `\nSPECIAL INSTRUCTIONS: ${ai_instructions}` : ''}
${kbSection}
${keywordsSection}

REVIEW:
Text: "${review_text}"
Rating: ${rating}/5 — ${sentiment}

${getRatingGuidance(rating)}

LANGUAGE: Detect review language. Respond in SAME language. Default: ${language}. ${formalityGuide}
${modifierSection}

Generate 3 options:
A) "Proper" — Warm, empathetic, heartfelt, personal
B) "Professional" — Direct, structured, business-appropriate, solution-oriented
C) "Premium" — Sophisticated, polished, elegant, refined hospitality

CRITICAL:
- NEVER invent facts/amenities/details not in the review or knowledge base
- Each option GENUINELY different in tone
- 2-4 sentences for positive, 3-5 for negative
- Include signature naturally
- For EACH response, if you reference a number, price, schedule, or specific fact, add "{{VERIFY:the_fact}}" markers around it so we can check

Respond ONLY valid JSON:
{
  "language_detected": "ca|es|en|fr|it|pt",
  "option_a": "text",
  "option_b": "text",
  "option_c": "text"
}`;
}

// --- Guardrail: detect unverified facts ---
export function detectGuardrailWarnings(
  responses: { option_a: string; option_b: string; option_c: string },
  kbContent: string
): GuardrailWarning[] {
  const warnings: GuardrailWarning[] = [];
  const toneMap: Record<string, ReplyTone> = { option_a: 'proper', option_b: 'professional', option_c: 'premium' };

  // Patterns to flag
  const pricePattern = /\d+[\s,.]?\d*\s*[€$£]/g;
  const timePattern = /\b\d{1,2}[:.]\d{2}\s*(h|am|pm|hores)?\b/gi;
  const percentPattern = /\b\d+\s*%/g;
  const verifyPattern = /\{\{VERIFY:(.*?)\}\}/g;

  for (const [key, text] of Object.entries(responses)) {
    const tone = toneMap[key];
    if (!tone) continue;

    // Clean verify markers and check them
    let match;
    while ((match = verifyPattern.exec(text)) !== null) {
      const fact = match[1];
      if (!kbContent.toLowerCase().includes(fact.toLowerCase().trim())) {
        warnings.push({ tone, type: 'unverified_fact', text: `Fet no verificat al KB`, span: fact });
      }
    }

    // Check for prices not in KB
    const prices = text.match(pricePattern);
    if (prices) {
      for (const p of prices) {
        if (!kbContent.includes(p)) {
          warnings.push({ tone, type: 'price_mention', text: `Preu mencionat: ${p}`, span: p });
        }
      }
    }

    // Check for times not in KB
    const times = text.match(timePattern);
    if (times) {
      for (const t of times) {
        if (!kbContent.includes(t)) {
          warnings.push({ tone, type: 'schedule_mention', text: `Horari mencionat: ${t}`, span: t });
        }
      }
    }
  }

  return warnings;
}

// Strip verify markers from final text
export function cleanVerifyMarkers(text: string): string {
  return text.replace(/\{\{VERIFY:(.*?)\}\}/g, '$1');
}

export function buildProfileDetectPrompt(url: string): string {
  return `Analyze this business URL and extract profile info. Infer from URL structure if needed.

URL: ${url}

Return ONLY valid JSON:
{
  "business_name": "string",
  "business_type": "restaurant|hotel|apartment|bar|cafe|shop|other",
  "tags": ["tag1", "tag2", "tag3"],
  "default_signature": "string",
  "formality_default": "tu|voste",
  "language_default": "ca|es|en"
}`;
}
