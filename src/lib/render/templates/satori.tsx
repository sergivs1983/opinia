import React, { type CSSProperties, type ReactElement } from 'react';
import type { StudioRenderPayload, StudioTemplateId } from '@/lib/content-studio';

const SATORI_TEMPLATE_IDS = new Set<StudioTemplateId>(['quote-clean', 'feature-split']);

function rootStyle(payload: StudioRenderPayload, width: number, height: number): CSSProperties {
  return {
    width,
    height,
    display: 'flex',
    flexDirection: 'column',
    backgroundImage: `linear-gradient(160deg, ${payload.brand.secondary} 0%, #ffffff 45%, ${payload.brand.secondary} 100%)`,
    color: payload.brand.text,
    fontFamily: 'Inter, system-ui, sans-serif',
  };
}

function chipStyle(payload: StudioRenderPayload): CSSProperties {
  return {
    alignSelf: 'flex-start',
    borderRadius: 999,
    padding: '10px 18px',
    fontSize: 20,
    fontWeight: 700,
    color: '#ffffff',
    background: payload.brand.primary,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };
}

function panelStyle(): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(255,255,255,0.9)',
    border: '2px solid rgba(15,23,42,0.08)',
    borderRadius: 32,
    padding: 38,
  };
}

function renderQuoteClean(payload: StudioRenderPayload, width: number, height: number): ReactElement {
  const padding = payload.format === 'story' ? 72 : 56;
  const quoteSize = payload.format === 'story' ? 70 : 58;

  return (
    <div style={{ ...rootStyle(payload, width, height), padding }}>
      <div style={chipStyle(payload)}>{payload.format}</div>
      <div
        style={{
          ...panelStyle(),
          marginTop: 28,
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: quoteSize, lineHeight: 1.1, fontWeight: 700 }}>
          {`“${payload.quote}”`}
        </div>
      </div>
      <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 30, fontWeight: 700 }}>{payload.business_name}</div>
        <div style={{ marginTop: 10, fontSize: 28, color: payload.brand.primary }}>{payload.cta}</div>
      </div>
    </div>
  );
}

function renderFeatureSplit(payload: StudioRenderPayload, width: number, height: number): ReactElement {
  const padding = payload.format === 'story' ? 64 : 50;
  const bullets = payload.bullets.slice(0, 3);

  return (
    <div style={{ ...rootStyle(payload, width, height), padding }}>
      <div style={{ display: 'flex', flexDirection: 'row', flex: 1, gap: 30 }}>
        <div style={{ ...panelStyle(), flex: 1.1 }}>
          <div style={{ fontSize: 18, letterSpacing: '0.08em', textTransform: 'uppercase', color: payload.brand.primary }}>
            {payload.template_id}
          </div>
          <div style={{ marginTop: 14, fontSize: 54, lineHeight: 1.1, fontWeight: 700 }}>{payload.title}</div>
          <div style={{ marginTop: 20, fontSize: 32, lineHeight: 1.25 }}>{payload.hook}</div>
          <div style={{ marginTop: 18, fontSize: 24, lineHeight: 1.35 }}>{payload.caption}</div>
        </div>

        <div style={{ ...panelStyle(), flex: 0.9 }}>
          <div style={{ fontSize: 30, fontWeight: 700 }}>Key points</div>
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {bullets.map((bullet) => (
              <div key={bullet} style={{ fontSize: 26, lineHeight: 1.3 }}>
                {`• ${bullet}`}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 'auto', fontSize: 21, color: payload.brand.primary, fontWeight: 600 }}>
            {payload.best_time || '-'}
          </div>
        </div>
      </div>
    </div>
  );
}

export function isSatoriTemplate(templateId: string): boolean {
  return SATORI_TEMPLATE_IDS.has(templateId as StudioTemplateId);
}

export function renderSatoriTemplate(
  payload: StudioRenderPayload,
  width: number,
  height: number,
): ReactElement {
  if (payload.template_id === 'quote-clean') {
    return renderQuoteClean(payload, width, height);
  }

  if (payload.template_id === 'feature-split') {
    return renderFeatureSplit(payload, width, height);
  }

  throw new Error(`template_not_supported_by_satori:${payload.template_id}`);
}
