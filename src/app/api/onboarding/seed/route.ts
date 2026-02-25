export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { audit } from '@/lib/audit';
import {
  validateBody,
  OnboardingSeedSchema,
} from '@/lib/validations';
import {
  resolveOnboardingLanguage,
  type OnboardingLanguage,
} from '@/lib/onboarding';

interface OnboardingSeedBody {
  businessId: string;
  language?: OnboardingLanguage;
  count: number;
  force: boolean;
}

interface BusinessSeedRow {
  id: string;
  org_id: string;
  name?: string | null;
  language?: string | null;
  locale?: string | null;
  default_language?: string | null;
}

interface OrgSeedRow {
  locale?: string | null;
}

interface DemoTemplate {
  author: string;
  rating: number;
  text: string;
}

const DEMO_TEMPLATES: Record<OnboardingLanguage, DemoTemplate[]> = {
  ca: [
    { author: 'Marta G.', rating: 5, text: 'Molt bona experiència. Ens van atendre ràpid i amb un tracte molt proper. Tornarem segur.' },
    { author: 'Pol R.', rating: 4, text: 'Servei atent i ambient agradable. Bona relació qualitat-preu en general.' },
    { author: 'Núria V.', rating: 5, text: 'Excel·lent atenció i molt bona organització. Tot va anar fluid de principi a final.' },
    { author: 'Joan C.', rating: 3, text: 'Correcte en general, tot i que vam haver d’esperar una mica més del previst.' },
    { author: 'Clara M.', rating: 2, text: 'Ens va faltar més agilitat i la comunicació no va ser gaire clara en alguns moments.' },
    { author: 'David P.', rating: 1, text: 'Experiència decebedora. Vam esperar massa i no es va resoldre la incidència com esperàvem.' },
    { author: 'Laia T.', rating: 4, text: 'Bona experiència global. Personal amable i espai net.' },
    { author: 'Oriol S.', rating: 5, text: 'Tot perfecte: rapidesa, tracte i sensació de confiança.' },
  ],
  es: [
    { author: 'Marta G.', rating: 5, text: 'Muy buena experiencia. Atención rápida y trato cercano. Volveremos seguro.' },
    { author: 'Pablo R.', rating: 4, text: 'Servicio atento y ambiente agradable. Buena relación calidad-precio.' },
    { author: 'Nuria V.', rating: 5, text: 'Excelente atención y muy buena organización. Todo fue fluido de principio a fin.' },
    { author: 'Juan C.', rating: 3, text: 'Correcto en general, aunque tuvimos que esperar un poco más de lo previsto.' },
    { author: 'Clara M.', rating: 2, text: 'Faltó algo más de agilidad y la comunicación no fue del todo clara.' },
    { author: 'David P.', rating: 1, text: 'Experiencia decepcionante. Esperamos demasiado y no se resolvió bien la incidencia.' },
    { author: 'Laura T.', rating: 4, text: 'Buena experiencia global. Equipo amable y espacio limpio.' },
    { author: 'Oriol S.', rating: 5, text: 'Todo perfecto: rapidez, trato y confianza.' },
  ],
  en: [
    { author: 'Marta G.', rating: 5, text: 'Great experience overall. Fast service and very friendly staff. We will come back.' },
    { author: 'Paul R.', rating: 4, text: 'Attentive team and pleasant atmosphere. Good value for money.' },
    { author: 'Nuria V.', rating: 5, text: 'Excellent attention and smooth coordination from start to finish.' },
    { author: 'John C.', rating: 3, text: 'Overall okay, but we had to wait a bit longer than expected.' },
    { author: 'Clara M.', rating: 2, text: 'Service felt slower than expected and communication could be clearer.' },
    { author: 'David P.', rating: 1, text: 'Disappointing visit. Long wait and the issue was not handled properly.' },
    { author: 'Laura T.', rating: 4, text: 'Good overall experience. Helpful staff and clean space.' },
    { author: 'Oliver S.', rating: 5, text: 'Everything felt easy: speed, quality, and warm service.' },
  ],
};

function sentimentFromRating(rating: number): 'positive' | 'neutral' | 'negative' {
  if (rating <= 2) return 'negative';
  if (rating === 3) return 'neutral';
  return 'positive';
}

function buildDemoRows(args: {
  business: BusinessSeedRow;
  language: OnboardingLanguage;
  count: number;
  requestId: string;
}): Array<Record<string, unknown>> {
  const templates = DEMO_TEMPLATES[args.language];
  const now = Date.now();

  return Array.from({ length: args.count }).map((_, index) => {
    const template = templates[index % templates.length];
    const rating = template.rating;
    const reviewDate = new Date(now - (index * 90 * 60 * 1000));

    return {
      biz_id: args.business.id,
      org_id: args.business.org_id,
      source: 'google',
      author_name: template.author,
      review_text: template.text,
      rating,
      sentiment: sentimentFromRating(rating),
      language_detected: args.language,
      review_date: reviewDate.toISOString(),
      needs_attention: rating <= 2,
      is_replied: false,
      metadata: {
        demo_seed: true,
        onboarding: true,
        request_id: args.requestId,
      },
    };
  });
}

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/onboarding/seed' });

  const withResponseRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return withResponseRequestId(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      );
    }

    const [body, bodyErr] = await validateBody(request, OnboardingSeedSchema);
    if (bodyErr) return withResponseRequestId(bodyErr);
    const payload = body as OnboardingSeedBody;

    const workspaceBusinessId = request.headers.get('x-biz-id')?.trim();
    if (workspaceBusinessId && workspaceBusinessId !== payload.businessId) {
      return withResponseRequestId(
        NextResponse.json(
          { error: 'forbidden', message: 'businessId does not match current workspace', request_id: requestId },
          { status: 403 },
        ),
      );
    }

    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', payload.businessId)
      .single();

    if (businessError || !businessData) {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No access to this business', request_id: requestId }, { status: 403 }),
      );
    }

    const business = businessData as BusinessSeedRow;

    const { data: orgData } = await supabase
      .from('organizations')
      .select('locale')
      .eq('id', business.org_id)
      .maybeSingle();
    const org = (orgData || null) as OrgSeedRow | null;

    const language = resolveOnboardingLanguage({
      bodyLanguage: payload.language,
      business,
      org,
    });

    const { data: existingRows, error: existingError } = await supabase
      .from('reviews')
      .select('id')
      .eq('biz_id', payload.businessId)
      .limit(1);

    if (existingError) {
      log.error('Failed to verify existing reviews before onboarding seed', {
        error: existingError.message,
        business_id: payload.businessId,
      });
      return withResponseRequestId(
        NextResponse.json(
          { error: 'db_error', message: 'Failed to verify review state', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    const hasReviews = Array.isArray(existingRows) && existingRows.length > 0;
    if (hasReviews && !payload.force) {
      return withResponseRequestId(
        NextResponse.json({
          seeded: false,
          reason: 'already_has_reviews',
          request_id: requestId,
        }),
      );
    }

    const rows = buildDemoRows({
      business,
      language,
      count: payload.count,
      requestId,
    });

    const { error: insertError } = await supabase
      .from('reviews')
      .insert(rows);

    if (insertError) {
      log.error('Failed to insert onboarding demo reviews', {
        error: insertError.message,
        business_id: payload.businessId,
      });
      return withResponseRequestId(
        NextResponse.json(
          { error: 'db_error', message: 'Failed to seed demo reviews', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    await audit(supabase, {
      orgId: business.org_id,
      bizId: business.id,
      userId: user.id,
      action: 'ONBOARDING_DEMO_SEEDED',
      targetType: 'business',
      targetId: business.id,
      metadata: {
        request_id: requestId,
        language,
        count: rows.length,
        force: payload.force,
      },
    });

    return withResponseRequestId(
      NextResponse.json({
        seeded: true,
        count: rows.length,
        language,
        request_id: requestId,
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled onboarding seed error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
