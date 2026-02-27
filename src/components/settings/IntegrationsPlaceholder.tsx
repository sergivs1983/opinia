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
  integration_id: string | null;
  is_active: boolean;
  updated_at: string | null;
  state: GoogleIntegrationUiStatus;
};

type GoogleLocationItem = {
  location_id: string;
  name: string;
  storeCode?: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  primaryCategory?: string | null;
  primary_phone: string | null;
  website_uri: string | null;
  profilePhotoUrl?: string | null;
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
  imported?: number;
  skipped?: number;
  items?: Array<{
    biz_id?: string;
    integration_id?: string;
    status: 'imported' | 'skipped';
    reason?: string;
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
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [selectedSeedIntegrationId, setSelectedSeedIntegrationId] = useState<string>('');
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
    () => (googleBusinesses || []).find((item) => item.integration_id === selectedSeedIntegrationId) || null,
    [googleBusinesses, selectedSeedIntegrationId],
  );
  const seedOptions = useMemo(
    () =>
      (googleBusinesses || [])
        .filter((item) => item.integration_id)
        .map((item) => ({
          value: item.integration_id as string,
          label: `${item.biz_name}${item.city ? ` · ${item.city}` : ''}`,
        })),
    [googleBusinesses],
  );
  const businessOptions = useMemo(
    () => businesses.map((item) => ({ value: item.id, label: item.name })),
    [businesses],
  );
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
        setSelectedSeedIntegrationId('');
        setGoogleFeedback(payload.message || t('settings.integrations.googleBusinessesLoadError'));
        setGoogleBusinessesLoading(false);
        return;
      }
      const locals = Array.isArray(payload.locals) ? payload.locals : [];
      setGoogleBusinesses(locals);
      if (!selectedSeedIntegrationId) {
        const firstSeed = locals.find((item) => item.integration_id)?.integration_id || '';
        setSelectedSeedIntegrationId(firstSeed);
      } else if (!locals.some((item) => item.integration_id === selectedSeedIntegrationId)) {
        const firstSeed = locals.find((item) => item.integration_id)?.integration_id || '';
        setSelectedSeedIntegrationId(firstSeed);
      }
      setGoogleBusinessesLoading(false);
    } catch {
      setGoogleBusinesses([]);
      setSelectedSeedIntegrationId('');
      setGoogleFeedback(t('settings.integrations.googleBusinessesLoadError'));
      setGoogleBusinessesLoading(false);
    }
  }

  async function loadGoogleLocations(seedIntegrationId: string) {
    setLocationsLoading(true);
    setLocationsFeedback(null);
    setGoogleLocations([]);
    setSelectedLocationIds([]);
    try {
      const response = await fetch(`/api/integrations/google/locations?seed_integration_id=${encodeURIComponent(seedIntegrationId)}`);
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
      setSelectedLocationIds(list.length > 0 ? [list[0].location_id] : []);
      setLocationsLoading(false);
    } catch {
      setLocationsState('not_connected');
      setLocationsFeedback(t('settings.integrations.googleLocationsLoadError'));
      setLocationsLoading(false);
    }
  }

  function openLocationsModal() {
    const seedIntegrationId =
      selectedBusinessIntegration?.integration_id
      || selectedSeedIntegrationId
      || seedOptions[0]?.value
      || '';
    if (!seedIntegrationId) return;
    setSelectedSeedIntegrationId(seedIntegrationId);
    setLocationsModalOpen(true);
    void loadGoogleLocations(seedIntegrationId);
  }

  function closeLocationsModal() {
    setLocationsModalOpen(false);
    setLocationsFeedback(null);
    setGoogleLocations([]);
    setSelectedLocationIds([]);
  }

  function toggleLocation(locationId: string) {
    setSelectedLocationIds((current) =>
      current.includes(locationId)
        ? current.filter((id) => id !== locationId)
        : [...current, locationId],
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
    if (selectedLocationIds.length === 0 || !selectedSeedIntegrationId) return;
    setImportingLocation(true);
    setLocationsFeedback(null);
    try {
      const response = await fetch('/api/integrations/google/import-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed_integration_id: selectedSeedIntegrationId,
          location_ids: selectedLocationIds,
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

      const importedCount = Number(payload.imported || 0);
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
      <div className="max-w-3xl space-y-4">
        <div className={cn(glassStrong, glassNoise, glassSweep, 'p-6 space-y-4')}>
          <div className="space-y-1">
            <h3 className="font-semibold text-white/90">{t('settings.integrations.publishSectionTitle')}</h3>
            <p className="text-xs text-white/70">{t('settings.integrations.webhookDesc')}</p>
          </div>

          {businessOptions.length > 1 && (
            <Select
              label={t('settings.integrations.businessSelector')}
              options={businessOptions}
              value={selectedBizId || ''}
              onChange={(event) => setSelectedBizId(event.target.value)}
            />
          )}

          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/14 bg-white/8 px-3 py-2 transition-all duration-[220ms] ease-premium hover:border-brand-accent/20 hover:shadow-[0_0_16px_rgba(0,168,107,0.10)]">
            <div>
              <p className="text-sm font-medium text-white/90">{t('settings.integrations.webhookEnable')}</p>
              <p className="text-xs text-white/70">{t('settings.integrations.webhookEnableHint')}</p>
            </div>
            <button
              type="button"
              onClick={() => setEnabled((prev) => !prev)}
              disabled={loading}
              aria-pressed={enabled}
              data-testid="webhook-enabled"
              className={cn(
                'relative h-6 w-12 rounded-full transition-colors duration-[220ms] ease-premium disabled:opacity-50',
                enabled ? 'bg-brand-accent' : 'bg-white/20',
                ringAccent,
              )}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>

          <Input
            label={t('settings.integrations.webhookUrl')}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://hook.make.com/... o https://hooks.zapier.com/..."
            type="password"
            autoComplete="off"
            data-testid="webhook-url"
            disabled={loading}
          />

          <div className="rounded-xl border border-white/14 bg-white/8 px-3 py-2 flex items-center justify-between gap-2 transition-all duration-[220ms] ease-premium hover:border-brand-accent/20 hover:shadow-[0_0_16px_rgba(0,168,107,0.10)]">
            <p className="text-xs text-white/72">
              {secretPresent ? t('settings.integrations.secretConfigured') : t('settings.integrations.secretMissing')}
            </p>
            <Button variant="secondary" onClick={() => void handleRegenerateSecret()} loading={saving}>
              {t('settings.integrations.regenerateSecret')}
            </Button>
          </div>

          <div className="space-y-2" data-testid="webhook-channels">
            <p className="text-sm font-medium text-white/82">{t('settings.integrations.webhookChannels')}</p>
            <div className="flex flex-wrap gap-2">
              {CHANNEL_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs cursor-pointer transition-all duration-[220ms] ease-premium ${
                    selectedChannels.has(option.value)
                      ? 'bg-white/8 text-white border-brand-accent/30 ring-1 ring-brand-accent/20 shadow-[0_0_18px_rgba(0,168,107,0.12)]'
                      : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/8 hover:text-white'
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

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void handleSave()} loading={saving} data-testid="webhook-save">
              {t('common.save')}
            </Button>
            <Button variant="secondary" onClick={() => void handleTestWebhook()} loading={testing} data-testid="webhook-test" disabled={!connectorId}>
              {t('settings.integrations.testWebhook')}
            </Button>
          </div>

          {webhookStatus && (
            <div className={cn(glass, glassNoise, 'text-xs text-white/72 px-2.5 py-2 space-y-1')} data-testid="webhook-test-status">
              <p>{webhookStatus}</p>
              {webhookStatusRequestId && (
                <div className="flex items-center gap-2">
                  <span>ID: {webhookStatusRequestId}</span>
                  <button
                    type="button"
                    onClick={() => void copyRequestId()}
                    className={cn('rounded border border-white/14 bg-white/8 px-1.5 py-0.5 text-[10px] transition-all duration-[220ms] ease-premium hover:bg-white/12', ringAccent)}
                  >
                    {copiedRequestId ? t('dashboard.studio.copied') : t('settings.integrations.copyId')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={cn(glassStrong, glassNoise, glassSweep, 'p-6 space-y-4')}>
          <div className="space-y-1">
            <h3 className="font-semibold text-white/90">{t('settings.integrations.reputationSectionTitle')}</h3>
            <p className="text-xs text-white/70">{t('settings.integrations.reputationSectionDesc')}</p>
          </div>

          {businessOptions.length > 1 && (
            <Select
              label={t('settings.integrations.businessSelector')}
              options={businessOptions}
              value={selectedBizId || ''}
              onChange={(event) => setSelectedBizId(event.target.value)}
            />
          )}

          <div className="rounded-xl border border-white/14 bg-white/8 px-3 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-white/90">{t('settings.integrations.googleStatusLabel')}</p>
              <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs', googleStatusClass)}>
                {googleBusinessesLoading ? t('common.loading') : googleStatusLabel}
              </span>
            </div>
            <p className="text-xs text-white/70">
              {selectedBusiness?.name || t('common.unknown')}
            </p>
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
            >
              {t('settings.integrations.googleRefreshStatus')}
            </Button>
            <Button
              variant="secondary"
              onClick={openLocationsModal}
              disabled={!selectedBizId || !seedOptions.length}
              data-testid="google-business-add-location"
            >
              {t('settings.integrations.googleAddLocation')}
            </Button>
          </div>

          <div className={cn(glass, glassNoise, 'p-3')}>
            <p className="text-xs uppercase tracking-wide text-white/55 mb-2">
              {t('settings.integrations.googleLocationsListTitle')}
            </p>
            <div className="space-y-2" data-testid="google-businesses-list">
              {(googleBusinesses || []).map((item) => (
                <div
                  key={item.biz_id}
                  className="rounded-lg border border-white/10 bg-white/6 px-3 py-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="text-sm text-white/90">{item.biz_name}</p>
                    <p className="text-xs text-white/60">
                      {item.city || item.slug || '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex rounded-full border px-2 py-0.5 text-xs',
                        item.state === 'connected'
                          ? 'border-emerald-400/35 bg-emerald-400/12 text-emerald-100'
                          : item.state === 'needs_reauth'
                            ? 'border-amber-300/40 bg-amber-300/12 text-amber-100'
                            : 'border-white/20 bg-white/8 text-white/82',
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
                    >
                      {item.state === 'needs_reauth'
                        ? t('settings.integrations.googleReconnect')
                        : t('settings.integrations.googleConnect')}
                    </Button>
                  </div>
                </div>
              ))}
              {!googleBusinessesLoading && (!googleBusinesses || googleBusinesses.length === 0) && (
                <p className="text-xs text-white/65">{t('settings.integrations.googleBusinessesEmpty')}</p>
              )}
            </div>
          </div>

          {googleBusinesses.some((item) => item.state === 'needs_reauth') && (
            <div className={cn(glass, glassNoise, 'text-xs text-amber-100 border border-amber-300/35 bg-amber-300/10 px-2.5 py-2')}>
              {t('settings.integrations.googleReauthWarning')}
            </div>
          )}

          {googleFeedback && (
            <div className={cn(glass, glassNoise, 'text-xs text-white/72 px-2.5 py-2')}>
              {googleFeedback}
            </div>
          )}
        </div>
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

            <Select
              label={t('settings.integrations.googleSeedSelector')}
              options={seedOptions}
              value={selectedSeedIntegrationId}
              onChange={(event) => {
                const nextSeedId = event.target.value;
                setSelectedSeedIntegrationId(nextSeedId);
                if (nextSeedId) void loadGoogleLocations(nextSeedId);
              }}
            />

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
                        key={location.location_id}
                        className={cn(
                          'block rounded-lg border px-3 py-2 cursor-pointer transition-all duration-[220ms] ease-premium',
                          selectedLocationIds.includes(location.location_id)
                            ? 'border-brand-accent/40 bg-white/10'
                            : 'border-white/10 bg-white/5 hover:bg-white/8',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={selectedLocationIds.includes(location.location_id)}
                          onChange={() => toggleLocation(location.location_id)}
                        />
                        <p className="text-sm text-white/90">{location.name}</p>
                        <p className="text-xs text-white/65">
                          {location.city || '—'} · {location.country || '—'} · {location.location_id}
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
                    disabled={selectedLocationIds.length === 0 || !selectedSeedIntegrationId}
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
