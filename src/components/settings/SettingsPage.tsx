'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  Activity,
  Brain,
  Globe2,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';

import Card, { CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Toggle from '@/components/ui/Toggle';
import Skeleton from '@/components/ui/Skeleton';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';

type SettingsPanelKey = 'general' | 'brand-brain' | 'language' | 'health';

type PanelItem = {
  key: SettingsPanelKey;
  Icon: LucideIcon;
  label: string;
  navDescription: string;
};

type Locale = 'ca' | 'es' | 'en';
type BrandTone = 'premium' | 'proper' | 'formal' | 'neutre';

type SettingsApiPayload = {
  ok?: boolean;
  settings?: {
    signature: string | null;
    ai_instructions: string | null;
    keywords_use: string[];
    keywords_avoid: string[];
    ai_engine: string;
    seo_enabled: boolean;
    brand_description: string | null;
    brand_tone: BrandTone | null;
    brand_dos: string[];
    brand_donts: string[];
    brand_examples_good: string[];
    brand_examples_bad: string[];
    default_locale: Locale;
    autopublish_enabled: boolean;
    wizard_completed_at: string | null;
  };
  role?: string | null;
  error?: string;
  message?: string;
};

type SettingsDraft = {
  signature: string;
  aiInstructions: string;
  keywordsUse: string;
  keywordsAvoid: string;
  seoEnabled: boolean;
  brandDescription: string;
  brandTone: BrandTone;
  brandDos: string;
  brandDonts: string;
  brandExamplesGood: string[];
  brandExamplesBad: string[];
  defaultLocale: Locale;
};

const OWNER_MANAGER_TOOLTIP = 'Només Owner/Manager';
const MAX_EXAMPLES = 5;
const MIN_EXAMPLES = 3;

const PANEL_ITEMS: PanelItem[] = [
  {
    key: 'general',
    Icon: SlidersHorizontal,
    label: 'General',
    navDescription: 'To i comportament de la IA',
  },
  {
    key: 'brand-brain',
    Icon: Brain,
    label: 'Brand Brain',
    navDescription: 'Memòria de negoci i context',
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

const EMPTY_DRAFT: SettingsDraft = {
  signature: '',
  aiInstructions: '',
  keywordsUse: '',
  keywordsAvoid: '',
  seoEnabled: false,
  brandDescription: '',
  brandTone: 'neutre',
  brandDos: '',
  brandDonts: '',
  brandExamplesGood: ['', '', ''],
  brandExamplesBad: ['', '', ''],
  defaultLocale: 'ca',
};

function canEditSettings(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

function normalizeExampleList(values: unknown): string[] {
  if (!Array.isArray(values)) return ['', '', ''];

  const normalized = values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, MAX_EXAMPLES);

  while (normalized.length < MIN_EXAMPLES) normalized.push('');
  return normalized;
}

function sanitizeExampleListForPatch(values: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
    if (unique.length >= MAX_EXAMPLES) break;
  }

  return unique;
}

function toDraft(settings?: SettingsApiPayload['settings']): SettingsDraft {
  return {
    signature: settings?.signature || '',
    aiInstructions: settings?.ai_instructions || '',
    keywordsUse: Array.isArray(settings?.keywords_use) ? settings.keywords_use.join(', ') : '',
    keywordsAvoid: Array.isArray(settings?.keywords_avoid) ? settings.keywords_avoid.join(', ') : '',
    seoEnabled: settings?.seo_enabled ?? false,
    brandDescription: settings?.brand_description || '',
    brandTone: settings?.brand_tone || 'neutre',
    brandDos: Array.isArray(settings?.brand_dos) ? settings.brand_dos.join(', ') : '',
    brandDonts: Array.isArray(settings?.brand_donts) ? settings.brand_donts.join(', ') : '',
    brandExamplesGood: normalizeExampleList(settings?.brand_examples_good),
    brandExamplesBad: normalizeExampleList(settings?.brand_examples_bad),
    defaultLocale: settings?.default_locale || 'ca',
  };
}

function serializeDraftForPatch(draft: SettingsDraft, bizId: string): string {
  return JSON.stringify({
    biz_id: bizId,
    signature: draft.signature,
    ai_instructions: draft.aiInstructions,
    keywords_use: draft.keywordsUse,
    keywords_avoid: draft.keywordsAvoid,
    seo_enabled: draft.seoEnabled,
    brand_description: draft.brandDescription,
    brand_tone: draft.brandTone,
    brand_dos: draft.brandDos,
    brand_donts: draft.brandDonts,
    brand_examples_good: sanitizeExampleListForPatch(draft.brandExamplesGood),
    brand_examples_bad: sanitizeExampleListForPatch(draft.brandExamplesBad),
    default_locale: draft.defaultLocale,
  });
}

function runQuickAction(kind: 'shorter' | 'premium' | 'funny', value: string): string {
  const normalized = value.trim();
  if (!normalized) return value;

  if (kind === 'shorter') {
    if (normalized.length <= 180) return normalized;
    const sliced = normalized.slice(0, 180);
    const cutAt = Math.max(sliced.lastIndexOf(' '), 120);
    return `${sliced.slice(0, cutAt).trim()}…`;
  }

  if (kind === 'premium') {
    if (normalized.toLowerCase().startsWith('en nom de l’equip,')) return normalized;
    return `En nom de l’equip, ${normalized}`;
  }

  if (normalized.toLowerCase().startsWith('amb un toc proper i amable,')) return normalized;
  return `Amb un toc proper i amable, ${normalized}`;
}

function QuickActionButtons(props: {
  disabled: boolean;
  onAction: (mode: 'shorter' | 'premium' | 'funny') => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={props.disabled}
        title={props.disabled ? OWNER_MANAGER_TOOLTIP : 'Aplica refinament local de resum'}
        className="border-black/10 bg-white text-zinc-700 hover:bg-zinc-100"
        onClick={() => props.onAction('shorter')}
      >
        Més curt
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={props.disabled}
        title={props.disabled ? OWNER_MANAGER_TOOLTIP : 'Aplica refinament local premium'}
        className="border-black/10 bg-white text-zinc-700 hover:bg-zinc-100"
        onClick={() => props.onAction('premium')}
      >
        Més premium
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={props.disabled}
        title={props.disabled ? OWNER_MANAGER_TOOLTIP : 'Aplica refinament local divertit'}
        className="border-black/10 bg-white text-zinc-700 hover:bg-zinc-100"
        onClick={() => props.onAction('funny')}
      >
        Més divertit
      </Button>
    </div>
  );
}

function GeneralPanel(props: {
  draft: SettingsDraft;
  setDraft: Dispatch<SetStateAction<SettingsDraft>>;
  canEdit: boolean;
  saving: boolean;
}) {
  const { draft, setDraft, canEdit, saving } = props;
  const disabled = !canEdit || saving;

  return (
    <Card className="border border-black/10 bg-white/95">
      <CardHeader>
        <CardTitle className="text-h2 font-serif font-normal text-slate-900">Configuració general</CardTitle>
        <CardDescription className="text-body text-slate-500">Ajusta veu, estils i paràmetres base de LITO.</CardDescription>
      </CardHeader>

      <div className="space-y-4">
        <Input
          label="Signatura"
          hint="Text final que afegim automàticament a les respostes."
          placeholder="hotel"
          value={draft.signature}
          disabled={disabled}
          title={!canEdit ? OWNER_MANAGER_TOOLTIP : undefined}
          onChange={(event) => setDraft((prev) => ({ ...prev, signature: event.target.value }))}
          className="border-black/15 bg-white text-zinc-900 placeholder:text-zinc-400"
        />

        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-900">
            Instruccions per a la IA
          </label>
          <p className="mb-2 text-xs text-zinc-500">Context de marca i estil que ha de seguir LITO.</p>
          <textarea
            value={draft.aiInstructions}
            disabled={disabled}
            title={!canEdit ? OWNER_MANAGER_TOOLTIP : undefined}
            onChange={(event) => setDraft((prev) => ({ ...prev, aiInstructions: event.target.value }))}
            placeholder="Ex: Mai mencionar preus. Sempre convidar a tornar."
            className="min-h-[120px] w-full rounded-[var(--radius-md)] border border-black/15 bg-white px-3.5 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[var(--brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)]/25 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <QuickActionButtons
            disabled={disabled || draft.aiInstructions.trim().length === 0}
            onAction={(mode) => {
              setDraft((prev) => ({
                ...prev,
                aiInstructions: runQuickAction(mode, prev.aiInstructions),
              }));
            }}
          />
        </div>

        <Input
          label="Paraules a USAR (separades per coma)"
          hint="Paraules clau associades a sentiment positiu."
          placeholder="hospitalitat, excel·lència, benvinguda"
          value={draft.keywordsUse}
          disabled={disabled}
          title={!canEdit ? OWNER_MANAGER_TOOLTIP : undefined}
          onChange={(event) => setDraft((prev) => ({ ...prev, keywordsUse: event.target.value }))}
          className="border-black/15 bg-white text-zinc-900 placeholder:text-zinc-400"
        />

        <Input
          label="Paraules a EVITAR (separades per coma)"
          hint="Paraules clau associades a sentiment negatiu."
          placeholder="barat, descarrèc, problema"
          value={draft.keywordsAvoid}
          disabled={disabled}
          title={!canEdit ? OWNER_MANAGER_TOOLTIP : undefined}
          onChange={(event) => setDraft((prev) => ({ ...prev, keywordsAvoid: event.target.value }))}
          className="border-black/15 bg-white text-zinc-900 placeholder:text-zinc-400"
        />

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
                {draft.seoEnabled ? 'Activat' : 'Desactivat'}
              </span>
              <Toggle
                checked={draft.seoEnabled}
                disabled={disabled}
                title={!canEdit ? OWNER_MANAGER_TOOLTIP : undefined}
                onChange={(checked) => setDraft((prev) => ({ ...prev, seoEnabled: checked }))}
                label="SEO"
              />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function BrandExamplesEditor(props: {
  label: string;
  hint: string;
  values: string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}) {
  const { label, hint, values, disabled, onChange } = props;

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-zinc-900">{label}</p>
        <p className="mt-1 text-xs text-zinc-500">{hint}</p>
      </div>

      <div className="space-y-2">
        {values.map((value, index) => (
          <div key={`${label}-${index}`} className="flex items-center gap-2">
            <Input
              value={value}
              disabled={disabled}
              title={!disabled ? undefined : OWNER_MANAGER_TOOLTIP}
              onChange={(event) => {
                const next = [...values];
                next[index] = event.target.value;
                onChange(next);
              }}
              placeholder={`Exemple ${index + 1}`}
              className="border-black/15 bg-white text-zinc-900 placeholder:text-zinc-400"
            />
            {values.length > MIN_EXAMPLES ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={disabled}
                title={!disabled ? 'Eliminar exemple' : OWNER_MANAGER_TOOLTIP}
                className="border-black/10 bg-white text-zinc-700 hover:bg-zinc-100"
                onClick={() => {
                  const next = values.filter((_, idx) => idx !== index);
                  onChange(next.length >= MIN_EXAMPLES ? next : normalizeExampleList(next));
                }}
              >
                Treure
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || values.length >= MAX_EXAMPLES}
        title={!disabled ? 'Afegir exemple' : OWNER_MANAGER_TOOLTIP}
        className="border-black/10 bg-white text-zinc-700 hover:bg-zinc-100"
        onClick={() => onChange([...values, ''])}
      >
        Afegir exemple
      </Button>
    </div>
  );
}

function BrandBrainPanel(props: {
  draft: SettingsDraft;
  setDraft: Dispatch<SetStateAction<SettingsDraft>>;
  canEdit: boolean;
  saving: boolean;
}) {
  const { draft, setDraft, canEdit, saving } = props;
  const disabled = !canEdit || saving;

  return (
    <Card className="border border-black/10 bg-white/95">
      <CardHeader>
        <CardTitle className="text-h2 font-serif font-normal text-slate-900">Brand Brain</CardTitle>
        <CardDescription className="text-body text-slate-500">Això guia LITO a respondre com el teu negoci.</CardDescription>
      </CardHeader>

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-900">Descripció del negoci</label>
          <textarea
            value={draft.brandDescription}
            disabled={disabled}
            title={!canEdit ? OWNER_MANAGER_TOOLTIP : undefined}
            onChange={(event) => setDraft((prev) => ({ ...prev, brandDescription: event.target.value }))}
            placeholder="Qui sou, què us fa diferencials i quin tipus d’experiència voleu transmetre."
            className="min-h-[120px] w-full rounded-[var(--radius-md)] border border-black/15 bg-white px-3.5 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[var(--brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)]/25 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <div>
          <p className="mb-1.5 block text-sm font-medium text-zinc-900">To</p>
          <Select
            options={[
              { value: 'premium', label: 'premium' },
              { value: 'proper', label: 'proper' },
              { value: 'formal', label: 'formal' },
              { value: 'neutre', label: 'neutre' },
            ]}
            value={draft.brandTone}
            disabled={disabled}
            title={!canEdit ? OWNER_MANAGER_TOOLTIP : undefined}
            onChange={(event) => setDraft((prev) => ({ ...prev, brandTone: event.target.value as BrandTone }))}
            className="border-black/15 bg-white text-zinc-900"
          />
        </div>

        <Input
          label="Dos (separats per coma)"
          hint="Paraules i intencions que sí volem mantenir."
          placeholder="proper, acollidor, resolutiu"
          value={draft.brandDos}
          disabled={disabled}
          title={!canEdit ? OWNER_MANAGER_TOOLTIP : undefined}
          onChange={(event) => setDraft((prev) => ({ ...prev, brandDos: event.target.value }))}
          className="border-black/15 bg-white text-zinc-900 placeholder:text-zinc-400"
        />

        <Input
          label="Don’ts (separats per coma)"
          hint="To o paraules que volem evitar."
          placeholder="agressiu, massa informal, tecnicisme"
          value={draft.brandDonts}
          disabled={disabled}
          title={!canEdit ? OWNER_MANAGER_TOOLTIP : undefined}
          onChange={(event) => setDraft((prev) => ({ ...prev, brandDonts: event.target.value }))}
          className="border-black/15 bg-white text-zinc-900 placeholder:text-zinc-400"
        />

        <BrandExamplesEditor
          label="Exemples bons"
          hint="Respostes model que representen bé la teva marca (3-5)."
          values={draft.brandExamplesGood}
          disabled={disabled}
          onChange={(values) => setDraft((prev) => ({ ...prev, brandExamplesGood: values }))}
        />

        <BrandExamplesEditor
          label="Exemples dolents"
          hint="Respostes que NO volem repetir (3-5)."
          values={draft.brandExamplesBad}
          disabled={disabled}
          onChange={(values) => setDraft((prev) => ({ ...prev, brandExamplesBad: values }))}
        />
      </div>
    </Card>
  );
}

function LanguagePanel(props: {
  draft: SettingsDraft;
  setDraft: Dispatch<SetStateAction<SettingsDraft>>;
  canEdit: boolean;
  saving: boolean;
}) {
  const { draft, setDraft, canEdit, saving } = props;
  const disabled = !canEdit || saving;

  return (
    <Card className="border border-black/10 bg-white/95">
      <CardHeader>
        <CardTitle className="text-h2 font-serif font-normal text-slate-900">Idioma</CardTitle>
        <CardDescription className="text-body text-slate-500">Llengua per defecte</CardDescription>
      </CardHeader>

      <div className="max-w-sm">
        <Select
          options={[
            { value: 'ca', label: 'Català (CA)' },
            { value: 'es', label: 'Castellà (ES)' },
            { value: 'en', label: 'English (EN)' },
          ]}
          value={draft.defaultLocale}
          disabled={disabled}
          title={!canEdit ? OWNER_MANAGER_TOOLTIP : undefined}
          onChange={(event) => setDraft((prev) => ({ ...prev, defaultLocale: event.target.value as Locale }))}
          className="border-black/15 bg-white text-zinc-900"
        />
      </div>
    </Card>
  );
}

function HealthPanel(props: {
  settings: SettingsApiPayload['settings'] | null;
}) {
  const autopublishEnabled = props.settings?.autopublish_enabled ?? false;

  return (
    <Card className="border border-black/10 bg-white/95">
      <CardHeader>
        <CardTitle className="text-h2 font-serif font-normal text-slate-900">Health</CardTitle>
        <CardDescription className="text-body text-slate-500">KPI i guardrails</CardDescription>
      </CardHeader>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-black/10 bg-zinc-50 p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Auto-publish</p>
          <p className="mt-2 text-lg font-semibold text-zinc-900">{autopublishEnabled ? 'ON' : 'OFF'}</p>
          <p className="mt-1 text-xs text-zinc-500">Read-only</p>
        </div>

        <div className="rounded-xl border border-black/10 bg-zinc-50 p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">% aprovades</p>
          <p className="mt-2 text-lg font-semibold text-zinc-900">—</p>
          <p className="mt-1 text-xs text-zinc-500">Calculant…</p>
        </div>

        <div className="rounded-xl border border-black/10 bg-zinc-50 p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Pendents</p>
          <p className="mt-2 text-lg font-semibold text-zinc-900">—</p>
          <p className="mt-1 text-xs text-zinc-500">Calculant…</p>
        </div>
      </div>

      <p className="mt-4 text-xs text-zinc-500">Auto-publish està desactivat per defecte.</p>
    </Card>
  );
}

export default function SettingsPage() {
  const { biz } = useWorkspace();
  const { toast } = useToast();

  const [panel, setPanel] = useState<SettingsPanelKey>('general');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsApiPayload['settings'] | null>(null);
  const [draft, setDraft] = useState<SettingsDraft>(EMPTY_DRAFT);

  const mountedRef = useRef(true);
  const lastSavedPayloadRef = useRef<string>('');
  const bizId = biz?.id || null;

  const canEdit = canEditSettings(role);

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

      setSettings(payload.settings);
      setRole(payload.role || null);

      const nextDraft = toDraft(payload.settings);
      setDraft(nextDraft);
      lastSavedPayloadRef.current = serializeDraftForPatch(nextDraft, bizId);
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
    return serializeDraftForPatch(draft, bizId);
  }, [bizId, draft]);

  useEffect(() => {
    if (!bizId || !patchPayload || loading || !canEdit) return undefined;
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

        setSettings(payload.settings);
        setRole(payload.role || null);

        const normalizedDraft = toDraft(payload.settings);
        const normalizedSerialized = serializeDraftForPatch(normalizedDraft, bizId);
        lastSavedPayloadRef.current = normalizedSerialized;
        setDraft(normalizedDraft);
        toast('Desat', 'success');
      } catch {
        toast('No s’ha pogut desar configuració', 'error');
      } finally {
        if (mountedRef.current) setSaving(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [bizId, canEdit, loading, patchPayload, toast]);

  const renderPanel = () => {
    if (loading || !bizId) {
      return (
        <Card className="border border-black/10 bg-white/95">
          <CardHeader>
            <CardTitle className="text-h2 font-serif font-normal text-slate-900">Configuració</CardTitle>
            <CardDescription className="text-body text-slate-500">Carregant preferències…</CardDescription>
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

    if (panel === 'general') {
      return <GeneralPanel draft={draft} setDraft={setDraft} canEdit={canEdit} saving={saving} />;
    }

    if (panel === 'brand-brain') {
      return <BrandBrainPanel draft={draft} setDraft={setDraft} canEdit={canEdit} saving={saving} />;
    }

    if (panel === 'language') {
      return <LanguagePanel draft={draft} setDraft={setDraft} canEdit={canEdit} saving={saving} />;
    }

    return <HealthPanel settings={settings} />;
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-6 md:px-6">
      <div className="mb-6">
        <h1 className="font-serif text-h1 font-normal text-slate-900 md:text-display">Configuració</h1>
        <p className="mt-2 text-body text-slate-500">Gestiona el comportament i les fonts de context de LITO.</p>
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

        <section className="min-w-0">
          {renderPanel()}
          {!loading ? (
            !canEdit ? (
              <p className="mt-3 text-xs text-zinc-500" title={OWNER_MANAGER_TOOLTIP}>
                Només Owner/Manager
              </p>
            ) : (
              <p className="mt-3 text-xs text-zinc-500">{saving ? 'Desant…' : 'Canvis desats automàticament.'}</p>
            )
          ) : null}
        </section>
      </div>
    </div>
  );
}
