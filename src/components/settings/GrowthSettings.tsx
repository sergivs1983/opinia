'use client';

import { useT } from '@/components/i18n/I18nContext';
import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import type { BizOrgProps } from './types';
import { cn } from '@/lib/utils';
import { glass, glassCard, textMain, textMuted, textSub } from '@/components/ui/glass';

interface GrowthLink {
  id: string;
  slug: string;
  target_url: string;
  clicks_7d?: number;
  scan_count?: number;
}

export default function GrowthSettings({ biz, org }: BizOrgProps) {
  const t = useT();
  const [links, setLinks] = useState<GrowthLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [targetUrl, setTargetUrl] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadLinks = async () => {
    setLoading(true);
    const res = await fetch(`/api/growth-links?biz_id=${biz.id}`);
    if (res.ok) setLinks(await res.json());
    setLoading(false);
  };

  useEffect(() => { loadLinks(); }, [biz.id]);

  const handleCreate = async () => {
    if (!targetUrl.trim()) return;
    setCreating(true);
    const res = await fetch('/api/growth-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ biz_id: biz.id, org_id: org.id, target_url: targetUrl }),
    });
    if (res.ok) { setTargetUrl(''); await loadLinks(); }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('settings.growth.deleteConfirm'))) return;
    await fetch(`/api/growth-links?id=${id}`, { method: 'DELETE' });
    setLinks(links.filter(l => l.id !== id));
  };

  const copyLink = (slug: string, id: string) => {
    const url = `${window.location.origin}/api/g/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const totalClicks7d = links.reduce((s, l) => s + (l.clicks_7d || 0), 0);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className={cn(glassCard, 'text-center p-4')}>
          <p className={cn('text-2xl font-bold', textMain)}>{links.length}</p>
          <p className={cn('text-xs', textMuted)}>Enllaços actius</p>
        </div>
        <div className={cn(glassCard, 'text-center p-4')}>
          <p className="text-2xl font-bold text-emerald-300">{totalClicks7d}</p>
          <p className={cn('text-xs', textMuted)}>Clics (7 dies)</p>
        </div>
        <div className={cn(glassCard, 'text-center p-4')}>
          <p className="text-2xl font-bold text-cyan-200">{links.reduce((s, l) => s + (l.scan_count || 0), 0)}</p>
          <p className={cn('text-xs', textMuted)}>Total escanejos</p>
        </div>
      </div>

      {/* Create new */}
      <div className={cn(glassCard, 'p-5')}>
        <h3 className={cn('mb-3 font-semibold', textMain)}>📎 Crear nou enllaç de ressenya</h3>
        <p className={cn('mb-3 text-xs', textMuted)}>
          Enganxa el teu Google review link per generar un QR i enllaç curt amb tracking.
        </p>
        <div className="flex gap-2">
          <Input value={targetUrl} onChange={e => setTargetUrl(e.target.value)}
            placeholder="https://g.page/r/xxx/review o qualsevol URL" className="flex-1" />
          <Button onClick={handleCreate} loading={creating} disabled={!targetUrl.trim()}>+ Crear</Button>
        </div>
      </div>

      {/* Links list */}
      {loading ? (
        <div className={cn('py-8 text-center', textMuted)}>Carregant...</div>
      ) : links.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">🔗</p>
          <p className={cn('mb-1 font-semibold', textSub)}>Cap enllaç creat</p>
          <p className={cn('text-sm', textMuted)}>Crea el teu primer growth link per començar a recollir ressenyes.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map(link => (
            <div key={link.id} className={cn(glassCard, 'flex items-center gap-4 p-4')}>
              <div className="h-16 w-16 flex-shrink-0 rounded-lg border border-white/16 bg-white/8 flex items-center justify-center text-2xl">📱</div>
              <div className="flex-1 min-w-0">
                <p className={cn('truncate text-sm font-medium', textMain)}>{link.target_url}</p>
                <p className="mt-0.5 font-mono text-xs text-emerald-300">{window.location.origin}/api/g/{link.slug}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className={cn('text-xs', textMuted)}>📊 {link.clicks_7d || 0} clics (7d)</span>
                  <span className={cn('text-xs', textMuted)}>📱 {link.scan_count || 0} total</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button variant="ghost" size="sm" onClick={() => copyLink(link.slug, link.id)}>
                  {copiedId === link.id ? '✅ Copiat' : '📋 Copiar'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(link.id)} className="text-rose-300 hover:text-rose-200">🗑️</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={cn(glass, 'rounded-xl p-4')}>
        <p className={cn('text-xs', textMuted)}>
          💡 <strong>Consell:</strong> Genera un QR amb qualsevol eina (qr-code-generator.com) apuntant a l&apos;enllaç curt.
          OpinIA comptarà cada clic i escaneig automàticament.
        </p>
      </div>
    </div>
  );
}
