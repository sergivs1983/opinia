export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { validateBody, DemoSeedSchema } from '@/lib/validations';
import { requireBizAccess, assertSingleBizId, withRequestContext } from '@/lib/api-handler';

/**
 * POST /api/demo-seed
 * Seeds demo data for a business. Only works if NEXT_PUBLIC_DEMO_MODE=true or NODE_ENV=development.
 */
export const POST = withRequestContext(async function(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  // Feature flag
  if (process.env.NODE_ENV !== 'development' && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    return NextResponse.json({ error: 'forbidden', message: 'Demo mode not enabled' }, { status: 403 });
  }

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'Auth required' }, { status: 401 });

  const [body, err] = await validateBody(request, DemoSeedSchema);
  if (err) return err;

  const { biz_id, org_id } = body;

  // ── Input hardening: biz_id per una sola via ─────────────────────────────
  const { bizId: resolvedBizId, error: ambigErr } = assertSingleBizId([
    new URL(request.url).searchParams.get('biz_id'),
    biz_id,
  ]);
  if (ambigErr) return ambigErr;
  // ── Biz-level guard ──────────────────────────────────────────────────────
  const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId: resolvedBizId });
  if (bizGuard) return bizGuard;

  const admin = createAdminClient();
  const now = new Date();

  // ============================================================
  // KB ENTRIES (10 entries)
  // ============================================================
  const kbEntries = [
    { category: 'parking', triggers: ['parking', 'aparcar', 'cotxe'], content: 'Disposem de parking privat per a hostes amb un cost de 18€/nit. Reserva prèvia recomanada. Hi ha parking públic a 200m per 12€/dia.' },
    { category: 'wifi', triggers: ['wifi', 'internet', 'connexió'], content: 'WiFi gratuït a totes les zones de l\'hotel. Xarxa: HOTEL_GUEST. Velocitat: 100Mbps simètrics.' },
    { category: 'horaris', triggers: ['esmorzar', 'check-in', 'check-out', 'horari'], content: 'Check-in: 15:00. Check-out: 12:00. Late check-out disponible fins les 14:00 (subjecte a disponibilitat, 25€). Esmorzar buffet: 7:00-10:30.' },
    { category: 'política', triggers: ['cancel·lació', 'reemborsament', 'animals'], content: 'Cancel·lació gratuïta fins 48h abans. Admissió de mascotes petites (fins 10kg) amb suplement de 15€/nit. No es permet fumar a les habitacions.' },
    { category: 'menú', triggers: ['restaurant', 'sopar', 'menú', 'cuina'], content: 'Restaurant amb cuina mediterrània de proximitat. Menú diari: 22€ (2 plats + postres + beguda). Carta disponible. Terrassa amb vistes al mar.' },
    { category: 'equip', triggers: ['personal', 'recepció', 'director'], content: 'Equip multilingüe (CA/ES/EN/FR). Recepció 24h. Concierge disponible de 8:00 a 22:00.' },
    { category: 'instal·lacions', triggers: ['piscina', 'spa', 'gimnàs', 'terrassa'], content: 'Piscina exterior (juny-setembre, 9:00-20:00). Spa i sauna (10:00-21:00). Gimnàs 24h amb targeta d\'habitació. Terrassa rooftop amb bar.' },
    { category: 'ubicació', triggers: ['ubicació', 'centre', 'platja', 'transport'], content: 'Ubicats al centre de Tarragona, a 5 min a peu de la Catedral i 10 min de la platja del Miracle. Estació de tren a 800m.' },
    { category: 'promoció', triggers: ['oferta', 'descompte', 'pack'], content: 'Pack Romàntic: habitació superior + cava + esmorzar tardà (12:00) des de 149€. Promoció web: 10% dte en reserves directes.' },
    { category: 'altres', triggers: ['bugaderia', 'servei habitacions'], content: 'Servei d\'habitacions disponible de 7:00 a 23:00. Bugaderia express amb recollida abans de les 9:00, entrega el mateix dia.' },
  ];

  const kbInsert = kbEntries.map(e => ({ biz_id, org_id, ...e, sentiment_context: null }));
  await admin.from('knowledge_base_entries').insert(kbInsert);

  // ============================================================
  // REVIEWS (6 reviews spanning 14 days)
  // ============================================================
  const reviews = [
    { author_name: 'Maria G.', rating: 5, sentiment: 'positive', review_text: 'Estada fantàstica! L\'habitació era impecable, el personal encantador i l\'esmorzar buffet increïble. Les vistes des de la terrassa rooftop són espectaculars. Sens dubte hi tornarem!', language_detected: 'ca', needs_attention: false, days_ago: 1 },
    { author_name: 'Joan P.', rating: 4, sentiment: 'positive', review_text: 'Molt bona experiència en general. L\'hotel està molt ben ubicat, a prop de tot. L\'únic que milloraria és la insonorització de les habitacions, es sentia una mica de soroll del carrer.', language_detected: 'ca', needs_attention: false, days_ago: 3 },
    { author_name: 'Pierre D.', rating: 2, sentiment: 'negative', review_text: 'Déçu par le parking. On nous avait dit qu\'il y avait un parking privé mais il était complet à notre arrivée. Le wifi ne fonctionnait pas bien non plus. La chambre était correcte mais le rapport qualité-prix est décevant.', language_detected: 'fr', needs_attention: true, days_ago: 5 },
    { author_name: 'Laura M.', rating: 5, sentiment: 'positive', review_text: 'El millor hotel de Tarragona sense cap dubte. El spa és una meravella i el servei d\'habitacions impecable. El pack romàntic va ser perfecte per celebrar l\'aniversari. Gràcies per tot!', language_detected: 'ca', needs_attention: false, days_ago: 7 },
    { author_name: 'Carlos R.', rating: 3, sentiment: 'neutral', review_text: 'Hotel correcto para el precio. La habitación estaba limpia pero es algo pequeña. El desayuno buffet tiene variedad pero el café podría ser mejor. La ubicación es excelente, cerca de todo.', language_detected: 'es', needs_attention: false, days_ago: 10 },
    { author_name: 'Sarah K.', rating: 1, sentiment: 'negative', review_text: 'Terrible experience with the check-in. We waited 45 minutes despite having a reservation. The room AC was broken and nobody came to fix it. Asked for a room change and was told nothing was available. Very disappointing for a 4-star hotel.', language_detected: 'en', needs_attention: true, days_ago: 13 },
  ];

  const reviewInserts = reviews.map(r => {
    const d = new Date(now); d.setDate(d.getDate() - r.days_ago);
    return {
      biz_id, org_id,
      source: 'manual' as const,
      author_name: r.author_name,
      review_text: r.review_text,
      rating: r.rating,
      sentiment: r.sentiment,
      language_detected: r.language_detected,
      needs_attention: r.needs_attention,
      is_replied: false,
      review_date: d.toISOString(),
      metadata: { demo: true },
    };
  });

  const { data: insertedReviews } = await admin.from('reviews').insert(reviewInserts).select('id, rating');

  // ============================================================
  // TOPIC EXTRACTION (for insights)
  // ============================================================
  if (insertedReviews) {
    const topicInserts: any[] = [];
    const topicMap: Record<number, { topic: string; polarity: string }[]> = {
      0: [{ topic: 'room', polarity: 'praise' }, { topic: 'staff', polarity: 'praise' }, { topic: 'breakfast', polarity: 'praise' }],
      1: [{ topic: 'location', polarity: 'praise' }, { topic: 'noise', polarity: 'complaint' }],
      2: [{ topic: 'parking', polarity: 'complaint' }, { topic: 'wifi', polarity: 'complaint' }, { topic: 'value', polarity: 'complaint' }],
      3: [{ topic: 'facilities', polarity: 'praise' }, { topic: 'service', polarity: 'praise' }],
      4: [{ topic: 'breakfast', polarity: 'neutral' }, { topic: 'room', polarity: 'neutral' }, { topic: 'location', polarity: 'praise' }],
      5: [{ topic: 'checkin', polarity: 'complaint' }, { topic: 'room', polarity: 'complaint' }, { topic: 'staff', polarity: 'complaint' }],
    };

    insertedReviews.forEach((rev, i) => {
      const topics = topicMap[i] || [];
      topics.forEach(t => {
        topicInserts.push({
          review_id: rev.id, biz_id, org_id,
          topic: t.topic,
          sentiment: reviews[i].sentiment,
          polarity: t.polarity,
          urgency: reviews[i].rating <= 2 ? 'high' : 'low',
          confidence: 0.9,
        });
      });
    });

    if (topicInserts.length > 0) {
      await admin.from('review_topics').insert(topicInserts);
    }
  }

  // Audit
  await audit(supabase, {
    orgId: org_id, bizId: biz_id, userId: user.id,
    action: 'seed_demo_data',
    metadata: { reviews: reviews.length, kb_entries: kbEntries.length },
  });

  return NextResponse.json({
    success: true,
    seeded: { reviews: reviews.length, kb_entries: kbEntries.length, topics: 14 },
  });
});
