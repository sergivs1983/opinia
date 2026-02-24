'use client';

import { useT } from '@/components/i18n/I18nContext';
import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { glass, glassNoise, glassStrong, glassSweep, ringAccent } from '@/components/ui/glass';
import type { BizOrgProps } from './types';
import type { ActionTrigger } from '@/types/database';

type SentimentFilterOption = NonNullable<ActionTrigger['sentiment_filter']> | '';
type ActionTypeOption = ActionTrigger['action_type'];

const SENTIMENT_OPTS = [
  { value: '', labelKey: 'common.anySentiment' },
  { value: 'negative', labelKey: 'settings.triggers.sentimentOptions.negative' },
  { value: 'neutral', labelKey: 'settings.triggers.sentimentOptions.neutral' },
  { value: 'positive', labelKey: 'settings.triggers.sentimentOptions.positive' },
] as const satisfies ReadonlyArray<{ value: SentimentFilterOption; labelKey: string }>;

const ACTION_TYPES = [
  { value: 'in_app_alert', labelKey: 'settings.triggers.actionTypes.in_app_alert', disabled: false },
  { value: 'email', labelKey: 'settings.triggers.actionTypes.email', disabled: true },
  { value: 'slack', labelKey: 'settings.triggers.actionTypes.slack', disabled: true },
  { value: 'webhook', labelKey: 'settings.triggers.actionTypes.webhook', disabled: true },
] as const satisfies ReadonlyArray<{ value: ActionTypeOption; labelKey: string; disabled?: boolean }>;

export default function ActionTriggersSettings({ biz, org }: BizOrgProps) {
  const t = useT();
  const [triggers, setTriggers] = useState<ActionTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [topics, setTopics] = useState('');
  const [phrases, setPhrases] = useState('');
  const [minRating, setMinRating] = useState<number | ''>('');
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilterOption>('');
  const [actionType, setActionType] = useState<ActionTypeOption>('in_app_alert');

  // Test
  const [testText, setTestText] = useState('');
  const [testResults, setTestResults] = useState<{ id: string; name: string; match_reason: string }[] | null>(null);
  const [testing, setTesting] = useState(false);

  const loadTriggers = async () => {
    const res = await fetch(`/api/triggers?biz_id=${biz.id}`);
    const data = await res.json();
    setTriggers(data.triggers || []);
    setLoading(false);
  };

  useEffect(() => { loadTriggers(); }, [biz.id]);

  const resetForm = () => {
    setEditId(null); setName(''); setTopics(''); setPhrases('');
    setMinRating(''); setSentimentFilter(''); setActionType('in_app_alert');
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const payload = {
      org_id: org.id, biz_id: biz.id, name: name.trim(),
      match_topics: topics.split(',').map(s => s.trim()).filter(Boolean),
      match_phrases: phrases.split(',').map(s => s.trim()).filter(Boolean),
      min_rating: minRating === '' ? null : Number(minRating),
      sentiment_filter: sentimentFilter || null,
      action_type: actionType,
    };
    await fetch('/api/triggers', {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editId ? { id: editId, ...payload } : payload),
    });
    await loadTriggers();
    resetForm();
    setSaving(false);
  };

  const handleEdit = (trig: ActionTrigger) => {
    setEditId(trig.id); setName(trig.name);
    setTopics((trig.match_topics || []).join(', '));
    setPhrases((trig.match_phrases || []).join(', '));
    setMinRating(trig.min_rating ?? '');
    setSentimentFilter(trig.sentiment_filter || '');
    setActionType(trig.action_type || 'in_app_alert');
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('settings.triggers.deleteConfirm'))) return;
    await fetch(`/api/triggers?id=${id}`, { method: 'DELETE' });
    await loadTriggers();
  };

  const handleToggle = async (id: string, current: boolean) => {
    await fetch('/api/triggers', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_enabled: !current }),
    });
    await loadTriggers();
  };

  const handleTest = async () => {
    if (!testText.trim()) return;
    setTesting(true);
    const res = await fetch('/api/triggers/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ biz_id: biz.id, test_text: testText }),
    });
    const data = await res.json();
    setTestResults(data.matches || []);
    setTesting(false);
  };

  if (loading) return <div className="text-center py-8 text-white/70">{t('common.loading')}</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Create/Edit */}
      <div className={cn(glassStrong, glassNoise, glassSweep, 'border border-white/10 p-6 shadow-glass space-y-4')}>
        <h3 className="font-semibold text-white/90">{editId ? t('settings.triggers.editTitle') : t('settings.triggers.newTitle')}</h3>
        <Input
          label={t('settings.triggers.name')}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('settings.triggers.namePlaceholder')}
        />
        <Input
          label={t('settings.triggers.matchTopics')}
          value={topics}
          onChange={e => setTopics(e.target.value)}
          placeholder={t('settings.triggers.matchTopicsPlaceholder')}
        />
        <Input
          label={t('settings.triggers.matchPhrases')}
          value={phrases}
          onChange={e => setPhrases(e.target.value)}
          placeholder={t('settings.triggers.matchPhrasesPlaceholder')}
        />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-white/80 block mb-1">{t('settings.triggers.sentimentFilter')}</label>
            <select value={sentimentFilter} onChange={e => setSentimentFilter(e.target.value as SentimentFilterOption)}
              className={cn('w-full rounded-xl border border-white/14 bg-white/8 px-3 py-2.5 text-sm text-white/90', ringAccent)}>
              {SENTIMENT_OPTS.map(o => (
                <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-white/80 block mb-1">{t('settings.triggers.minRating')}</label>
            <select value={minRating} onChange={e => setMinRating(e.target.value === '' ? '' : Number(e.target.value))}
              className={cn('w-full rounded-xl border border-white/14 bg-white/8 px-3 py-2.5 text-sm text-white/90', ringAccent)}>
              <option value="">{t('settings.triggers.minRatingAny')}</option>
              {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}+</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-white/80 block mb-1">{t('settings.triggers.actionType')}</label>
          <div className="flex gap-2 flex-wrap">
            {ACTION_TYPES.map(a => (
              <button key={a.value} onClick={() => !a.disabled && setActionType(a.value)} disabled={a.disabled}
                className={cn('rounded-full px-3 py-1.5 text-sm transition-all duration-[220ms] ease-premium',
                  actionType === a.value
                    ? 'bg-white/8 text-white border border-brand-accent/30 ring-1 ring-brand-accent/20 shadow-[0_0_18px_rgba(0,168,107,0.12)]'
                    : 'bg-white/5 text-white/70 border border-white/10 hover:bg-white/8 hover:text-white',
                  a.disabled && 'opacity-40 cursor-not-allowed')}>
                {t(a.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={handleSave} loading={saving}>{editId ? t('settings.triggers.update') : t('settings.triggers.create')}</Button>
          {editId && <button onClick={resetForm} className="text-sm text-white/72 hover:text-white/90">{t('common.cancel')}</button>}
        </div>
      </div>

      {/* List */}
      {triggers.length > 0 && (
        <div className={cn(glass, glassNoise, glassSweep, 'border border-white/10 p-6 shadow-glass')}>
          <h3 className="font-semibold text-white/90 mb-4">{t('settings.triggers.activeCount', { count: triggers.length })}</h3>
          <div className="space-y-3">
            {triggers.map(trig => (
              <div key={trig.id} className={cn('rounded-xl border p-4 transition-all duration-[220ms] ease-premium',
                trig.is_enabled
                  ? 'border-white/14 bg-white/8 hover:border-brand-accent/20 hover:shadow-[0_0_20px_rgba(0,168,107,0.10)]'
                  : 'border-white/10 bg-white/5 opacity-60')}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button onClick={() => handleToggle(trig.id, trig.is_enabled)}
                      className={cn('relative w-10 h-5 rounded-full transition-colors', trig.is_enabled ? 'bg-brand-accent' : 'bg-white/20')}>
                      <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', trig.is_enabled ? 'translate-x-5' : 'translate-x-0.5')} />
                    </button>
                    <span className="font-medium text-white/90 text-sm">{trig.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleEdit(trig)} className="text-xs text-emerald-300 hover:text-emerald-200">{t('common.edit')}</button>
                    <button onClick={() => handleDelete(trig.id)} className="text-xs text-rose-300 hover:text-rose-200 transition-colors duration-[220ms] ease-premium">{t('common.delete')}</button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {trig.match_topics?.map(topic => <span key={topic} className="px-2 py-0.5 rounded-full border border-white/14 bg-white/8 text-white/72 text-[10px] font-medium">{t('settings.triggers.topicPrefix')}: {topic}</span>)}
                  {trig.match_phrases?.map(phrase => <span key={phrase} className="px-2 py-0.5 rounded-full border border-white/14 bg-white/8 text-white/72 text-[10px] font-medium">{t('settings.triggers.phrasePrefix')}: {phrase}</span>)}
                  {trig.sentiment_filter && <span className="px-2 py-0.5 rounded-full border border-emerald-300/45 bg-emerald-400/15 text-emerald-300 text-[10px] font-medium">{trig.sentiment_filter}</span>}
                  <span className="px-2 py-0.5 rounded-full border border-white/14 bg-white/8 text-white/72 text-[10px]">{trig.action_type}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Test */}
      <div className={cn(glass, glassNoise, glassSweep, 'border border-white/10 p-6 shadow-glass space-y-4')}>
        <h3 className="font-semibold text-white/90">{t('settings.triggers.testTitle')}</h3>
        <p className="text-xs text-white/70">{t('settings.triggers.testDescription')}</p>
        <textarea value={testText} onChange={e => setTestText(e.target.value)} rows={3}
          placeholder={t('settings.triggers.testPlaceholder')}
          className={cn('w-full rounded-xl border border-white/14 bg-white/8 px-4 py-3 text-sm text-white/90 resize-y transition-all', ringAccent)} />
        <Button onClick={handleTest} loading={testing} variant="secondary">{t('settings.triggers.runMatch')}</Button>
        {testResults !== null && (
          <div className="mt-3">
            {testResults.length === 0 ? (
              <p className="text-sm text-white/70">{t('settings.triggers.noMatches')}</p>
            ) : testResults.map(m => (
              <div key={m.id} className="flex items-center gap-2 text-sm">
                <span className="text-emerald-500">⚡</span>
                <span className="font-medium">{m.name}</span>
                <span className="text-xs text-white/60">{t('settings.triggers.matchedPrefix')} {m.match_reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
