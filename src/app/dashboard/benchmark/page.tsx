'use client';

import { useState, useEffect } from 'react';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { glass, glassStrong } from '@/components/ui/glass';

// ============================================================
// MISSION DEFINITIONS (static)
// ============================================================
interface MissionDef {
  key: string;
  icon: string;
  label: string;
  description: string;
  target: number;
  points: number;
}

const MISSIONS: MissionDef[] = [
  { key: 'reply_negative_24h', icon: '🔥', label: 'Bomber de crisis', description: 'Respon a 3 ressenyes negatives en < 24h', target: 3, points: 30 },
  { key: 'add_kb_entries',     icon: '🧠', label: 'Expert en marca',  description: 'Afegeix 3 entrades al Business Memory',      target: 3, points: 20 },
  { key: 'qr_scans',          icon: '📱', label: 'Iman de ressenyes', description: 'Aconsegueix 10 escanejos QR',                  target: 10, points: 25 },
  { key: 'reply_all_week',    icon: '⚡', label: 'Velocitat total',   description: 'Respon a totes les ressenyes de la setmana',     target: 1, points: 40 },
  { key: 'improve_score',     icon: '📈', label: 'Puntuació ascendent', description: 'Puja la mitjana 0.1★ respecte la setmana anterior', target: 1, points: 50 },
];

// ============================================================
// MAIN PAGE
// ============================================================
export default function BenchmarkPage() {
  const t = useT();
  const { biz, org } = useWorkspace();
  const supabase = createClient();

  const [competitors, setCompetitors] = useState<any[]>([]);
  const [missions, setMissions] = useState<any[]>([]);
  const [ownStats, setOwnStats] = useState<{ avgRating: number; reviewCount: number; responseRate: number }>({
    avgRating: 0, reviewCount: 0, responseRate: 0,
  });
  const [loading, setLoading] = useState(true);

  // Add competitor form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newRating, setNewRating] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!biz?.id) return;
    loadAll();
  }, [biz?.id]);

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadCompetitors(), loadOwnStats(), loadMissions()]);
    setLoading(false);
  }

  async function loadCompetitors() {
    const res = await fetch(`/api/competitors?biz_id=${biz!.id}`);
    if (res.ok) setCompetitors(await res.json());
  }

  async function loadOwnStats() {
    // Own reviews this month
    const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data: reviews } = await supabase
      .from('reviews')
      .select('rating, id')
      .eq('biz_id', biz!.id)
      .gte('created_at', monthAgo);

    const { data: replies } = await supabase
      .from('replies')
      .select('review_id')
      .eq('biz_id', biz!.id)
      .eq('status', 'published');

    const revs = reviews || [];
    const repls = replies || [];
    const avgRating = revs.length > 0 ? revs.reduce((s, r) => s + r.rating, 0) / revs.length : 0;
    const repliedIds = new Set(repls.map(r => r.review_id));
    const responseRate = revs.length > 0 ? revs.filter(r => repliedIds.has(r.id)).length / revs.length : 0;

    setOwnStats({ avgRating, reviewCount: revs.length, responseRate });
  }

  async function loadMissions() {
    const weekStart = getWeekStart();
    const { data } = await supabase
      .from('missions')
      .select('*')
      .eq('biz_id', biz!.id)
      .gte('period_start', weekStart);
    setMissions(data || []);
  }

  async function handleAddCompetitor() {
    if (!newName.trim() || !org?.id || !biz?.id) return;
    setAdding(true);
    const res = await fetch('/api/competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        biz_id: biz.id, org_id: org.id, name: newName,
        public_url: newUrl || null,
        avg_rating: newRating ? parseFloat(newRating) : null,
      }),
    });
    if (res.ok) {
      await loadCompetitors();
      setNewName(''); setNewUrl(''); setNewRating('');
      setShowAdd(false);
    }
    setAdding(false);
  }

  async function handleDeleteCompetitor(id: string) {
    if (!confirm('Eliminar competidor?')) return;
    await fetch(`/api/competitors?id=${id}`, { method: 'DELETE' });
    setCompetitors(c => c.filter(x => x.id !== id));
  }

  if (!biz) return <div className="p-8 text-center text-white/70">Carregant...</div>;
  if (loading) return <div className="p-8 text-center text-white/70">Carregant dades...</div>;

  // Build league table
  const league = buildLeague(biz, ownStats, competitors);
  const totalPoints = getMissionPoints(missions);
  const weekLabel = getWeekLabel();

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-white/90">🏆 {t('dashboard.benchmark.title')}</h1>
        <p className="text-sm text-white/70 mt-1">{`${t('dashboard.benchmark.week')}: ${weekLabel}`}</p>
      </div>

      {/* Score Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ScoreCard label="La teva mitjana" value={ownStats.avgRating.toFixed(1)} suffix="★" color="brand" />
        <ScoreCard label="Ressenyes (30d)" value={String(ownStats.reviewCount)} color="surface" />
        <ScoreCard label="Taxa resposta" value={`${(ownStats.responseRate * 100).toFixed(0)}%`} color={ownStats.responseRate >= 0.8 ? 'green' : 'amber'} />
        <ScoreCard label="Punts setmana" value={String(totalPoints)} suffix="pts" color="green" />
      </div>

      {/* League Table */}
      <section className={cn(glassStrong, 'rounded-2xl border border-white/14 overflow-hidden shadow-glass')}>
        <div className="px-6 py-4 border-b border-white/14 flex items-center justify-between">
          <h2 className="font-semibold text-white/90">🏅 Classificació</h2>
          <Button variant="ghost" size="sm" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? t('common.cancel') : `+ ${t('dashboard.benchmark.addCompetitor')}`}
          </Button>
        </div>

        {showAdd && (
          <div className={cn(glass, 'px-6 py-4 border-b border-white/14')}>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-xs text-white/70 block mb-1">Nom *</label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Hotel Ríviera" />
              </div>
              <div className="w-32">
                <label className="text-xs text-white/70 block mb-1">Nota (0-5)</label>
                <Input value={newRating} onChange={e => setNewRating(e.target.value)} placeholder="4.2" type="number" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-white/70 block mb-1">URL (opcional)</label>
                <Input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://..." />
              </div>
              <Button onClick={handleAddCompetitor} loading={adding} disabled={!newName.trim()}>Afegir</Button>
            </div>
          </div>
        )}

        {league.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-3xl mb-3">🏟️</p>
            <p className="font-semibold text-white/90">Sense competidors</p>
            <p className="text-sm text-white/70 mt-1">Afegeix competidors per veure la teva posició.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/14">
            {league.map((entry, i) => (
              <div key={entry.id} className={cn(
                'px-6 py-3 flex items-center gap-4',
                entry.isOwn && 'bg-brand-accent/16',
              )}>
                <span className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold',
                  i === 0 ? 'bg-amber-100 text-amber-700' :
                  i === 1 ? 'bg-white/14 text-white/72' :
                  i === 2 ? 'bg-orange-100 text-orange-700' :
                  'bg-white/10 text-white/65'
                )}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-medium truncate text-white/85', entry.isOwn && 'text-emerald-300')}>
                    {entry.name} {entry.isOwn && <span className="text-xs font-normal text-emerald-300">(tu)</span>}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-white/90">{entry.rating?.toFixed(1) || '—'}★</p>
                </div>
                {!entry.isOwn && (
                  <button onClick={() => handleDeleteCompetitor(entry.id)} className="text-xs text-white/60 hover:text-red-300">✕</button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Missions */}
      <section>
        <h2 className="font-semibold text-white/90 mb-4">🎯 {t('dashboard.benchmark.weeklyMissions')}</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MISSIONS.map(def => {
            const m = missions.find(x => x.mission_key === def.key);
            const progress = m?.progress || 0;
            const completed = m?.completed_at;
            const pct = Math.min(100, Math.round((progress / def.target) * 100));

            return (
              <div key={def.key} className={cn(
                glassStrong,
                'rounded-xl p-5 border transition-all',
                completed ? 'border-green-300/40 bg-green-500/12' : 'border-white/14',
              )}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{def.icon}</span>
                  <div className="flex-1">
                    <p className="font-semibold text-sm text-white/90">{def.label}</p>
                    <p className="text-xs text-white/70">{def.description}</p>
                  </div>
                  <span className={cn(
                    'text-xs font-bold px-2 py-0.5 rounded-full',
                    completed ? 'bg-green-500/18 text-green-300' : 'bg-white/10 text-white/70',
                  )}>
                    {completed ? `+${def.points}` : `${def.points}pts`}
                  </span>
                </div>

                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-500', completed ? 'bg-green-500' : 'bg-brand-500')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-white/60 mt-1">{progress}/{def.target} {completed ? `✓ ${t('dashboard.benchmark.completed')}` : ''}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Info note */}
      <div className={cn(glass, 'rounded-xl p-4 border border-white/14')}>
        <p className="text-xs text-white/70">
          💡 Les missions es reinicien cada dilluns. Les puntuacions dels competidors es poden actualitzar manualment
          o (propera versió) via Google Places API. Cap dada es recull sense el teu consentiment.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// HELPERS
// ============================================================
function ScoreCard({ label, value, suffix, color }: { label: string; value: string; suffix?: string; color: string }) {
  const colorMap: Record<string, string> = {
    brand: 'text-emerald-300', green: 'text-green-300', amber: 'text-amber-300',
    surface: 'text-white/90',
  };
  return (
    <div className={cn(glass, 'rounded-xl p-4 border border-white/14 text-center')}>
      <p className={cn('text-2xl font-bold', colorMap[color] || 'text-white/90')}>
        {value}{suffix && <span className="text-sm font-normal text-white/60 ml-0.5">{suffix}</span>}
      </p>
      <p className="text-xs text-white/70 mt-1">{label}</p>
    </div>
  );
}

function buildLeague(biz: any, ownStats: any, competitors: any[]) {
  const all = [
    { id: biz.id, name: biz.name, rating: ownStats.avgRating, isOwn: true },
    ...competitors.map(c => ({ id: c.id, name: c.name, rating: c.avg_rating || 0, isOwn: false })),
  ];
  return all.sort((a, b) => (b.rating || 0) - (a.rating || 0));
}

function getMissionPoints(missions: any[]) {
  return missions
    .filter(m => m.completed_at)
    .reduce((sum, m) => {
      const def = MISSIONS.find(d => d.key === m.mission_key);
      return sum + (def?.points || 0);
    }, 0);
}

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.setDate(diff)).toISOString().split('T')[0];
}

function getWeekLabel() {
  const start = new Date(getWeekStart());
  const end = new Date(start.getTime() + 6 * 86400_000);
  const fmt = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
  return `${fmt(start)} — ${fmt(end)}`;
}
