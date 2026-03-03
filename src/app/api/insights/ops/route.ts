export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { OpsIssue, HeatmapCell, ReputationScorecard } from '@/types/database';
import { requireBizAccessPatternB, withRequestContext } from '@/lib/api-handler';

/**
 * GET /api/insights/ops?biz_id=xxx&range=30
 *
 * Returns:
 * - top_issues: complaints ranked with trend vs previous period
 * - heatmap: day-of-week distribution
 * - scorecard: response time, reply %, urgent queue, rating trend
 * - recommendations: AI-generated per theme (cached in response)
 */
export const GET = withRequestContext(async function(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const bizId = searchParams.get('biz_id');
  const range = parseInt(searchParams.get('range') || '30');
  if (!bizId) return NextResponse.json({ error: 'bad_request', code: 'BIZ_ID_REQUIRED', message: 'biz_id és requerit' }, { status: 400 });

  const access = await requireBizAccessPatternB(request, bizId, {
    supabase,
    user,
    queryBizId: bizId,
  });
  if (access instanceof NextResponse) return access;

  const now = new Date();
  const since = new Date(now); since.setDate(since.getDate() - range);
  const prevSince = new Date(since); prevSince.setDate(prevSince.getDate() - range);

  // ====== REVIEWS IN RANGE ======
  const { data: reviews } = await supabase
    .from('reviews')
    .select('id, rating, created_at, review_date, is_replied, needs_attention')
    .eq('biz_id', access.bizId)
    .gte('created_at', prevSince.toISOString())
    .order('created_at', { ascending: true });

  const allReviews = reviews || [];
  const currentReviews = allReviews.filter(r => new Date(r.created_at) >= since);
  const prevReviews = allReviews.filter(r => new Date(r.created_at) < since);

  const currentIds = currentReviews.map(r => r.id);
  const prevIds = prevReviews.map(r => r.id);

  // ====== TOPICS ======
  const { data: allTopics } = await supabase
    .from('review_topics')
    .select('topic, polarity, urgency, review_id, created_at')
    .eq('biz_id', access.bizId)
    .gte('created_at', prevSince.toISOString());

  const topics = allTopics || [];
  const currentTopics = topics.filter(t => currentIds.includes(t.review_id));
  const prevTopics = topics.filter(t => prevIds.includes(t.review_id));

  // ====== TOP ISSUES (complaints with trend) ======
  const ratingMap = new Map(allReviews.map(r => [r.id, r.rating]));
  const currentComplaints = currentTopics.filter(t => t.polarity === 'complaint');
  const prevComplaints = prevTopics.filter(t => t.polarity === 'complaint');
  const totalComplaints = currentComplaints.length || 1;

  // Aggregate current
  const issueMap = new Map<string, { count: number; ratings: number[]; urgency_high: number }>();
  for (const t of currentComplaints) {
    const e = issueMap.get(t.topic) || { count: 0, ratings: [], urgency_high: 0 };
    e.count++;
    e.ratings.push(ratingMap.get(t.review_id) || 3);
    if (t.urgency === 'high') e.urgency_high++;
    issueMap.set(t.topic, e);
  }

  // Aggregate previous (for trend)
  const prevMap = new Map<string, number>();
  for (const t of prevComplaints) {
    prevMap.set(t.topic, (prevMap.get(t.topic) || 0) + 1);
  }

  const top_issues: OpsIssue[] = [...issueMap.entries()]
    .map(([theme, d]) => {
      const prev = prevMap.get(theme) || 0;
      const trend = prev > 0 ? Math.round(((d.count - prev) / prev) * 100) : (d.count > 0 ? 100 : 0);
      return {
        theme,
        count: d.count,
        pct: Math.round((d.count / totalComplaints) * 100),
        avg_rating: parseFloat((d.ratings.reduce((a, b) => a + b, 0) / d.ratings.length).toFixed(1)),
        urgency_high: d.urgency_high,
        trend,
        prev_count: prev,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // ====== HEATMAP (day of week) ======
  const heatmap: HeatmapCell[] = [];
  const dayBuckets = new Map<number, { count: number; ratings: number[] }>();

  for (const r of currentReviews) {
    const d = new Date(r.review_date || r.created_at);
    const day = d.getDay();
    const e = dayBuckets.get(day) || { count: 0, ratings: [] };
    e.count++;
    e.ratings.push(r.rating);
    dayBuckets.set(day, e);
  }

  for (let day = 0; day < 7; day++) {
    const d = dayBuckets.get(day);
    heatmap.push({
      day,
      hour: -1,
      count: d?.count || 0,
      avg_rating: d && d.ratings.length > 0
        ? parseFloat((d.ratings.reduce((a, b) => a + b, 0) / d.ratings.length).toFixed(1))
        : 0,
    });
  }

  // ====== SCORECARD ======
  const totalCurrent = currentReviews.length;
  const repliedReviews = currentReviews.filter(r => r.is_replied);
  const urgentQueue = currentReviews.filter(r => r.needs_attention && !r.is_replied).length;

  // Avg response time: estimate from replied reviews (created_at → we'd need published_at from replies)
  let avgResponseHours = 0;
  if (repliedReviews.length > 0) {
    const { data: repliesData } = await supabase
      .from('replies')
      .select('review_id, published_at')
      .eq('biz_id', access.bizId)
      .eq('status', 'published')
      .in('review_id', repliedReviews.map(r => r.id));

    if (repliesData && repliesData.length > 0) {
      const reviewCreatedMap = new Map(currentReviews.map(r => [r.id, new Date(r.created_at).getTime()]));
      let totalHours = 0;
      let count = 0;
      for (const rep of repliesData) {
        const created = reviewCreatedMap.get(rep.review_id);
        if (created && rep.published_at) {
          const diff = new Date(rep.published_at).getTime() - created;
          totalHours += diff / (1000 * 60 * 60);
          count++;
        }
      }
      avgResponseHours = count > 0 ? parseFloat((totalHours / count).toFixed(1)) : 0;
    }
  }

  // Rating trend (weekly)
  const weekBuckets = new Map<string, number[]>();
  for (const r of currentReviews) {
    const d = new Date(r.created_at);
    const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    const arr = weekBuckets.get(key) || [];
    arr.push(r.rating);
    weekBuckets.set(key, arr);
  }

  const rating_trend = [...weekBuckets.entries()]
    .map(([period, ratings]) => ({
      period,
      avg: parseFloat((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)),
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const scorecard: ReputationScorecard = {
    avg_response_time_hours: avgResponseHours,
    pct_replied: totalCurrent > 0 ? Math.round((repliedReviews.length / totalCurrent) * 100) : 0,
    urgent_queue: urgentQueue,
    rating_trend,
    total_reviews: totalCurrent,
    total_replied: repliedReviews.length,
  };

  // ====== RECOMMENDATIONS (static per theme/biz_type) ======
  const { data: bizData } = await supabase
    .from('businesses')
    .select('type')
    .eq('id', access.bizId)
    .single();

  const bizType = bizData?.type || 'hotel';
  const recommendations: Record<string, string[]> = {};
  for (const issue of top_issues) {
    recommendations[issue.theme] = generateRecommendations(issue.theme, bizType);
  }

  return NextResponse.json({
    top_issues,
    heatmap,
    scorecard,
    recommendations,
    period_days: range,
  });
});

function generateRecommendations(theme: string, bizType: string): string[] {
  const recs: Record<string, Record<string, string[]>> = {
    noise: {
      hotel: ['Instal·lar vidres dobles a habitacions orientades al carrer', 'Oferir tapons per les orelles al check-in', 'Reforçar normes de silenci nocturn 22h-8h'],
      restaurant: ['Revisar acústica: afegir panells fonoabsorbents', 'Crear zona "tranquil·la" separada', 'Ajustar volum de música ambient'],
      default: ['Identificar font principal de soroll', 'Considerar aïllament acústic', 'Establir horaris de silenci'],
    },
    cleanliness: {
      hotel: ['Augmentar freqüència de neteja a banys', 'Implementar checklist de neteja per habitació', 'Afegir inspecció de qualitat post-neteja'],
      restaurant: ['Reforçar neteja entre serveis', 'Revisar protocol de banys cada 30 min', 'Formar equip en estàndards APPCC'],
      default: ['Crear checklist de neteja diari', 'Assignar responsable de qualitat', 'Augmentar freqüència d\'inspecció'],
    },
    staff: {
      hotel: ['Formació en atenció al client (trimestral)', 'Implementar programa de reconeixement d\'empleats', 'Reforçar briefings diaris amb feedback de ressenyes'],
      restaurant: ['Formació en servei i up-selling', 'Reunió setmanal amb feedback de clients', 'Definir estàndards de temps d\'atenció per coberta'],
      default: ['Programa de formació continuada', 'Sistema de feedback d\'equip', 'Definir protocols de servei'],
    },
    food: {
      restaurant: ['Revisar receptes dels plats més criticats', 'Control de qualitat a recepció de productes', 'Tasting intern setmanal de carta'],
      hotel: ['Reunió amb chef per ajustar menú de buffet', 'Diversificar opcions dietètiques', 'Control de temperatura al servei'],
      default: ['Auditar qualitat de proveïdors', 'Implementar control de qualitat', 'Recollir feedback específic per plat'],
    },
    breakfast: {
      hotel: ['Ampliar horari d\'esmorzar 30 min', 'Afegir opcions saludables i locals', 'Reposar productes durant tot l\'horari'],
      default: ['Diversificar oferta d\'esmorzar', 'Assegurar reposició constant', 'Considerar opcions per intoleràncies'],
    },
    wifi: {
      hotel: ['Revisar cobertura per planta amb mapa de senyal', 'Augmentar ample de banda contractat', 'Simplificar procés de connexió (sense portal captiu)'],
      default: ['Test de velocitat a totes les zones', 'Considerar upgrade de contracte ISP', 'Afegir repetidors en zones mortes'],
    },
    parking: {
      hotel: ['Millorar senyalització d\'accés', 'Considerar valet parking en temporada alta', 'Informar clarament de tarifes i alternatives al web'],
      default: ['Revisar senyalització', 'Informar alternatives de parking proper', 'Considerar acords amb parkings propers'],
    },
    checkin: {
      hotel: ['Implementar check-in online/mòbil', 'Reforçar personal en hores punta (14-17h)', 'Pre-assignar habitacions per reduir espera'],
      default: ['Optimitzar procés d\'arribada', 'Reduir passos burocràtics', 'Oferir opcions digitals'],
    },
    value: {
      default: ['Revisar pricing vs competència directa', 'Comunicar millor el valor inclòs', 'Crear paquets amb extras percebuts'],
      restaurant: ['Revisar relació porció-preu', 'Destacar producte local/premium a la carta', 'Crear menú del dia competitiu'],
      hotel: ['Afegir extras inclosos (minibar, late checkout)', 'Comunicar millor serveis inclosos al web', 'Revisar tarifes segons temporada'],
    },
    location: {
      default: ['Millorar indicacions d\'accés al web', 'Afegir mapa detallat amb transport públic', 'Destacar avantatges de la ubicació a la comunicació'],
    },
    room: {
      hotel: ['Programa de renovació per habitacions amb més queixes', 'Revisar matalassos i roba de llit', 'Actualitzar equipament (USB, aire condicionat)'],
      default: ['Inspeccionar estat d\'instal·lacions', 'Crear pla de manteniment preventiu', 'Prioritzar renovacions per feedback'],
    },
    ambiance: {
      restaurant: ['Revisar il·luminació per moments del dia', 'Crear playlist per cada servei', 'Renovar decoració amb tocs locals'],
      default: ['Auditar experiència sensorial', 'Ajustar il·luminació i música', 'Considerar elements decoratius'],
    },
    service: {
      default: ['Definir SLAs per temps de resposta', 'Implementar mystery shopping trimestral', 'Recollir feedback en temps real'],
    },
    facilities: {
      hotel: ['Crear pla de manteniment preventiu mensual', 'Prioritzar reparacions segons impacte en ressenyes', 'Comunicar millores en curs als hostes'],
      default: ['Auditoria d\'instal·lacions trimestral', 'Pressupost dedicat a millores', 'Canal de report d\'incidències'],
    },
    other: {
      default: ['Analitzar comentaris en detall per patrons', 'Reunió d\'equip per identificar causes', 'Establir pla de millora específic'],
    },
  };

  const themeRecs = recs[theme] || recs.other;
  return themeRecs[bizType] || themeRecs.default || themeRecs[Object.keys(themeRecs)[0]] || ['Analitzar el problema en detall', 'Crear pla d\'acció específic'];
}
