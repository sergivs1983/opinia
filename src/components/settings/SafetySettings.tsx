'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useT } from '@/components/i18n/I18nContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { glass, glassNoise, glassStrong, glassSweep, ringAccent } from '@/components/ui/glass';
import type { SafetySettingsProps } from './types';

export default function SafetySettings({ biz, org, onSaved }: SafetySettingsProps) {
  const t = useT();
  const supabase = createClient();
  const [panicMode, setPanicMode] = useState(biz.panic_mode || false);
  const [panicReason, setPanicReason] = useState(biz.panic_reason || '');
  const [toggling, setToggling] = useState(false);
  const [constraints, setConstraints] = useState<string>(
    Array.isArray(biz.negative_constraints) ? biz.negative_constraints.join('\n') : ''
  );
  const [savingConstraints, setSavingConstraints] = useState(false);
  const [savedConstraints, setSavedConstraints] = useState(false);

  const handleTogglePanic = async () => {
    setToggling(true);
    const newMode = !panicMode;
    await supabase.from('businesses').update({
      panic_mode: newMode,
      panic_reason: newMode ? (panicReason || null) : null,
      panic_enabled_at: newMode ? new Date().toISOString() : null,
    }).eq('id', biz.id);

    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: newMode ? 'panic_mode_enabled' : 'panic_mode_disabled',
        org_id: org.id, biz_id: biz.id,
        metadata: { reason: panicReason || null },
      }),
    }).catch(() => {});

    setPanicMode(newMode);
    await onSaved();
    setToggling(false);
  };

  const handleSaveConstraints = async () => {
    setSavingConstraints(true);
    const arr = constraints.split('\n').map(s => s.trim()).filter(Boolean);
    await supabase.from('businesses').update({ negative_constraints: arr }).eq('id', biz.id);
    await onSaved();
    setSavingConstraints(false);
    setSavedConstraints(true);
    setTimeout(() => setSavedConstraints(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Panic Button */}
      <div className={cn(glassStrong, glassNoise, glassSweep, 'p-6', panicMode ? 'border-red-400/45 bg-red-500/10' : '')}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-white/90 flex items-center gap-2">🚨 {t('settings.safety.panicTitle')}</h3>
            <p className="text-xs text-white/70 mt-1">{t('settings.safety.panicDesc')}</p>
          </div>
          <button onClick={handleTogglePanic} disabled={toggling}
            className={cn('relative w-14 h-7 rounded-full transition-colors duration-[220ms] ease-premium', panicMode ? 'bg-red-500' : 'bg-white/20', toggling && 'opacity-50', ringAccent)}>
            <span className={cn('absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform', panicMode ? 'translate-x-7' : 'translate-x-0.5')} />
          </button>
        </div>
        {panicMode && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-rose-300 font-medium">
              <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
              {t('settings.safety.panicActive', { date: biz.panic_enabled_at ? new Date(biz.panic_enabled_at).toLocaleString('ca') : '—' })}
            </div>
            <div>
              <label className="text-xs text-white/70 block mb-1">{t('settings.safety.panicReason')}</label>
              <Input value={panicReason} onChange={e => setPanicReason(e.target.value)} placeholder={t('settings.safety.panicReasonPlaceholder')} />
            </div>
          </div>
        )}
      </div>

      {/* Negative Constraints */}
      <div className={cn(glass, glassNoise, glassSweep, 'p-6')}>
        <h3 className="font-semibold text-white/90 mb-1">🚫 {t('settings.safety.constraints')}</h3>
        <p className="text-xs text-white/70 mb-4">{t('settings.safety.constraintsDesc')}</p>
        <textarea value={constraints} onChange={e => setConstraints(e.target.value)} rows={5}
          placeholder={t('settings.safety.constraintsPlaceholder')}
          className={cn('w-full rounded-xl border border-white/14 bg-white/8 px-4 py-3 text-sm text-white/90 resize-y transition-all', ringAccent)} />
        <div className="flex items-center gap-3 mt-4">
          <Button onClick={handleSaveConstraints} loading={savingConstraints}>{t('settings.safety.saveConstraints')}</Button>
          {savedConstraints && <span className="text-sm text-emerald-300 font-medium">✅ {t('common.saved')}</span>}
        </div>
      </div>

      <div className={cn(glass, glassNoise, 'p-4')}>
        <p className="text-xs text-white/70">💡 {t('settings.safety.defaultsInfo')}</p>
      </div>
    </div>
  );
}
