export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { callLLMClient, CircuitOpenError } from '@/lib/llm/client';
import { createRequestId, createLogger } from '@/lib/logger';
import { sanitizeForPrompt } from '@/lib/api-handler';
import { createHash } from 'crypto';
import { validateBody, ReviewAuditSchema } from '@/lib/validations';

/**
 * POST /api/review-audit
 * PUBLIC — no auth required. Rate limited.
 *
 * Body: {
 *   reviews: [{ text: string, rating: number }],
 *   business_name?: string,
 *   email?: string
 * }
 * Returns: {
 *   summary, top_positives, top_negatives, actions, overall_score,
 *   response_rate_advice, sentiment_breakdown
 * }
 */

const RATE_LIMIT_PER_HOUR = 5; // stricter than demo (more expensive)

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/review-audit' });

  try {
    const [body, err] = await validateBody(request, ReviewAuditSchema);
    if (err) return err;

    const { reviews, business_name, email } = body;

    // Rate limit
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
    const ipHash = createHash('sha256').update(ip + '_opinia_audit_salt').digest('hex').slice(0, 16);

    const supabase = createServerSupabaseClient();
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supabase
      .from('audit_runs')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .eq('input_type', 'manual')
      .gte('created_at', oneHourAgo);

    if ((count || 0) >= RATE_LIMIT_PER_HOUR) {
      return NextResponse.json(
        { error: 'rate_limit', message: 'Massa auditories. Registra\'t per accés il·limitat!' },
        { status: 429 }
      );
    }

    const hasKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);

    // Build analysis
    const avgRating = reviews.reduce((s: number, r: any) => s + r.rating, 0) / reviews.length;
    const sentimentBreakdown = {
      positive: reviews.filter((r: any) => r.rating >= 4).length,
      neutral: reviews.filter((r: any) => r.rating === 3).length,
      negative: reviews.filter((r: any) => r.rating <= 2).length,
    };

    let aiAnalysis = null;

    if (hasKey && reviews.length >= 2) {
      const provider = process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai';
      const reviewBlock = reviews
        .slice(0, 10)
        .map((r: any, i: number) => `[${i + 1}] ${r.rating}★: "${sanitizeForPrompt(r.text.slice(0, 200))}"`)
        .join('\n');

      try {
        const result = await callLLMClient({
          provider: provider as any,
          temperature: 0.3,
          maxTokens: 800,
          orgId: '00000000-0000-0000-0000-000000000000',
          bizId: '00000000-0000-0000-0000-000000000000',
          requestId,
          feature: 'review_audit',
          messages: [
            {
              role: 'system',
              content: 'You analyze hotel/restaurant reviews. Output ONLY JSON. Be specific and actionable.',
            },
            {
              role: 'user',
              content: `Analyze these ${reviews.length} reviews for "${business_name || 'this business'}":

${reviewBlock}

Return JSON:
{
  "top_positives": ["strength 1", "strength 2", "strength 3"],
  "top_negatives": ["weakness 1", "weakness 2", "weakness 3"],
  "actions": [
    {"priority": "high|medium|low", "action": "specific action", "impact": "expected result"}
  ],
  "summary": "2-sentence executive summary in Catalan",
  "response_advice": "1 sentence about response strategy"
}`
            }
          ],
        });

        aiAnalysis = JSON.parse(result.content.replace(/```json?\n?|```/g, '').trim());
      } catch (err: any) {
        log.warn('Audit AI analysis failed', { error: err?.message?.slice(0, 100) });
      }
    }

    // Fallback analysis (heuristic)
    if (!aiAnalysis) {
      aiAnalysis = {
        top_positives: avgRating >= 3.5
          ? ['Valoració general positiva', 'Clients repetitius probables', 'Base per a creixement']
          : ['Oportunitat de millora clara', 'Feedback directe disponible', 'Marge per diferenciar-se'],
        top_negatives: avgRating < 3.5
          ? ['Satisfacció per sota de la mitjana', 'Risc de ressenyes negatives virals', 'Necessitat d\'acció immediata']
          : ['Potencial no aprofitat', 'Respostes a ressenyes millorables', 'Diferenciació limitada'],
        actions: [
          { priority: 'high', action: 'Respondre a totes les ressenyes negatives en < 24h', impact: 'Millora percepció i retenció' },
          { priority: 'medium', action: 'Crear protocol de resposta amb to de marca definit', impact: 'Consistència i professionalitat' },
          { priority: 'low', action: 'Implementar recollida proactiva de ressenyes positives', impact: 'Augmentar volum i mitjana' },
        ],
        summary: `Amb una mitjana de ${avgRating.toFixed(1)}★ sobre ${reviews.length} ressenyes, el negoci té ${avgRating >= 3.5 ? 'una base sòlida per créixer' : 'àrees crítiques a millorar'}. Una estratègia de resposta professional pot marcar la diferència.`,
        response_advice: 'Respondre professionalment a cada ressenya augmenta la confiança dels futurs clients un 45%.',
      };
    }

    // Track
    const { error: auditInsertError } = await supabase.from('audit_runs').insert({
      input_type: 'manual',
      review_count: reviews.length,
      email: email || null,
      result: {
        avg_rating: avgRating,
        sentiment_breakdown: sentimentBreakdown,
        has_ai: !!hasKey,
        actions_count: aiAnalysis.actions?.length || 0,
      },
      ip_hash: ipHash,
      user_agent: request.headers.get('user-agent')?.slice(0, 200) || '',
    });
    if (auditInsertError) {
      log.warn('Audit run tracking failed', { error: auditInsertError.message });
    }

    log.info('Review audit complete', { review_count: reviews.length, avg_rating: avgRating });

    return NextResponse.json({
      overall_score: avgRating,
      review_count: reviews.length,
      sentiment_breakdown: sentimentBreakdown,
      ...aiAnalysis,
      cta: {
        message: 'Vols respostes professionals per a cada ressenya?',
        action_url: '/onboarding',
        action_label: 'Comença trial gratuït',
      },
    });
  } catch (e: any) {
    log.error('Review audit error', { error: e?.message });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
