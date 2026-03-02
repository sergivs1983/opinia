'use client';

import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/components/i18n/I18nContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { cn } from '@/lib/utils';
import { glass, glassNoise, glassStrong, glassSweep, ringAccent } from '@/components/ui/glass';

type ConnectorInfo = {
  id: string;
  type: 'webhook';
  enabled: boolean;
  url: string | null;
  allowed_channels: Array<'ig_feed' | 'ig_story' | 'ig_reel'>;
  secret_present: boolean;
  created_at?: string;
  updated_at?: string;
};

type ConnectorsListResponse = {
  connectors?: ConnectorInfo[];
  request_id?: string;
  error?: string;
  message?: string;
};

type ConnectorUpsertResponse = {
  connector?: ConnectorInfo;
  request_id?: string;
  error?: string;
  message?: string;
};

type WebhookTestResponse = {
  ok?: boolean;
  status?: 'sent' | 'failed' | 'skipped';
  response_code?: number | null;
  error?: string;
  request_id?: string;
  message?: string;
};

type GoogleConnectResponse = {
  url?: string;
  request_id?: string;
  error?: string;
  message?: string;
};

type GoogleBusinessesResponse = {
  locals?: GoogleBusinessItem[];
  request_id?: string;
  error?: string;
  message?: string;
};

type GoogleBusinessItem = {
  biz_id: string;
  biz_name: string;
  slug: string | null;
  city: string | null;
  google_location_name?: string | null;
  integration_id: string | null;
  is_active: boolean;
  updated_at: string | null;
  state: GoogleIntegrationUiStatus;
};

type GoogleLocationItem = {
  account_id: string | null;
  location_name: string;
  title: string;
  address: string | null;
  city: string | null;
  country: string | null;
  profile_photo_url?: string | null;
};

type GoogleLocationsResponse = {
  provider?: 'google_business';
  state?: 'connected' | 'needs_reauth' | 'not_connected';
  locations?: GoogleLocationItem[];
  request_id?: string;
  error?: string;
  message?: string;
};

type ImportLocationResponse = {
  created?: number;
  skipped_existing?: number;
  errors?: Array<{
    location_name: string;
    reason: string;
  }>;
  limit?: number;
  current?: number;
  request_id?: string;
  error?: string;
  message?: string;
};

const CHANNEL_OPTIONS: Array<{ value: 'ig_feed' | 'ig_story' | 'ig_reel'; label: string }> = [
  { value: 'ig_feed', label: 'IG Feed' },
  { value: 'ig_story', label: 'IG Story' },
  { value: 'ig_reel', label: 'IG Reel' },
];

type GoogleIntegrationUiStatus = 'connected' | 'needs_reauth' | 'not_connected';

export default function IntegrationsPlaceholder() {
  const t = useT();
  const { biz, businesses, reload } = useWorkspace();
  const [selectedBizId, setSelectedBizId] = useState<string | null>(biz?.id || null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [channels, setChannels] = useState<Array<'ig_feed' | 'ig_story' | 'ig_reel'>>([]);
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [secretPresent, setSecretPresent] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);
  const [webhookStatusRequestId, setWebhookStatusRequestId] = useState<string | null>(null);
  const [copiedRequestId, setCopiedRequestId] = useState(false);

  const [googleConnectingBizId, setGoogleConnectingBizId] = useState<string | null>(null);
  const [googleFeedback, setGoogleFeedback] = useState<string | null>(null);
  const [googleBusinessesLoading, setGoogleBusinessesLoading] = useState(false);
  const [googleBusinesses, setGoogleBusinesses] = useState<GoogleBusinessItem[]>([]);

  const [locationsModalOpen, setLocationsModalOpen] = useState(false);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsState, setLocationsState] = useState<'connected' | 'needs_reauth' | 'not_connected'>('not_connected');
  const [googleLocations, setGoogleLocations] = useState<GoogleLocationItem[]>([]);
  const [selectedLocationNames, setSelectedLocationNames] = useState<string[]>([]);
  const [selectedSeedBizId, setSelectedSeedBizId] = useState<string>('');
  const [importingLocation, setImportingLocation] = useState(false);
  const [locationsFeedback, setLocationsFeedback] = useState<string | null>(null);

  const selectedBusiness = useMemo(
    () => businesses.find((item) => item.id === selectedBizId) || null,
    [businesses, selectedBizId],
  );
  const selectedBusinessIntegration = useMemo(
    () => (googleBusinesses || []).find((item) => item.biz_id === selectedBizId) || null,
    [googleBusinesses, selectedBizId],
  );
  const selectedSeedBusiness = useMemo(
    () => (googleBusinesses || []).find((item) => item.biz_id === selectedSeedBizId) || null,
    [googleBusinesses, selectedSeedBizId],
  );
  const seedOptions = useMemo(
    () =>
      (googleBusinesses || [])
        .filter((item) => item.integration_id)
        .map((item) => ({
          value: item.biz_id,
          label: `${item.biz_name}${item.city ? ` · ${item.city}` : ''}`,
        })),
    [googleBusinesses],
  );
  const businessOptions = useMemo(
    () => businesses.map((item) => ({ value: item.id, label: item.name })),
    [businesses],
  );
  const hasSelectedBiz = Boolean(selectedBizId);
  const hasSeedOptions = seedOptions.length > 0;
  const addLocationDisabled = !hasSelectedBiz;
  const addLocationDisabledReason = useMemo(() => {
    if (!hasSelectedBiz) return 'missing_selected_biz';
    if (!hasSeedOptions) return 'fallback_selected_biz_without_seed';
    return 'enabled';
  }, [hasSeedOptions, hasSelectedBiz]);
  const selectedChannels = useMemo(() => new Set(channels), [channels]);
  const googleStatus = selectedBusinessIntegration?.state || 'not_connected';
  const googleStatusLabel = useMemo(() => {
    if (googleStatus === 'connected') return t('settings.integrations.googleStatusConnected');
    if (googleStatus === 'needs_reauth') return t('settings.integrations.googleStatusNeedsReauth');
    return t('settings.integrations.googleStatusNotConnected');
  }, [googleStatus, t]);
  const googleStatusClass = useMemo(() => {
    if (googleStatus === 'connected') return 'border-emerald-400/35 bg-emerald-400/12 text-emerald-100';
    if (googleStatus === 'needs_reauth') return 'border-amber-300/40 bg-amber-300/12 text-amber-100';
    return 'border-white/20 bg-white/8 text-white/82';
  }, [googleStatus]);

  useEffect(() => {
    if (!biz?.id) return;
    setSelectedBizId((current) => current || biz.id);
  }, [biz?.id]);

  useEffect(() => {
    if (!selectedBizId) return;
    if (!businesses.some((item) => item.id === selectedBizId)) {
      const fallbackBizId = biz?.id || businesses[0]?.id || null;
      setSelectedBizId(fallbackBizId);
    }
  }, [selectedBizId, businesses, biz?.id]);

  useEffect(() => {
    if (!selectedBizId) return;
    void loadConfig(selectedBizId);
  }, [selectedBizId]);

  useEffect(() => {
    void loadGoogleBusinesses();
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    console.info('[settings.integrations.google] add-location availability', {
      selectedBizId,
      hasSelectedBiz,
      seedOptionsCount: seedOptions.length,
      hasSeedOptions,
      googleBusinessesLoading,
      disabled: addLocationDisabled,
      reason: addLocationDisabledReason,
    });
  }, [
    addLocationDisabled,
    addLocationDisabledReason,
    googleBusinessesLoading,
    hasSeedOptions,
    hasSelectedBiz,
    seedOptions.length,
    selectedBizId,
  ]);

  async function loadConfig(businessId: string) {
    setLoading(true);
    setWebhookStatus(null);
    setWebhookStatusRequestId(null);

    try {
      const response = await fetch('/api/integrations/connectors', {
        headers: { 'x-biz-id': businessId },
      });
      const payload = (await response.json().catch(() => ({}))) as ConnectorsListResponse;
      if (!response.ok || payload.error) {
        setLoading(false);
        setEnabled(false);
        setUrl('');
        setChannels([]);
        setConnectorId(null);
        setSecretPresent(false);
        return;
      }

      const connector = Array.isArray(payload.connectors) ? payload.connectors[0] : undefined;
      if (connector) {
        setConnectorId(connector.id);
        setEnabled(!!connector.enabled);
        setUrl(connector.url || '');
        setChannels(Array.isArray(connector.allowed_channels) ? connector.allowed_channels : []);
        setSecretPresent(!!connector.secret_present);
      } else {
        setConnectorId(null);
        setEnabled(false);
        setUrl('');
        setChannels([]);
        setSecretPresent(false);
      }
      setLoading(false);
    } catch {
      setLoading(false);
      setEnabled(false);
      setUrl('');
      setChannels([]);
      setConnectorId(null);
      setSecretPresent(false);
    }
  }

  async function loadGoogleBusinesses() {
    setGoogleBusinessesLoading(true);
    setGoogleFeedback(null);
    try {
      const response = await fetch('/api/integrations/google/list');
      const payload = (await response.json().catch(() => ({}))) as GoogleBusinessesResponse;
      if (!response.ok || payload.error) {
        setGoogleBusinesses([]);
        setSelectedSeedBizId('');
        setGoogleFeedback(payload.message || t('settings.integrations.googleBusinessesLoadError'));
        setGoogleBusinessesLoading(false);
        return;
      }
      const locals = Array.isArray(payload.locals) ? payload.locals : [];
      setGoogleBusinesses(locals);
      if (!selectedSeedBizId) {
        const firstSeed = locals.find((item) => item.integration_id)?.biz_id || '';
        setSelectedSeedBizId(firstSeed);
      } else if (!locals.some((item) => item.biz_id === selectedSeedBizId && item.integration_id)) {
        const firstSeed = locals.find((item) => item.integration_id)?.biz_id || '';
        setSelectedSeedBizId(firstSeed);
      }
      setGoogleBusinessesLoading(false);
    } catch {
      setGoogleBusinesses([]);
      setSelectedSeedBizId('');
      setGoogleFeedback(t('settings.integrations.googleBusinessesLoadError'));
      setGoogleBusinessesLoading(false);
    }
  }

  async function loadGoogleLocations(seedBizId: string) {
    setLocationsLoading(true);
    setLocationsFeedback(null);
    setGoogleLocations([]);
    setSelectedLocationNames([]);
    try {
      const response = await fetch(`/api/integrations/google/locations?seed_biz_id=${encodeURIComponent(seedBizId)}`);
      if (response.status === 404) {
        setLocationsState('not_connected');
        setLocationsFeedback(t('settings.integrations.googleLocationsUnavailable'));
        setLocationsLoading(false);
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as GoogleLocationsResponse;
      if (!response.ok || payload.error) {
        setLocationsState('not_connected');
        setLocationsFeedback(payload.message || t('settings.integrations.googleLocationsLoadError'));
        setLocationsLoading(false);
        return;
      }

      const state =
        payload.state === 'connected' || payload.state === 'needs_reauth' || payload.state === 'not_connected'
          ? payload.state
          : 'not_connected';
      setLocationsState(state);

      const list = Array.isArray(payload.locations) ? payload.locations : [];
      setGoogleLocations(list);
      setSelectedLocationNames(list.length > 0 ? [list[0].location_name] : []);
      setLocationsLoading(false);
    } catch {
      setLocationsState('not_connected');
      setLocationsFeedback(t('settings.integrations.googleLocationsLoadError'));
      setLocationsLoading(false);
    }
  }

  function openLocationsModal() {
    const seedBizId =
      (selectedBusinessIntegration?.integration_id ? selectedBusinessIntegration.biz_id : '')
      || selectedSeedBizId
      || selectedBizId
      || seedOptions[0]?.value
      || '';
    if (!seedBizId) return;
    setSelectedSeedBizId(seedBizId);
    setLocationsModalOpen(true);
    void loadGoogleLocations(seedBizId);
  }

  function closeLocationsModal() {
    setLocationsModalOpen(false);
    setLocationsFeedback(null);
    setGoogleLocations([]);
    setSelectedLocationNames([]);
  }

  function toggleLocation(locationName: string) {
    setSelectedLocationNames((current) =>
      current.includes(locationName)
        ? current.filter((id) => id !== locationName)
        : [...current, locationName],
    );
  }

  function toggleChannel(channel: 'ig_feed' | 'ig_story' | 'ig_reel') {
    setChannels((prev) => {
      if (prev.includes(channel)) return prev.filter((entry) => entry !== channel);
      return [...prev, channel];
    });
  }

  async function handleSave() {
    if (!selectedBizId) return;
    setSaving(true);
    setWebhookStatus(null);
    setWebhookStatusRequestId(null);
    setCopiedRequestId(false);

    try {
      const response = await fetch('/api/integrations/connectors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': selectedBizId,
        },
        body: JSON.stringify({
          type: 'webhook',
          enabled,
          url: url.trim() || null,
          allowed_channels: channels,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as ConnectorUpsertResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');
      setWebhookStatusRequestId(requestId || null);

      if (!response.ok || payload.error || !payload.connector) {
        const message = payload.message || 'Failed to save webhook config';
        setWebhookStatus(message);
        setSaving(false);
        return;
      }

      setConnectorId(payload.connector.id);
      setEnabled(!!payload.connector.enabled);
      setUrl(payload.connector.url || '');
      setChannels(Array.isArray(payload.connector.allowed_channels) ? payload.connector.allowed_channels : []);
      setSecretPresent(!!payload.connector.secret_present);
      await reload();
      setWebhookStatus(t('common.saved'));
      setSaving(false);
    } catch (error: unknown) {
      setWebhookStatus(error instanceof Error ? error.message : 'Failed to save webhook config');
      setSaving(false);
    }
  }

  async function handleTestWebhook() {
    if (!selectedBizId || !connectorId) return;
    setTesting(true);
    setWebhookStatus(null);
    setWebhookStatusRequestId(null);
    setCopiedRequestId(false);

    try {
      const response = await fetch('/api/integrations/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': selectedBizId,
        },
        body: JSON.stringify({
          connectorId,
          event: 'planner.ready',
          channel: channels[0] || 'ig_feed',
          demo: true,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as WebhookTestResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');
      setWebhookStatusRequestId(requestId || null);
      const base = payload.ok ? 'Webhook sent' : `Webhook ${payload.status || 'failed'}`;
      const extra = payload.error ? ` — ${payload.error}` : '';
      setWebhookStatus(`${base}${extra}`);
      setTesting(false);
    } catch (error: unknown) {
      setWebhookStatus(error instanceof Error ? error.message : 'Webhook test failed');
      setTesting(false);
    }
  }

  async function handleRegenerateSecret() {
    if (!selectedBizId) return;
    setSaving(true);
    setWebhookStatus(null);
    setWebhookStatusRequestId(null);
    setCopiedRequestId(false);

    try {
      const response = await fetch('/api/integrations/connectors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': selectedBizId,
        },
        body: JSON.stringify({
          type: 'webhook',
          enabled,
          url: url.trim() || null,
          allowed_channels: channels,
          regenerateSecret: true,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as ConnectorUpsertResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');
      setWebhookStatusRequestId(requestId || null);

      if (!response.ok || payload.error || !payload.connector) {
        setWebhookStatus(payload.message || 'Failed to regenerate secret');
        setSaving(false);
        return;
      }

      setConnectorId(payload.connector.id);
      setSecretPresent(!!payload.connector.secret_present);
      setWebhookStatus(t('settings.integrations.secretRegenerated'));
      setSaving(false);
    } catch (error: unknown) {
      setWebhookStatus(error instanceof Error ? error.message : 'Failed to regenerate secret');
      setSaving(false);
    }
  }

  async function handleConnectGoogle(targetBizId?: string) {
    const businessId = targetBizId || selectedBizId;
    if (!businessId) return;
    setGoogleConnectingBizId(businessId);
    setGoogleFeedback(null);

    try {
      const response = await fetch('/api/integrations/google/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ biz_id: businessId }),
      });

      if (response.status === 404) {
        setGoogleFeedback(t('settings.integrations.googleStatusNotConnected'));
        setGoogleConnectingBizId(null);
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as GoogleConnectResponse;
      if (!response.ok || payload.error) {
        setGoogleFeedback(payload.message || t('settings.integrations.googleConnectError'));
        setGoogleConnectingBizId(null);
        return;
      }

      if (!payload.url) {
        setGoogleFeedback(t('settings.integrations.googleConnectError'));
        setGoogleConnectingBizId(null);
        return;
      }

      window.location.assign(payload.url);
    } catch {
      setGoogleFeedback(t('settings.integrations.googleConnectError'));
      setGoogleConnectingBizId(null);
    }
  }

  async function handleImportLocation() {
    if (selectedLocationNames.length === 0 || !selectedSeedBizId) return;
    setImportingLocation(true);
    setLocationsFeedback(null);
    try {
      const selectedLocations = googleLocations.filter((location) => selectedLocationNames.includes(location.location_name));
      const response = await fetch('/api/integrations/google/import-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed_biz_id: selectedSeedBizId,
          mode: 'select',
          locations: selectedLocations,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as ImportLocationResponse;
      if (!response.ok || payload.error) {
        if (payload.error === 'plan_limit') {
          setLocationsFeedback(
            t('settings.integrations.googlePlanLimit', {
              limit: String(payload.limit || ''),
              current: String(payload.current || ''),
            }),
          );
        } else {
          setLocationsFeedback(payload.message || t('settings.integrations.googleImportError'));
        }
        setImportingLocation(false);
        return;
      }

      const importedCount = Number(payload.created || 0);
      if (importedCount > 0) {
        setLocationsFeedback(
          t('settings.integrations.googleImportSuccessCount', { count: String(importedCount) }),
        );
      } else {
        setLocationsFeedback(t('settings.integrations.googleImportExists'));
      }
      await reload();
      await loadGoogleBusinesses();
      closeLocationsModal();
      setImportingLocation(false);
    } catch {
      setLocationsFeedback(t('settings.integrations.googleImportError'));
      setImportingLocation(false);
    }
  }

  async function copyRequestId() {
    if (!webhookStatusRequestId) return;
    await navigator.clipboard.writeText(webhookStatusRequestId);
    setCopiedRequestId(true);
    window.setTimeout(() => setCopiedRequestId(false), 1200);
  }

  return (
    <>
      <div className="lito-light-scope overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
        <section className="divide-y divide-black/10">
          <div className="px-5 py-4">
            <h3 className="text-base font-semibold text-zinc-900">{t('settings.integrations.publishSectionTitle')}</h3>
            <p className="mt-1 text-sm text-zinc-500">{t('settings.integrations.webhookDesc')}</p>
          </div>

          {businessOptions.length > 1 ? (
            <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
              <div>
                <p className="text-sm font-medium text-zinc-900">{t('settings.integrations.businessSelector')}</p>
                <p className="text-sm text-zinc-500">Selecciona el negoci a configurar.</p>
              </div>
              <Select
                options={businessOptions}
                value={selectedBizId || ''}
                onChange={(event) => setSelectedBizId(event.target.value)}
                className="border-black/10 bg-white text-zinc-900"
              />
            </div>
          ) : null}

          <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
            <div>
              <p className="text-sm font-medium text-zinc-900">{t('settings.integrations.webhookEnable')}</p>
              <p className="text-sm text-zinc-500">{t('settings.integrations.webhookEnableHint')}</p>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-black/10 bg-zinc-50 px-3 py-2">
              <span className="text-sm text-zinc-700">{enabled ? 'Activat' : 'Desactivat'}</span>
              <button
                type="button"
                onClick={() => setEnabled((prev) => !prev)}
                disabled={loading}
                aria-pressed={enabled}
                data-testid="webhook-enabled"
                className={cn(
                  'relative h-6 w-12 rounded-full transition-colors duration-[220ms] ease-premium disabled:opacity-50',
                  enabled ? 'bg-brand-accent' : 'bg-zinc-300',
                  ringAccent,
                )}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>

          <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
            <div>
              <p className="text-sm font-medium text-zinc-900">{t('settings.integrations.webhookUrl')}</p>
              <p className="text-sm text-zinc-500">URL del connector (Make, Zapier o equivalent).</p>
            </div>
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://hook.make.com/... o https://hooks.zapier.com/..."
              type="password"
              autoComplete="off"
              data-testid="webhook-url"
              disabled={loading}
              className="border-black/10 bg-white text-zinc-900 placeholder:text-zinc-400"
            />
          </div>

          <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
            <div>
              <p className="text-sm font-medium text-zinc-900">Secret del webhook</p>
              <p className="text-sm text-zinc-500">
                {secretPresent ? t('settings.integrations.secretConfigured') : t('settings.integrations.secretMissing')}
              </p>
            </div>
            <div>
              <Button variant="secondary" onClick={() => void handleRegenerateSecret()} loading={saving} className="border-black/10 bg-white text-zinc-800 hover:bg-zinc-100">
                {t('settings.integrations.regenerateSecret')}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr]" data-testid="webhook-channels">
            <div>
              <p className="text-sm font-medium text-zinc-900">{t('settings.integrations.webhookChannels')}</p>
              <p className="text-sm text-zinc-500">Canals habilitats per a notificacions sortints.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {CHANNEL_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs transition ${
                    selectedChannels.has(option.value)
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-black/10 bg-white text-zinc-700 hover:bg-zinc-50'
                  }`}
                  data-testid={`webhook-channel-${option.value}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedChannels.has(option.value)}
                    onChange={() => toggleChannel(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
            <div>
              <p className="text-sm font-medium text-zinc-900">Accions</p>
              <p className="text-sm text-zinc-500">Desa la configuració o envia una prova.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void handleSave()} loading={saving} data-testid="webhook-save">
                {t('common.save')}
              </Button>
              <Button variant="secondary" onClick={() => void handleTestWebhook()} loading={testing} data-testid="webhook-test" disabled={!connectorId} className="border-black/10 bg-white text-zinc-800 hover:bg-zinc-100">
                {t('settings.integrations.testWebhook')}
              </Button>
            </div>
          </div>

          {webhookStatus ? (
            <div className="px-5 py-4 text-sm text-zinc-700" data-testid="webhook-test-status">
              <p>{webhookStatus}</p>
              {webhookStatusRequestId ? (
                <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                  <span>ID: {webhookStatusRequestId}</span>
                  <button
                    type="button"
                    onClick={() => void copyRequestId()}
                    className="rounded border border-black/10 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
                  >
                    {copiedRequestId ? t('dashboard.studio.copied') : t('settings.integrations.copyId')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="divide-y divide-black/10 border-t border-black/10">
          <div className="px-5 py-4">
            <h3 className="text-base font-semibold text-zinc-900">{t('settings.integrations.reputationSectionTitle')}</h3>
            <p className="mt-1 text-sm text-zinc-500">{t('settings.integrations.reputationSectionDesc')}</p>
          </div>

          {businessOptions.length > 1 ? (
            <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
              <div>
                <p className="text-sm font-medium text-zinc-900">{t('settings.integrations.businessSelector')}</p>
                <p className="text-sm text-zinc-500">Negoci sobre el qual consultem l&apos;estat de Google.</p>
              </div>
              <Select
                options={businessOptions}
                value={selectedBizId || ''}
                onChange={(event) => setSelectedBizId(event.target.value)}
                className="border-black/10 bg-white text-zinc-900"
              />
            </div>
          ) : null}

          <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
            <div>
              <p className="text-sm font-medium text-zinc-900">{t('settings.integrations.googleStatusLabel')}</p>
              <p className="text-sm text-zinc-500">{selectedBusiness?.name || t('common.unknown')}</p>
            </div>
            <span className={cn('inline-flex w-fit rounded-full border px-2.5 py-1 text-xs', googleStatusClass)}>
              {googleBusinessesLoading ? t('common.loading') : googleStatusLabel}
            </span>
          </div>

          <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
            <div>
              <p className="text-sm font-medium text-zinc-900">Accions de connexió</p>
              <p className="text-sm text-zinc-500">Connecta, refresca estat o importa ubicacions.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void handleConnectGoogle()}
                loading={googleConnectingBizId === selectedBizId}
                disabled={googleBusinessesLoading || !selectedBizId}
                data-testid="google-business-connect"
              >
                {googleStatus === 'needs_reauth'
                  ? t('settings.integrations.googleReconnect')
                  : t('settings.integrations.googleConnect')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void loadGoogleBusinesses()}
                disabled={googleBusinessesLoading}
                data-testid="google-business-refresh-status"
                className="border-black/10 bg-white text-zinc-800 hover:bg-zinc-100"
              >
                {t('settings.integrations.googleRefreshStatus')}
              </Button>
              <Button
                variant="secondary"
                onClick={openLocationsModal}
                disabled={addLocationDisabled}
                data-testid="google-business-add-location"
                className="border-black/10 bg-white text-zinc-800 hover:bg-zinc-100"
              >
                {t('settings.integrations.googleAddLocation')}
              </Button>
            </div>
          </div>

          <div className="px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t('settings.integrations.googleLocationsListTitle')}</p>
            <div className="space-y-2" data-testid="google-businesses-list">
              {(googleBusinesses || []).map((item) => (
                <div
                  key={item.biz_id}
                  className="flex flex-col gap-2 rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="text-sm text-zinc-900">{item.biz_name}</p>
                    <p className="text-xs text-zinc-500">
                      {item.city || item.slug || '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex rounded-full border px-2 py-0.5 text-xs',
                        item.state === 'connected'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : item.state === 'needs_reauth'
                            ? 'border-amber-300 bg-amber-50 text-amber-700'
                            : 'border-zinc-300 bg-white text-zinc-600',
                      )}
                    >
                      {item.state === 'connected'
                        ? t('settings.integrations.googleStatusConnected')
                        : item.state === 'needs_reauth'
                          ? t('settings.integrations.googleStatusNeedsReauth')
                          : t('settings.integrations.googleStatusNotConnected')}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelectedBizId(item.biz_id);
                        void handleConnectGoogle(item.biz_id);
                      }}
                      loading={googleConnectingBizId === item.biz_id}
                      className="border-black/10 bg-white text-zinc-800 hover:bg-zinc-100"
                    >
                      {item.state === 'needs_reauth'
                        ? t('settings.integrations.googleReconnect')
                        : t('settings.integrations.googleConnect')}
                    </Button>
                  </div>
                </div>
              ))}
              {!googleBusinessesLoading && (!googleBusinesses || googleBusinesses.length === 0) ? (
                <p className="text-sm text-zinc-500">{t('settings.integrations.googleBusinessesEmpty')}</p>
              ) : null}
            </div>
          </div>

          {googleBusinesses.some((item) => item.state === 'needs_reauth') ? (
            <div className="px-5 py-3 text-sm text-amber-700">
              {t('settings.integrations.googleReauthWarning')}
            </div>
          ) : null}

          {googleFeedback ? (
            <div className="px-5 py-3 text-sm text-zinc-600">
              {googleFeedback}
            </div>
          ) : null}
        </section>
      </div>

      {locationsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
            onClick={closeLocationsModal}
            aria-label={t('common.close')}
          />
          <div className={cn(glassStrong, glassNoise, glassSweep, 'relative w-full max-w-2xl p-5 md:p-6 space-y-4')}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-base font-semibold text-white/90">{t('settings.integrations.googleAddLocation')}</h4>
                <p className="text-xs text-white/68">{t('settings.integrations.googleAddLocationDesc')}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={closeLocationsModal}>
                {t('common.close')}
              </Button>
            </div>

            {seedOptions.length > 0 ? (
              <Select
                label={t('settings.integrations.googleSeedSelector')}
                options={seedOptions}
                value={selectedSeedBizId}
                onChange={(event) => {
                  const nextSeedBizId = event.target.value;
                  setSelectedSeedBizId(nextSeedBizId);
                  if (nextSeedBizId) void loadGoogleLocations(nextSeedBizId);
                }}
              />
            ) : (
              <div className={cn(glass, 'px-3 py-2 text-xs text-white/72')}>
                {t('settings.integrations.googleNeedConnection')}
              </div>
            )}

            {locationsLoading && (
              <div className={cn(glass, 'px-3 py-2 text-sm text-white/70')}>
                {t('common.loading')}
              </div>
            )}

            {!locationsLoading && locationsState !== 'connected' && (
              <div className={cn(glass, 'px-3 py-3 space-y-3')}>
                <p className="text-sm text-white/75">
                  {locationsState === 'needs_reauth'
                    ? t('settings.integrations.googleSeedExpired')
                    : t('settings.integrations.googleNeedConnection')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void handleConnectGoogle(selectedSeedBusiness?.biz_id)}
                    loading={googleConnectingBizId === selectedSeedBusiness?.biz_id}
                  >
                    {t('settings.integrations.googleConnect')}
                  </Button>
                  <Button variant="secondary" onClick={closeLocationsModal}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}

            {!locationsLoading && locationsState === 'connected' && (
              <div className="space-y-3">
                <div className={cn(glass, 'max-h-72 overflow-auto p-2')}>
                  <div className="space-y-2">
                    {googleLocations.map((location) => (
                      <label
                        key={location.location_name}
                        className={cn(
                          'block rounded-lg border px-3 py-2 cursor-pointer transition-all duration-[220ms] ease-premium',
                          selectedLocationNames.includes(location.location_name)
                            ? 'border-brand-accent/40 bg-white/10'
                            : 'border-white/10 bg-white/5 hover:bg-white/8',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={selectedLocationNames.includes(location.location_name)}
                          onChange={() => toggleLocation(location.location_name)}
                        />
                        <p className="text-sm text-white/90">{location.title}</p>
                        <p className="text-xs text-white/65">
                          {location.city || '—'} · {location.country || '—'} · {location.location_name}
                        </p>
                      </label>
                    ))}
                    {googleLocations.length === 0 && (
                      <p className="text-xs text-white/65 px-2 py-1">{t('settings.integrations.googleLocationsEmpty')}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void handleImportLocation()}
                    loading={importingLocation}
                    disabled={selectedLocationNames.length === 0 || !selectedSeedBizId}
                    data-testid="google-business-import-location"
                  >
                    {t('settings.integrations.googleImportLocation')}
                  </Button>
                  <Button variant="secondary" onClick={closeLocationsModal}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}

            {locationsFeedback && (
              <div className={cn(glass, glassNoise, 'text-xs text-white/75 px-2.5 py-2')}>
                {locationsFeedback}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
