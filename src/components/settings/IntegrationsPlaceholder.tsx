'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
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

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.8-5.5 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 4 1.5l2.7-2.6C17 3.3 14.7 2.4 12 2.4 6.9 2.4 2.8 6.5 2.8 11.6S6.9 20.8 12 20.8c6.9 0 9.1-4.8 9.1-7.3 0-.5-.1-.9-.1-1.3H12z" />
      <path fill="#34A853" d="M3.8 7.1l3.2 2.4C7.8 7.7 9.7 6 12 6c1.9 0 3.2.8 4 1.5l2.7-2.6C17 3.3 14.7 2.4 12 2.4 8.5 2.4 5.4 4.4 3.8 7.1z" />
      <path fill="#FBBC05" d="M12 20.8c2.6 0 4.8-.9 6.4-2.5l-3-2.4c-.8.6-1.9 1-3.4 1-2.2 0-4.1-1.5-4.8-3.5L4 15.9c1.6 3 4.7 4.9 8 4.9z" />
      <path fill="#4285F4" d="M21.1 13.5c0-.5-.1-.9-.1-1.3H12v3.9h5.5c-.3 1.2-1 2.2-2 2.9l3 2.4c1.8-1.7 2.6-4.2 2.6-7.9z" />
    </svg>
  );
}

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
  const [googleSectionOpen, setGoogleSectionOpen] = useState(true);
  const [webhookSectionOpen, setWebhookSectionOpen] = useState(false);
  const [importedLocalsOpen, setImportedLocalsOpen] = useState(false);

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
  const importedLocals = useMemo(
    () => (googleBusinesses || []).filter((item) => Boolean(item.integration_id)),
    [googleBusinesses],
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
    if (googleStatus === 'connected') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
    if (googleStatus === 'needs_reauth') return 'border-amber-300 bg-amber-50 text-amber-700';
    return 'border-zinc-300 bg-zinc-100 text-zinc-700';
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

  useEffect(() => {
    if (importedLocals.length === 0) setImportedLocalsOpen(false);
  }, [importedLocals.length]);

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
      <div className="lito-light-scope max-w-3xl space-y-3">
        <div className="rounded-2xl border border-black/10 bg-white p-3 shadow-sm md:p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-900">Google Business Profile</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-xs', googleStatusClass)}>
                  {googleBusinessesLoading ? 'Carregant...' : googleStatusLabel}
                </span>
                <span className="text-xs text-zinc-500">{selectedBusiness?.name || t('common.unknown')}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void handleConnectGoogle()}
                loading={googleConnectingBizId === selectedBizId}
                disabled={googleBusinessesLoading || !selectedBizId}
                data-testid="google-business-connect"
                className="inline-flex items-center gap-2"
              >
                <GoogleMark />
                {googleStatus === 'needs_reauth' ? 'Reconnectar Google' : 'Connectar Google'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadGoogleBusinesses()}
                disabled={googleBusinessesLoading}
                data-testid="google-business-refresh-status"
                className="border-black/10 bg-white text-zinc-800 hover:bg-zinc-100"
              >
                Refrescar
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={openLocationsModal}
                disabled={addLocationDisabled}
                data-testid="google-business-add-location"
                className="border-black/10 bg-white text-zinc-800 hover:bg-zinc-100"
              >
                Importar locals
              </Button>
            </div>
          </div>
        </div>

        <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setGoogleSectionOpen((prev) => !prev)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <div>
              <p className="text-sm font-semibold text-zinc-900">Google Business Profile</p>
              <p className="text-xs text-zinc-500">Connexió, estat i gestió de locals importats.</p>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-zinc-500 transition-transform', googleSectionOpen && 'rotate-180')} />
          </button>

          {googleSectionOpen ? (
            <div className="divide-y divide-black/10">
              {businessOptions.length > 1 ? (
                <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,220px)_1fr] md:items-center">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">Negoci actiu</p>
                    <p className="text-sm text-zinc-500">Selecciona quin negoci vols revisar.</p>
                  </div>
                  <Select
                    options={businessOptions}
                    value={selectedBizId || ''}
                    onChange={(event) => setSelectedBizId(event.target.value)}
                    className="border-black/10 bg-white text-zinc-900"
                  />
                </div>
              ) : null}

              <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,220px)_1fr] md:items-center">
                <div>
                  <p className="text-sm font-medium text-zinc-900">{t('settings.integrations.googleStatusLabel')}</p>
                  <p className="text-sm text-zinc-500">Estat actual de connexió per al negoci seleccionat.</p>
                </div>
                <span className={cn('inline-flex w-fit rounded-full border px-2.5 py-1 text-xs', googleStatusClass)}>
                  {googleBusinessesLoading ? 'Carregant...' : googleStatusLabel}
                </span>
              </div>

              <div className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => setImportedLocalsOpen((prev) => !prev)}
                  disabled={importedLocals.length === 0}
                  className="flex w-full items-center justify-between rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-left disabled:cursor-default disabled:opacity-60"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-zinc-900">Locals importats</p>
                    <span className="rounded-full border border-black/10 bg-white px-2 py-0.5 text-[11px] text-zinc-600">
                      {importedLocals.length}
                    </span>
                  </div>
                  <ChevronDown className={cn('h-4 w-4 text-zinc-500 transition-transform', importedLocalsOpen && 'rotate-180')} />
                </button>

                {importedLocals.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">Encara no hi ha locals importats.</p>
                ) : null}

                {importedLocalsOpen ? (
                  <div className="mt-2 space-y-2" data-testid="google-businesses-list">
                    {importedLocals.map((item) => (
                      <div
                        key={item.biz_id}
                        className="flex flex-col gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <p className="text-sm text-zinc-900">{item.biz_name}</p>
                          <p className="text-xs text-zinc-500">{item.city || item.slug || '—'}</p>
                        </div>
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
                          {item.state === 'needs_reauth' ? 'Reconnectar' : 'Obrir connexió'}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {googleBusinesses.some((item) => item.state === 'needs_reauth') ? (
                <div className="px-4 py-3 text-sm text-amber-700">
                  {t('settings.integrations.googleReauthWarning')}
                </div>
              ) : null}

              {googleFeedback ? (
                <div className="px-4 py-3 text-sm text-zinc-600">
                  {googleFeedback}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setWebhookSectionOpen((prev) => !prev)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-zinc-900">Webhook (Make/Zapier)</p>
              <span className="rounded-full border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">Avançat</span>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-zinc-500 transition-transform', webhookSectionOpen && 'rotate-180')} />
          </button>

          {webhookSectionOpen ? (
            <div className="divide-y divide-black/10">
              {businessOptions.length > 1 ? (
                <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,220px)_1fr] md:items-center">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">Negoci del webhook</p>
                    <p className="text-sm text-zinc-500">Selecciona el negoci on aplicarem la configuració.</p>
                  </div>
                  <Select
                    options={businessOptions}
                    value={selectedBizId || ''}
                    onChange={(event) => setSelectedBizId(event.target.value)}
                    className="border-black/10 bg-white text-zinc-900"
                  />
                </div>
              ) : null}

              <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,220px)_1fr] md:items-center">
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

              <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,220px)_1fr] md:items-center">
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

              <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,220px)_1fr] md:items-center">
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

              <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,220px)_1fr]" data-testid="webhook-channels">
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

              <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,220px)_1fr] md:items-center">
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
                <div className="px-4 py-3 text-sm text-zinc-700" data-testid="webhook-test-status">
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
