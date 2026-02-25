'use client';

export const dynamic = 'force-dynamic';


import { useState, useEffect, useCallback } from 'react';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { glass, glassStrong } from '@/components/ui/glass';
import { TOPIC_LABELS, TOPIC_ICONS } from '@/types/database';
import type { OpsAction, OpsIssue, HeatmapCell, ReputationScorecard } from '@/types/database';

const DAY_NAMES = ['Dg', 'Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds'];
const DAY_NAMES_FULL = ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'];

export default function OpsPage() {
  const t = useT();
  const { biz, org } = useWorkspace();
  const [range, setRange] = useState(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    top_issues: OpsIssue[];
    heatmap: HeatmapCell[];
    scorecard: ReputationScorecard;
    recommendations: Record<string, string[]>;
  } | null>(null);
  const [actions, setActions] = useState<OpsAction[]>([]);
  const [actionsTab, setActionsTab] = useState<'open' | 'done'>('open');
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [creatingAction, setCreatingAction] = useState(false);
  const [newActionTitle, setNewActionTitle] = useState('');

  const loadData = useCallback(async () => {
    if (!biz) return;
    setLoading(true);
    try {
      const [opsRes, actionsRes] = await Promise.all([
        fetch(`/api/insights/ops?biz_id=${biz.id}&range=${range}`),
        fetch(`/api/ops-actions?biz_id=${biz.id}`),
      ]);
      setData(await opsRes.json());
      setActions(await actionsRes.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [biz, range]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateAction = async (theme: string, title: string, recommendation?: string) => {
    if (!biz || !org || !title.trim()) return;
    setCreatingAction(true);
    try {
      await fetch('/api/ops-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ biz_id: biz.id, org_id: org.id, theme, title, recommendation, priority: 'medium' }),
      });
      setNewActionTitle('');
      await loadData();
    } catch (e) { console.error(e); }
    setCreatingAction(false);
  };

  const handleToggleAction = async (action: OpsAction) => {
    const newStatus = action.status === 'done' ? 'open' : 'done';
    await fetch('/api/ops-actions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: action.id, status: newStatus }),
    });
    await loadData();
  };

  const handleDeleteAction = async (id: string) => {
    if (!confirm('Eliminar aquesta acció?')) return;
    await fetch(`/api/ops-actions?id=${id}`, { method: 'DELETE' });
    await loadData();
  };

  const topicLabel = (t: string) => TOPIC_LABELS[t] || t;
  const topicIcon = (t: string) => TOPIC_ICONS[t] || '📝';

  const selectedData = selectedIssue && data ? {
    issue: data.top_issues.find(i => i.theme === selectedIssue),
    recs: data.recommendations[selectedIssue] || [],
    themeActions: actions.filter(a => a.theme === selectedIssue),
  } : null;

  if (!biz) return <div className="p-8 text-center text-white/70">Selecciona un negoci</div>;

  return (
    <div className="flex h-[calc(100vh-52px)]">
      {/* MAIN CONTENT */}
      <div className={cn('flex-1 overflow-y-auto p-6 transition-all', selectedIssue ? 'mr-0' : '')}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display font-bold text-lg text-white/90">{t('dashboard.ops.title')}</h1>
            <p className="text-sm text-white/70">Converteix ressenyes en accions de millora</p>
          </div>
          <div className="flex gap-1">
            {[7, 30].map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                  range === r ? 'border-brand-accent/45 bg-brand-accent/20 text-emerald-300' : 'border-white/14 bg-white/8 text-white/72 hover:border-white/24')}>
                {r}d
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-6">
            <div className="grid md:grid-cols-4 gap-4">{[0,1,2,3].map(i => <div key={i} className="h-24 rounded-2xl border border-white/10 bg-white/8 animate-pulse" />)}</div>
            <div className="h-64 rounded-2xl border border-white/10 bg-white/8 animate-pulse" />
          </div>
        ) : !data ? (
          <EmptyState />
        ) : (
          <div className="space-y-6">
            {/* SCORECARD */}
            <ScorecardRow scorecard={data.scorecard} />

            {/* TOP ISSUES */}
            <div className={`${glassStrong} border border-white/10 p-5 shadow-glass`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-semibold text-white/90 text-sm">Top friccions</p>
                  <p className="text-xs text-white/60">Temes amb més queixes ({range} dies)</p>
                </div>
              </div>
              {data.top_issues.length === 0 ? (
                <div className="py-8 text-center text-white/70">
                  <p className="text-2xl mb-2">🎉</p>
                  <p className="text-sm">Cap fricció detectada en aquest període</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.top_issues.map((issue, i) => (
                    <button key={issue.theme} onClick={() => setSelectedIssue(selectedIssue === issue.theme ? null : issue.theme)}
                      className={cn('w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                        selectedIssue === issue.theme
                          ? 'border-brand-accent/45 bg-brand-accent/18 shadow-float'
                          : 'border-white/14 hover:border-white/24 hover:bg-white/8')}>
                      {/* Rank */}
                      <span className={cn('w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                        i === 0 ? 'bg-red-500/20 text-red-300' : i === 1 ? 'bg-amber-500/20 text-amber-300' : 'bg-white/12 text-white/72')}>
                        {i + 1}
                      </span>
                      {/* Icon + Label */}
                      <span className="text-lg shrink-0">{topicIcon(issue.theme)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white/90">{topicLabel(issue.theme)}</span>
                          {issue.urgency_high > 0 && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">{issue.urgency_high} urgent</span>
                          )}
                        </div>
                        {/* Bar */}
                        <div className="w-full h-1.5 bg-white/10 rounded-full mt-1.5 overflow-hidden">
                          <div className="h-full bg-red-400 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(issue.pct * 1.5, 100)}%` }} />
                        </div>
                      </div>
                      {/* Stats */}
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-white/90">{issue.count}×</p>
                        <TrendBadge trend={issue.trend} />
                      </div>
                      {/* Chevron */}
                      <svg className={cn('w-4 h-4 text-white/50 transition-transform shrink-0', selectedIssue === issue.theme && 'rotate-90')}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* HEATMAP */}
            <HeatmapGrid cells={data.heatmap} />

            {/* OPS ACTIONS */}
            <div className={`${glassStrong} border border-white/10 p-5 shadow-glass`}>
              <div className="flex items-center justify-between mb-4">
                <p className="font-semibold text-white/90 text-sm">Accions operatives</p>
                <div className="flex gap-1">
                  {(['open', 'done'] as const).map(s => (
                    <button key={s} onClick={() => setActionsTab(s)}
                      className={cn('px-3 py-1 rounded-lg text-xs font-medium border transition-all',
                        actionsTab === s ? 'border-brand-accent/45 bg-brand-accent/20 text-emerald-300' : 'border-white/14 bg-white/8 text-white/72')}>
                      {s === 'open' ? `Obertes (${actions.filter(a => a.status !== 'done').length})` : `Fetes (${actions.filter(a => a.status === 'done').length})`}
                    </button>
                  ))}
                </div>
              </div>
              <ActionsList
                actions={actions.filter(a => actionsTab === 'open' ? a.status !== 'done' : a.status === 'done')}
                onToggle={handleToggleAction}
                onDelete={handleDeleteAction}
              />
            </div>
          </div>
        )}
      </div>

      {/* DETAIL DRAWER */}
      {selectedIssue && selectedData?.issue && (
        <div className={`${glassStrong} w-[380px] shrink-0 rounded-l-2xl border-l border-white/14 overflow-y-auto animate-fade-in shadow-glass`}>
          <div className="p-5 border-b border-white/14 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">{topicIcon(selectedIssue)}</span>
              <div>
                <p className="font-semibold text-white/90 text-sm">{topicLabel(selectedIssue)}</p>
                <p className="text-xs text-white/60">{selectedData.issue.count} mencions · {selectedData.issue.pct}% del total</p>
              </div>
            </div>
            <button onClick={() => setSelectedIssue(null)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Stats */}
          <div className="p-5 border-b border-white/14">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-2 rounded-xl bg-white/8 border border-white/14">
                <p className="text-lg font-bold text-red-600">{selectedData.issue.avg_rating.toFixed(1)}★</p>
                <p className="text-[10px] text-white/60">Rating mitjà</p>
              </div>
              <div className="text-center p-2 rounded-xl bg-white/8 border border-white/14">
                <TrendBadge trend={selectedData.issue.trend} large />
                <p className="text-[10px] text-white/60 mt-0.5">vs anterior</p>
              </div>
              <div className="text-center p-2 rounded-xl bg-white/8 border border-white/14">
                <p className="text-lg font-bold text-white/90">{selectedData.issue.urgency_high}</p>
                <p className="text-[10px] text-white/60">Urgents</p>
              </div>
            </div>
          </div>

          {/* Recommendations */}
          <div className="p-5 border-b border-white/14">
            <p className="text-xs font-bold uppercase text-white/60 tracking-wider mb-3">Recomanacions operatives</p>
            <div className="space-y-2">
              {selectedData.recs.map((rec, i) => (
                <div key={i} className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/12 border border-amber-300/30">
                  <span className="text-amber-500 shrink-0 mt-0.5">💡</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/82 leading-relaxed">{rec}</p>
                    <button onClick={() => handleCreateAction(selectedIssue, rec, rec)}
                      className="mt-1.5 text-[10px] font-medium text-emerald-300 hover:text-emerald-200 transition-colors">
                      + Crear acció
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom action */}
          <div className="p-5 border-b border-white/14">
            <p className="text-xs font-bold uppercase text-white/60 tracking-wider mb-3">Acció personalitzada</p>
            <div className="flex gap-2">
              <input value={newActionTitle} onChange={e => setNewActionTitle(e.target.value)}
                placeholder="Descripció de l'acció..."
                className="flex-1 rounded-lg border border-white/14 bg-white/8 px-3 py-2 text-xs text-white/90 focus:outline-none focus:ring-2 focus:ring-brand-accent/35"
                onKeyDown={e => { if (e.key === 'Enter') handleCreateAction(selectedIssue, newActionTitle); }} />
              <Button size="sm" onClick={() => handleCreateAction(selectedIssue, newActionTitle)} loading={creatingAction} disabled={!newActionTitle.trim()}>
                +
              </Button>
            </div>
          </div>

          {/* Theme actions */}
          <div className="p-5">
            <p className="text-xs font-bold uppercase text-white/60 tracking-wider mb-3">
              Accions ({selectedData.themeActions.length})
            </p>
            {selectedData.themeActions.length === 0 ? (
              <p className="text-xs text-white/60 py-3 text-center">Encara no hi ha accions per a aquest tema</p>
            ) : (
              <div className="space-y-2">
                {selectedData.themeActions.map(action => (
                  <div key={action.id} className="flex items-start gap-2 p-2.5 rounded-lg border border-white/14 hover:border-white/24 transition-all">
                    <button onClick={() => handleToggleAction(action)}
                      className={cn('w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all',
                        action.status === 'done' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-white/24 hover:border-brand-accent/45')}>
                      {action.status === 'done' && (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    <p className={cn('text-xs leading-relaxed flex-1', action.status === 'done' ? 'text-white/55 line-through' : 'text-white/82')}>
                      {action.title}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function ScorecardRow({ scorecard }: { scorecard: ReputationScorecard }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <ScorecardCard
        icon="⏱️" label="Temps resp. mitjà"
        value={scorecard.avg_response_time_hours > 0 ? `${scorecard.avg_response_time_hours}h` : '—'}
        sub={scorecard.avg_response_time_hours <= 2 ? 'Excel·lent' : scorecard.avg_response_time_hours <= 12 ? 'Acceptable' : 'A millorar'}
        color={scorecard.avg_response_time_hours <= 2 ? 'emerald' : scorecard.avg_response_time_hours <= 12 ? 'amber' : 'red'}
      />
      <ScorecardCard
        icon="📬" label="% Respostes"
        value={`${scorecard.pct_replied}%`}
        sub={`${scorecard.total_replied} / ${scorecard.total_reviews}`}
        color={scorecard.pct_replied >= 80 ? 'emerald' : scorecard.pct_replied >= 50 ? 'amber' : 'red'}
      />
      <ScorecardCard
        icon="🔴" label="Cua urgents"
        value={scorecard.urgent_queue.toString()}
        sub="Sense resposta"
        color={scorecard.urgent_queue === 0 ? 'emerald' : scorecard.urgent_queue <= 3 ? 'amber' : 'red'}
      />
      <ScorecardCard
        icon="⭐" label="Rating tendència"
        value={scorecard.rating_trend.length > 0 ? `${scorecard.rating_trend[scorecard.rating_trend.length - 1]?.avg.toFixed(1)}` : '—'}
        sub={scorecard.rating_trend.length >= 2
          ? (() => {
              const last = scorecard.rating_trend[scorecard.rating_trend.length - 1]?.avg || 0;
              const prev = scorecard.rating_trend[scorecard.rating_trend.length - 2]?.avg || 0;
              const diff = last - prev;
              return diff > 0 ? `+${diff.toFixed(1)} vs setmana ant.` : diff < 0 ? `${diff.toFixed(1)} vs setmana ant.` : 'Estable';
            })()
          : 'Insuficient dades'}
        color="brand"
      />
    </div>
  );
}

function ScorecardCard({ icon, label, value, sub, color }: {
  icon: string; label: string; value: string; sub: string; color: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500/14 border-emerald-400/30',
    amber: 'bg-amber-500/14 border-amber-400/30',
    red: 'bg-red-500/14 border-red-400/30',
    brand: 'bg-brand-accent/14 border-brand-accent/30',
  };
  return (
    <div className={cn('rounded-2xl border p-4 transition-all duration-[220ms] ease-premium', colorMap[color] || 'bg-white/8 border-white/14')}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{icon}</span>
        <span className="text-[10px] font-bold uppercase text-white/60 tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white/90">{value}</p>
      <p className="text-xs text-white/70 mt-0.5">{sub}</p>
    </div>
  );
}

function TrendBadge({ trend, large }: { trend: number; large?: boolean }) {
  const isUp = trend > 0;
  const isDown = trend < 0;
  const isFlat = trend === 0;

  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 font-bold rounded-full',
      large ? 'text-lg' : 'text-[10px] px-1.5 py-0.5',
      isUp ? (large ? 'text-red-600' : 'bg-red-100 text-red-700') :
      isDown ? (large ? 'text-emerald-600' : 'bg-emerald-100 text-emerald-700') :
      (large ? 'text-white/65' : 'bg-white/10 text-white/65 border border-white/14')
    )}>
      {isUp ? '↑' : isDown ? '↓' : '→'}
      {!large && <span>{Math.abs(trend)}%</span>}
      {large && <span>{Math.abs(trend)}%</span>}
    </span>
  );
}

function HeatmapGrid({ cells }: { cells: HeatmapCell[] }) {
  if (!cells || cells.length === 0) return null;

  const maxCount = Math.max(...cells.map(c => c.count), 1);

  const getIntensity = (count: number) => {
    if (count === 0) return 'bg-white/8';
    const pct = count / maxCount;
    if (pct > 0.75) return 'bg-red-400';
    if (pct > 0.5) return 'bg-red-300';
    if (pct > 0.25) return 'bg-amber-300/85';
    return 'bg-amber-300/40';
  };

  return (
    <div className={`${glassStrong} p-5`}>
      <p className="font-semibold text-white/90 text-sm mb-1">Distribució per dia</p>
      <p className="text-xs text-white/60 mb-4">Quan arriben les ressenyes</p>
      <div className="flex gap-2">
        {cells.map((cell, i) => (
          <div key={i} className="flex-1 text-center">
            <div className={cn('h-16 rounded-xl flex items-center justify-center transition-all', getIntensity(cell.count))}
              title={`${DAY_NAMES_FULL[cell.day]}: ${cell.count} ressenyes, ${cell.avg_rating.toFixed(1)}★`}>
              {cell.count > 0 && (
                <div>
                  <p className="text-sm font-bold text-white/90">{cell.count}</p>
                  <p className="text-[9px] text-white/60">{cell.avg_rating > 0 ? `${cell.avg_rating.toFixed(1)}★` : ''}</p>
                </div>
              )}
            </div>
            <p className="text-[10px] text-white/60 mt-1.5 font-medium">{DAY_NAMES[cell.day]}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-3 text-[9px] text-white/60">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-white/8 border border-white/14" /> 0</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-300/40" /> Poc</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-300" /> Moderat</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-300" /> Alt</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-400" /> Crític</span>
      </div>
    </div>
  );
}

function ActionsList({ actions, onToggle, onDelete }: {
  actions: OpsAction[];
  onToggle: (a: OpsAction) => void;
  onDelete: (id: string) => void;
}) {
  if (actions.length === 0) {
    return (
      <div className="py-6 text-center text-white/70">
        <p className="text-xl mb-2">✅</p>
        <p className="text-xs">Cap acció en aquesta categoria</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {actions.map(action => (
        <div key={action.id} className="flex items-start gap-3 p-3 rounded-xl border border-white/14 hover:border-white/24 group transition-all">
          <button onClick={() => onToggle(action)}
            className={cn('w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all',
              action.status === 'done' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-white/24 hover:border-brand-accent/45')}>
            {action.status === 'done' && (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs">{TOPIC_ICONS[action.theme] || '📝'}</span>
              <span className="text-[10px] font-medium text-white/60 uppercase">{TOPIC_LABELS[action.theme] || action.theme}</span>
              {action.priority === 'high' && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">Alta</span>}
            </div>
            <p className={cn('text-sm leading-relaxed', action.status === 'done' ? 'text-white/55 line-through' : 'text-white/82')}>
              {action.title}
            </p>
            {action.done_at && (
              <p className="text-[10px] text-white/60 mt-1">Completada {new Date(action.done_at).toLocaleDateString('ca')}</p>
            )}
          </div>
          <button onClick={() => onDelete(action.id)}
            className="p-1 rounded-lg hover:bg-red-500/20 text-white/45 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-all">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className={`${glass} p-12 text-center`}>
      <p className="text-3xl mb-3">🔧</p>
      <p className="font-medium text-white/90 mb-1">Dashboard operatiu</p>
      <p className="text-sm text-white/70 max-w-md mx-auto">
        Genera respostes per a les teves ressenyes i els temes problemàtics apareixeran aquí automàticament,
        amb recomanacions i seguiment d&apos;accions.
      </p>
    </div>
  );
}
