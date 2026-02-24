'use client';

import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/components/i18n/I18nContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
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

const CHANNEL_OPTIONS: Array<{ value: 'ig_feed' | 'ig_story' | 'ig_reel'; label: string }> = [
  { value: 'ig_feed', label: 'IG Feed' },
  { value: 'ig_story', label: 'IG Story' },
  { value: 'ig_reel', label: 'IG Reel' },
];

export default function IntegrationsPlaceholder() {
  const t = useT();
  const { biz, reload } = useWorkspace();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [channels, setChannels] = useState<Array<'ig_feed' | 'ig_story' | 'ig_reel'>>([]);
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [secretPresent, setSecretPresent] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusRequestId, setStatusRequestId] = useState<string | null>(null);
  const [copiedRequestId, setCopiedRequestId] = useState(false);

  const selectedChannels = useMemo(() => new Set(channels), [channels]);

  useEffect(() => {
    if (!biz?.id) return;
    void loadConfig();
  }, [biz?.id]);

  async function loadConfig() {
    if (!biz?.id) return;
    setLoading(true);
    setStatus(null);
    setStatusRequestId(null);

    try {
      const response = await fetch('/api/integrations/connectors', {
        headers: { 'x-biz-id': biz.id },
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

  function toggleChannel(channel: 'ig_feed' | 'ig_story' | 'ig_reel') {
    setChannels((prev) => {
      if (prev.includes(channel)) return prev.filter((entry) => entry !== channel);
      return [...prev, channel];
    });
  }

  async function handleSave() {
    if (!biz?.id) return;
    setSaving(true);
    setStatus(null);
    setStatusRequestId(null);
    setCopiedRequestId(false);

    try {
      const response = await fetch('/api/integrations/connectors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
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
      setStatusRequestId(requestId || null);

      if (!response.ok || payload.error || !payload.connector) {
        const message = payload.message || 'Failed to save webhook config';
        setStatus(message);
        setSaving(false);
        return;
      }

      setConnectorId(payload.connector.id);
      setEnabled(!!payload.connector.enabled);
      setUrl(payload.connector.url || '');
      setChannels(Array.isArray(payload.connector.allowed_channels) ? payload.connector.allowed_channels : []);
      setSecretPresent(!!payload.connector.secret_present);
      await reload();
      setStatus(t('common.saved'));
      setSaving(false);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Failed to save webhook config');
      setSaving(false);
    }
  }

  async function handleTestWebhook() {
    if (!biz?.id || !connectorId) return;
    setTesting(true);
    setStatus(null);
    setStatusRequestId(null);
    setCopiedRequestId(false);

    try {
      const response = await fetch('/api/integrations/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
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
      setStatusRequestId(requestId || null);
      const base = payload.ok ? 'Webhook sent' : `Webhook ${payload.status || 'failed'}`;
      const extra = payload.error ? ` — ${payload.error}` : '';
      setStatus(`${base}${extra}`);
      setTesting(false);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Webhook test failed');
      setTesting(false);
    }
  }

  async function handleRegenerateSecret() {
    if (!biz?.id) return;
    setSaving(true);
    setStatus(null);
    setStatusRequestId(null);
    setCopiedRequestId(false);

    try {
      const response = await fetch('/api/integrations/connectors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
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
      setStatusRequestId(requestId || null);

      if (!response.ok || payload.error || !payload.connector) {
        setStatus(payload.message || 'Failed to regenerate secret');
        setSaving(false);
        return;
      }

      setConnectorId(payload.connector.id);
      setSecretPresent(!!payload.connector.secret_present);
      setStatus(t('settings.integrations.secretRegenerated'));
      setSaving(false);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Failed to regenerate secret');
      setSaving(false);
    }
  }

  async function copyRequestId() {
    if (!statusRequestId) return;
    await navigator.clipboard.writeText(statusRequestId);
    setCopiedRequestId(true);
    window.setTimeout(() => setCopiedRequestId(false), 1200);
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className={cn(glassStrong, glassNoise, glassSweep, 'p-6 space-y-4')}>
        <div className="space-y-1">
          <h3 className="font-semibold text-white/90">{t('settings.integrations.title')}</h3>
          <p className="text-xs text-white/70">{t('settings.integrations.webhookDesc')}</p>
        </div>

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

        {status && (
          <div className={cn(glass, glassNoise, 'text-xs text-white/72 px-2.5 py-2 space-y-1')} data-testid="webhook-test-status">
            <p>{status}</p>
            {statusRequestId && (
              <div className="flex items-center gap-2">
                <span>ID: {statusRequestId}</span>
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
    </div>
  );
}
