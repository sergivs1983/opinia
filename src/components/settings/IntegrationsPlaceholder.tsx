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

type GoogleStatusResponse = {
  state?: 'connected' | 'needs_reauth' | 'not_connected';
  provider?: 'google_business';
  request_id?: string;
  error?: string;
  message?: string;
};

type GoogleConnectResponse = {
  url?: string;
  request_id?: string;
  error?: string;
  message?: string;
};

const CHANNEL_OPTIONS: Array<{ value: 'ig_feed' | 'ig_story' | 'ig_reel'; label: string }> = [
  { value: 'ig_feed', label: 'IG Feed' },
  { value: 'ig_story', label: 'IG Story' },
  { value: 'ig_reel', label: 'IG Reel' },
];

type GoogleIntegrationUiStatus = 'connected' | 'needs_reauth' | 'not_connected' | 'unavailable';

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

  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<GoogleIntegrationUiStatus>('not_connected');
  const [googleFeedback, setGoogleFeedback] = useState<string | null>(null);

  const selectedBusiness = useMemo(
    () => businesses.find((item) => item.id === selectedBizId) || null,
    [businesses, selectedBizId],
  );
  const businessOptions = useMemo(
    () => businesses.map((item) => ({ value: item.id, label: item.name })),
    [businesses],
  );
  const selectedChannels = useMemo(() => new Set(channels), [channels]);
  const googleStatusLabel = useMemo(() => {
    if (googleStatus === 'connected') return t('settings.integrations.googleStatusConnected');
    if (googleStatus === 'needs_reauth') return t('settings.integrations.googleStatusNeedsReauth');
    if (googleStatus === 'unavailable') return t('settings.integrations.googleStatusUnavailable');
    return t('settings.integrations.googleStatusNotConnected');
  }, [googleStatus, t]);
  const googleStatusClass = useMemo(() => {
    if (googleStatus === 'connected') return 'border-emerald-400/35 bg-emerald-400/12 text-emerald-100';
    if (googleStatus === 'needs_reauth') return 'border-amber-300/40 bg-amber-300/12 text-amber-100';
    if (googleStatus === 'unavailable') return 'border-white/20 bg-white/8 text-white/72';
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
    void loadGoogleStatus(selectedBizId);
  }, [selectedBizId]);

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

  async function loadGoogleStatus(businessId: string) {
    setGoogleLoading(true);
    setGoogleFeedback(null);
    try {
      const response = await fetch(`/api/integrations/google/status?biz_id=${encodeURIComponent(businessId)}`);
      const fromSafeList = businesses.some((item) => item.id === businessId);

      if (response.status === 404) {
        setGoogleStatus(fromSafeList ? 'unavailable' : 'not_connected');
        if (fromSafeList) setGoogleFeedback(t('settings.integrations.googleStatusUnavailable'));
        setGoogleLoading(false);
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as GoogleStatusResponse;
      if (!response.ok || payload.error) {
        setGoogleStatus('not_connected');
        setGoogleFeedback(payload.message || t('settings.integrations.googleStatusLoadError'));
        setGoogleLoading(false);
        return;
      }

      if (payload.state === 'connected' || payload.state === 'needs_reauth' || payload.state === 'not_connected') {
        setGoogleStatus(payload.state);
      } else {
        setGoogleStatus('not_connected');
      }
      setGoogleLoading(false);
    } catch {
      setGoogleStatus('not_connected');
      setGoogleFeedback(t('settings.integrations.googleStatusLoadError'));
      setGoogleLoading(false);
    }
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

  async function handleConnectGoogle() {
    if (!selectedBizId) return;
    setGoogleConnecting(true);
    setGoogleFeedback(null);

    try {
      const response = await fetch('/api/integrations/google/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ biz_id: selectedBizId }),
      });

      const fromSafeList = businesses.some((item) => item.id === selectedBizId);
      if (response.status === 404) {
        setGoogleStatus(fromSafeList ? 'unavailable' : 'not_connected');
        setGoogleFeedback(
          fromSafeList
            ? t('settings.integrations.googleStatusUnavailable')
            : t('settings.integrations.googleStatusNotConnected'),
        );
        setGoogleConnecting(false);
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as GoogleConnectResponse;
      if (!response.ok || payload.error) {
        setGoogleFeedback(payload.message || t('settings.integrations.googleConnectError'));
        setGoogleConnecting(false);
        return;
      }

      if (!payload.url) {
        setGoogleFeedback(t('settings.integrations.googleConnectError'));
        setGoogleConnecting(false);
        return;
      }

      window.location.assign(payload.url);
    } catch {
      setGoogleFeedback(t('settings.integrations.googleConnectError'));
      setGoogleConnecting(false);
    }
  }

  async function copyRequestId() {
    if (!webhookStatusRequestId) return;
    await navigator.clipboard.writeText(webhookStatusRequestId);
    setCopiedRequestId(true);
    window.setTimeout(() => setCopiedRequestId(false), 1200);
  }

  return (
    <div className="max-w-2xl space-y-4">
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
              ringAccent
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
              {googleLoading ? t('common.loading') : googleStatusLabel}
            </span>
          </div>
          <p className="text-xs text-white/70">
            {selectedBusiness?.name || biz?.name || t('common.unknown')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void handleConnectGoogle()}
            loading={googleConnecting}
            disabled={googleLoading || googleStatus === 'unavailable' || !selectedBizId}
            data-testid="google-business-connect"
          >
            {googleStatus === 'needs_reauth'
              ? t('settings.integrations.googleReconnect')
              : t('settings.integrations.googleConnect')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => selectedBizId && void loadGoogleStatus(selectedBizId)}
            disabled={!selectedBizId || googleLoading}
            data-testid="google-business-refresh-status"
          >
            {t('settings.integrations.googleRefreshStatus')}
          </Button>
        </div>

        {googleFeedback && (
          <div className={cn(glass, glassNoise, 'text-xs text-white/72 px-2.5 py-2')}>
            {googleFeedback}
          </div>
        )}
      </div>
    </div>
  );
}
