'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Brain,
  CreditCard,
  Globe2,
  PlugZap,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';

import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import Card, { CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Toggle from '@/components/ui/Toggle';
import Skeleton from '@/components/ui/Skeleton';
import IntegrationsPlaceholder from '@/components/settings/IntegrationsPlaceholder';
import BusinessMemorySettings from '@/components/settings/BusinessMemorySettings';
import BillingSettings from '@/components/settings/BillingSettings';
import LanguageSettings from '@/components/settings/LanguageSettings';
import LITOHealthTab from '@/components/lito/tabs/LITOHealthTab';

type SettingsPanelKey = 'general' | 'integrations' | 'brand-brain' | 'billing' | 'language' | 'health';

type PanelItem = {
  key: SettingsPanelKey;
  Icon: LucideIcon;
  label: string;
  navDescription: string;
};

type SettingsApiPayload = {
  ok?: boolean;
  settings?: {
    signature: string | null;
    ai_instructions: string | null;
    keywords_use: string[];
    keywords_avoid: string[];
    ai_engine: string;
    seo_enabled: boolean;
  };
  role?: string | null;
  error?: string;
  message?: string;
};

type GeneralFormState = {
  signature: string;
  aiInstructions: string;
  keywordsUse: string;
  keywordsAvoid: string;
  aiEngine: string;
  seoEnabled: boolean;
};

const PANEL_ITEMS: PanelItem[] = [
  {
    key: 'general',
    Icon: SlidersHorizontal,
    label: 'General',
    navDescription: 'To i comportament de la IA',
  },
  {
    key: 'integrations',
    Icon: PlugZap,
    label: 'Integracions',
    navDescription: 'Google Business i connectors',
  },
  {
    key: 'brand-brain',
    Icon: Brain,
    label: 'Brand Brain',
    navDescription: 'Memòria de negoci i context',
  },
  {
    key: 'billing',
    Icon: CreditCard,
    label: 'Billing',
    navDescription: 'Pla i ús actual',
  },
  {
    key: 'language',
    Icon: Globe2,
    label: 'Idioma',
    navDescription: 'Llengua de la plataforma',
  },
  {
    key: 'health',
    Icon: Activity,
    label: 'Health',
    navDescription: 'KPI i guardrails',
  },
];

const EMPTY_FORM: GeneralFormState = {
  signature: '',
  aiInstructions: '',
  keywordsUse: '',
  keywordsAvoid: '',
  aiEngine: 'opinia_ai',
  seoEnabled: false,
};

function toFormState(payload: SettingsApiPayload['settings']): GeneralFormState {
  return {
    signature: payload?.signature || '',
    aiInstructions: payload?.ai_instructions || '',
    keywordsUse: Array.isArray(payload?.keywords_use) ? payload?.keywords_use.join(', ') : '',
    keywordsAvoid: Array.isArray(payload?.keywords_avoid) ? payload?.keywords_avoid.join(', ') : '',
    aiEngine: payload?.ai_engine || 'opinia_ai',
    seoEnabled: payload?.seo_enabled ?? false,
  };
}

function serializeFormForPatch(form: GeneralFormState, bizId: string) {
  return JSON.stringify({
    biz_id: bizId,
    signature: form.signature,
    ai_instructions: form.aiInstructions,
    keywords_use: form.keywordsUse,
    keywords_avoid: form.keywordsAvoid,
    ai_engine: form.aiEngine,
    seo_enabled: form.seoEnabled,
  });
}

function GeneralPanel() {
  const { biz } = useWorkspace();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(true);
  const [form, setForm] = useState<GeneralFormState>(EMPTY_FORM);
  const lastSavedPayloadRef = useRef<string>('');
  const mountedRef = useRef(true);

  const bizId = biz?.id || null;

  const fetchSettings = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/settings?biz_id=${encodeURIComponent(bizId)}`, {
        headers: {
          'x-biz-id': bizId,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as SettingsApiPayload;
      if (!response.ok || !payload.settings) {
        toast(payload.message || 'No s’ha pogut carregar configuració', 'error');
        setLoading(false);
        return;
      }

      const nextForm = toFormState(payload.settings);
      setForm(nextForm);
      setCanEdit(payload.role === 'owner' || payload.role === 'manager');
      lastSavedPayloadRef.current = serializeFormForPatch(nextForm, bizId);
    } catch {
      toast('No s’ha pogut carregar configuració', 'error');
    } finally {
      setLoading(false);
    }
  }, [bizId, toast]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const patchPayload = useMemo(() => {
    if (!bizId) return null;
    return serializeFormForPatch(form, bizId);
  }, [bizId, form]);

  useEffect(() => {
    if (!bizId || loading || !canEdit || !patchPayload) return undefined;
    if (patchPayload === lastSavedPayloadRef.current) return undefined;

    const timer = setTimeout(async () => {
      if (!mountedRef.current) return;
      setSaving(true);
      try {
        const response = await fetch(`/api/settings?biz_id=${encodeURIComponent(bizId)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-biz-id': bizId,
          },
          body: patchPayload,
        });

        const payload = (await response.json().catch(() => ({}))) as SettingsApiPayload;
        if (!response.ok || !payload.settings) {
          toast(payload.message || 'No s’ha pogut desar configuració', 'error');
          return;
        }

        const normalized = toFormState(payload.settings);
        const normalizedSerialized = serializeFormForPatch(normalized, bizId);
        lastSavedPayloadRef.current = normalizedSerialized;
        setForm(normalized);
        toast('Desat', 'success');
      } catch {
        toast('No s’ha pogut desar configuració', 'error');
      } finally {
        if (mountedRef.current) setSaving(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [bizId, canEdit, loading, patchPayload, toast]);

  if (!bizId || loading) {
    return (
      <Card className="border border-black/10 bg-white/95">
        <CardHeader>
          <CardTitle>Configuració general</CardTitle>
          <CardDescription>Ajusta veu, estils i paràmetres base de LITO.</CardDescription>
        </CardHeader>
        <div className="space-y-4">
          <Skeleton className="h-10 rounded-xl bg-zinc-100" />
          <Skeleton className="h-28 rounded-xl bg-zinc-100" />
          <Skeleton className="h-10 rounded-xl bg-zinc-100" />
          <Skeleton className="h-10 rounded-xl bg-zinc-100" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="border border-black/10 bg-white/95">
      <CardHeader>
        <CardTitle>Configuració general</CardTitle>
        <CardDescription>Ajusta veu, estils i paràmetres base de LITO.</CardDescription>
      </CardHeader>

      <div className="space-y-4">
        <Input
          label="Signatura"
          hint="Text final que afegim automàticament a les respostes."
          placeholder="hotel"
          value={form.signature}
          disabled={!canEdit || saving}
          onChange={(event) => setForm((prev) => ({ ...prev, signature: event.target.value }))}
          className="border-black/15 bg-white text-zinc-900 placeholder:text-zinc-400"
        />

        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-900">
            Instruccions per a la IA
          </label>
          <p className="mb-2 text-xs text-zinc-500">Context de marca i estil que ha de seguir LITO.</p>
          <textarea
            value={form.aiInstructions}
            disabled={!canEdit || saving}
            onChange={(event) => setForm((prev) => ({ ...prev, aiInstructions: event.target.value }))}
            placeholder="Ex: Mai mencionar preus. Sempre convidar a tornar."
            className="min-h-[120px] w-full rounded-[var(--radius-md)] border border-black/15 bg-white px-3.5 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[var(--brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)]/25 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <Input
          label="Paraules a USAR (separades per coma)"
          hint="Paraules clau associades a sentiment positiu."
          placeholder="hospitalitat, excel·lència, benvinguda"
          value={form.keywordsUse}
          disabled={!canEdit || saving}
          onChange={(event) => setForm((prev) => ({ ...prev, keywordsUse: event.target.value }))}
          className="border-black/15 bg-white text-zinc-900 placeholder:text-zinc-400"
        />

        <Input
          label="Paraules a EVITAR (separades per coma)"
          hint="Paraules clau associades a sentiment negatiu."
          placeholder="barat, descarrèc, problema"
          value={form.keywordsAvoid}
          disabled={!canEdit || saving}
          onChange={(event) => setForm((prev) => ({ ...prev, keywordsAvoid: event.target.value }))}
          className="border-black/15 bg-white text-zinc-900 placeholder:text-zinc-400"
        />

        <Select
          label="Motor d'IA"
          options={[{ value: 'opinia_ai', label: 'OpinIA AI' }]}
          value={form.aiEngine}
          disabled
          onChange={() => undefined}
          className="border-black/15 bg-white text-zinc-900"
        />
        <p className="-mt-2 text-xs text-zinc-500">Motor de generació optimitzat per OpinIA.</p>

        <div className="rounded-[var(--radius-lg)] border border-black/10 bg-zinc-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-900">SEO</p>
              <p className="mt-1 text-xs text-zinc-500">
                Keywords que s&apos;integraran naturalment a les respostes per millorar el posicionament a Google Maps.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-zinc-500">
                {form.seoEnabled ? 'Activat' : 'Desactivat'}
              </span>
              <Toggle
                checked={form.seoEnabled}
                disabled={!canEdit || saving}
                onChange={(checked) => setForm((prev) => ({ ...prev, seoEnabled: checked }))}
                label="SEO"
              />
            </div>
          </div>
        </div>

        {!canEdit ? (
          <p className="text-xs text-zinc-500">No tens permisos d’edició (owner/manager).</p>
        ) : (
          <p className="text-xs text-zinc-500">{saving ? 'Desant…' : 'Canvis desats automàticament.'}</p>
        )}
      </div>
    </Card>
  );
}

function PlaceholderPanel({ title, description }: { title: string; description: string }) {
  return (
    <Card className="border border-black/10 bg-white/95">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export default function SettingsPage() {
  const { biz, org } = useWorkspace();
  const [panel, setPanel] = useState<SettingsPanelKey>('general');

  const renderPanel = () => {
    if (panel === 'general') return <GeneralPanel />;
    if (panel === 'integrations') return <IntegrationsPlaceholder />;
    if (panel === 'brand-brain') {
      if (biz && org) return <BusinessMemorySettings biz={biz} org={org} />;
      return <PlaceholderPanel title="Brand Brain" description="Memòria de negoci i context" />;
    }
    if (panel === 'billing') {
      if (org) return <BillingSettings org={org} />;
      return <PlaceholderPanel title="Billing" description="Pla i ús actual" />;
    }
    if (panel === 'language') return <LanguageSettings />;
    if (panel === 'health') return <LITOHealthTab />;
    return <GeneralPanel />;
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-6 md:px-6">
      <div className="mb-6">
        <h1 className="font-serif text-3xl font-semibold tracking-[-0.02em] text-zinc-900">Configuració</h1>
        <p className="mt-1 text-sm text-zinc-500">Gestiona el comportament i les fonts de context de LITO.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-black/10 bg-zinc-50/80 p-3">
          <nav className="flex flex-col gap-1.5">
            {PANEL_ITEMS.map((item) => {
              const active = panel === item.key;
              const Icon = item.Icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setPanel(item.key)}
                  className={[
                    'w-full rounded-xl border px-3 py-2.5 text-left transition',
                    active
                      ? 'border-black/10 bg-white shadow-sm'
                      : 'border-transparent bg-transparent hover:border-black/5 hover:bg-white/70',
                  ].join(' ')}
                >
                  <span className="flex items-start gap-2.5">
                    <Icon
                      size={16}
                      className={active ? 'mt-0.5 text-zinc-900' : 'mt-0.5 text-zinc-500'}
                      aria-hidden="true"
                    />
                    <span>
                      <span className="block text-[13px] font-semibold leading-tight text-zinc-900">{item.label}</span>
                      <span className="mt-1 block text-[11px] leading-tight text-zinc-500">{item.navDescription}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="min-w-0">{renderPanel()}</section>
      </div>
    </div>
  );
}
