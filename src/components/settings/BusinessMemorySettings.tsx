'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useT } from '@/components/i18n/I18nContext';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { glass, glassNoise, glassSweep } from '@/components/ui/glass';
import type { KnowledgeBaseEntry } from '@/types/database';
import type { BizOrgProps } from './types';

const CATEGORIES: { value: string; label: string; icon: string }[] = [
  { value: 'parking', label: 'Parking', icon: '🅿️' },
  { value: 'wifi', label: 'WiFi', icon: '📶' },
  { value: 'horaris', label: 'Horaris', icon: '🕐' },
  { value: 'política', label: 'Política', icon: '📋' },
  { value: 'menú', label: 'Menú / Cuina', icon: '🍽️' },
  { value: 'equip', label: 'Equip', icon: '👥' },
  { value: 'instal·lacions', label: 'Instal·lacions', icon: '🏢' },
  { value: 'ubicació', label: 'Ubicació', icon: '📍' },
  { value: 'promoció', label: 'Promocions', icon: '🎁' },
  { value: 'altres', label: 'Altres', icon: '📝' },
];

export default function BusinessMemorySettings({ biz, org }: BizOrgProps) {
  const t = useT();
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [category, setCategory] = useState('altres');
  const [content, setContent] = useState('');
  const [triggers, setTriggers] = useState('');
  const [sentimentCtx, setSentimentCtx] = useState('');
  const [saving, setSaving] = useState(false);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const supabase = createClient();

  const loadEntries = async () => {
    const { data } = await supabase
      .from('knowledge_base_entries')
      .select('*')
      .eq('biz_id', biz.id)
      .order('category')
      .order('created_at', { ascending: false });
    setEntries((data as KnowledgeBaseEntry[]) || []);
    setLoading(false);
  };

  useEffect(() => { loadEntries(); }, [biz.id]);

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    const triggersArray = triggers.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    const payload = {
      category,
      content,
      triggers: triggersArray,
      sentiment_context: sentimentCtx || null,
    };
    if (editId) {
      await supabase.from('knowledge_base_entries').update(payload).eq('id', editId);
    } else {
      await supabase.from('knowledge_base_entries').insert({
        ...payload,
        biz_id: biz.id,
        org_id: org.id,
      });
    }
    resetForm();
    setSaving(false);
    loadEntries();
  };

  const handleEdit = (e: KnowledgeBaseEntry) => {
    setEditId(e.id);
    setCategory(e.category);
    setContent(e.content);
    setTriggers((e.triggers || []).join(', '));
    setSentimentCtx(e.sentiment_context || '');
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('settings.kb.deleteConfirm'))) return;
    await supabase.from('knowledge_base_entries').delete().eq('id', id);
    loadEntries();
  };

  const resetForm = () => {
    setShowForm(false);
    setEditId(null);
    setCategory('altres');
    setContent('');
    setTriggers('');
    setSentimentCtx('');
  };

  const filtered = filterCat ? entries.filter(e => e.category === filterCat) : entries;

  const grouped = filtered.reduce((acc, e) => {
    const cat = e.category || 'altres';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(e);
    return acc;
  }, {} as Record<string, KnowledgeBaseEntry[]>);

  const getCatInfo = (cat: string) => CATEGORIES.find(c => c.value === cat) || { icon: '📝', label: cat };

  return (
    <div className="max-w-3xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/70">Fets verificats que la IA pot referenciar. Mai inventa més enllà d&apos;això.</p>
          <p className="text-xs text-white/60 mt-0.5">{entries.length} entrad{entries.length === 1 ? 'a' : 'es'}</p>
        </div>
        <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}>+ Afegir</Button>
      </div>

      {/* Category filter */}
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setFilterCat(null)}
          className={cn('rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-[220ms] ease-premium',
            !filterCat
              ? 'bg-white/8 text-white border border-brand-accent/30 ring-1 ring-brand-accent/20 shadow-[0_0_18px_rgba(0,168,107,0.12)]'
              : 'bg-white/5 text-white/70 border border-white/10 hover:bg-white/8 hover:text-white')}>
          Totes
        </button>
        {CATEGORIES.map(c => {
          const count = entries.filter(e => e.category === c.value).length;
          if (count === 0) return null;
          return (
            <button key={c.value} onClick={() => setFilterCat(filterCat === c.value ? null : c.value)}
              className={cn('rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-[220ms] ease-premium',
                filterCat === c.value
                  ? 'bg-white/8 text-white border border-brand-accent/30 ring-1 ring-brand-accent/20 shadow-[0_0_18px_rgba(0,168,107,0.12)]'
                  : 'bg-white/5 text-white/70 border border-white/10 hover:bg-white/8 hover:text-white')}>
              {c.icon} {c.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Form */}
      {showForm && (
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm animate-fade-in">
          <div className="flex items-start justify-between gap-4 border-b border-black/10 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-zinc-900">
                {editId ? 'Editar entrada' : 'Nova entrada'}
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                Afegeix informació verificable perquè LITO pugui respondre amb precisió.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={resetForm} className="border-black/10 bg-white text-zinc-700 hover:bg-zinc-100">
              Cancel·lar
            </Button>
          </div>

          <div className="divide-y divide-black/10">
            <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,220px)_1fr] md:items-center">
              <div>
                <p className="text-sm font-medium text-zinc-900">Categoria</p>
                <p className="text-sm text-zinc-500">Classifica l&apos;entrada per mantenir el context ordenat.</p>
              </div>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-zinc-900 transition focus:border-emerald-500/45 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                {CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,220px)_1fr]">
              <div>
                <p className="text-sm font-medium text-zinc-900">Contingut</p>
                <p className="text-sm text-zinc-500">Text que la IA pot reutilitzar literalment quan sigui rellevant.</p>
              </div>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="Ex.: Parking gratuït per a clients. Entrada per Av. Catalunya amb barrera automàtica."
                className="min-h-[96px] w-full resize-y rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 transition focus:border-emerald-500/45 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,220px)_1fr] md:items-center">
              <div>
                <p className="text-sm font-medium text-zinc-900">Paraules activadores</p>
                <p className="text-sm text-zinc-500">Separa-les amb comes per activar aquesta entrada en context.</p>
              </div>
              <input
                value={triggers}
                onChange={(event) => setTriggers(event.target.value)}
                placeholder="parking, aparcar, cotxe, aparcament"
                className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 transition focus:border-emerald-500/45 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,220px)_1fr]">
              <div>
                <p className="text-sm font-medium text-zinc-900">Context per negatives (opcional)</p>
                <p className="text-sm text-zinc-500">Orientació breu per a ressenyes amb sentiment negatiu.</p>
              </div>
              <textarea
                value={sentimentCtx}
                onChange={(event) => setSentimentCtx(event.target.value)}
                placeholder="Ex.: Disculpar-se i oferir alternatives de parking proper."
                className="min-h-[72px] w-full resize-y rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 transition focus:border-emerald-500/45 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-black/10 bg-zinc-50/70 px-5 py-3">
            <Button variant="secondary" onClick={resetForm} className="border-black/10 bg-white text-zinc-700 hover:bg-zinc-100">
              Cancel·lar
            </Button>
            <Button onClick={handleSave} loading={saving}>
              Desar entrada
            </Button>
          </div>
        </div>
      )}

      {/* Entries list */}
      {loading ? (
        <div className="space-y-2">{[0,1,2].map(i => <div key={i} className="h-20 bg-white/10 rounded-xl animate-pulse" />)}</div>
      ) : entries.length === 0 ? (
        <div className={cn(glass, glassNoise, glassSweep, 'border border-white/10 p-8 text-center shadow-glass')}>
          <p className="font-medium text-white/90 mb-1">Encara no hi ha entrades</p>
          <p className="text-sm text-white/70 mb-4 max-w-md mx-auto">
            Afegeix fets verificats perquè LITO respongui amb precisió.
          </p>
          <Button size="sm" onClick={() => setShowForm(true)}>Afegir entrada</Button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([cat, items]) => {
            const catInfo = getCatInfo(cat);
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">{catInfo.icon}</span>
                  <span className="text-xs font-bold uppercase text-white/70 tracking-wider">{catInfo.label}</span>
                  <span className="text-[10px] text-white/55">({items.length})</span>
                </div>
                <div className="space-y-2">
                  {items.map(e => (
                    <div key={e.id} className="bg-white/8 rounded-xl border border-white/14 p-4 group transition-all duration-[220ms] ease-premium hover:border-brand-accent/20 hover:shadow-[0_0_20px_rgba(0,168,107,0.10)]">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white/90 leading-relaxed">{e.content}</p>
                          {e.triggers.length > 0 && (
                            <div className="flex gap-1 flex-wrap mt-2">
                              {e.triggers.map((t, i) => (
                                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/18 text-emerald-300 border border-emerald-300/30 font-medium">{t}</span>
                              ))}
                            </div>
                          )}
                          {e.sentiment_context && (
                            <p className="text-xs text-amber-300 mt-1.5 flex items-center gap-1">
                              <span>⚡</span> {e.sentiment_context}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button onClick={() => handleEdit(e)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white/82">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button onClick={() => handleDelete(e.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/60 hover:text-red-300">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
