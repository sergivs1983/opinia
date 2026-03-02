'use client';

export const dynamic = 'force-dynamic';

import { type ReactNode, useState } from 'react';

import './lito-demo.css';

type ThemeMode = 'day' | 'night';

function SpotlightCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="future-card"
      onMouseMove={(event) => {
        const card = event.currentTarget;
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        card.style.setProperty('--mouse-x', `${x}px`);
        card.style.setProperty('--mouse-y', `${y}px`);
      }}
    >
      <div className="card-content">{children}</div>
    </div>
  );
}

export default function DashboardLitoPage() {
  const [theme, setTheme] = useState<ThemeMode>('day');

  return (
    <div className="lito-demo" data-theme={theme}>
      <div className="theme-switch">
        <button
          type="button"
          className={`theme-pill ${theme === 'day' ? 'active' : ''}`}
          onClick={() => setTheme('day')}
        >
          Dia
        </button>
        <button
          type="button"
          className={`theme-pill ${theme === 'night' ? 'active' : ''}`}
          onClick={() => setTheme('night')}
        >
          Nit
        </button>
      </div>

      <div className="ambient-light" />
      <div className="noise-overlay" />

      <div className="dashboard-grid">
        <SpotlightCard>
          <div className="tech-header">
            <div className="status-dot" />
            Live Signals
          </div>

          <div className="entity-block">
            <h2>Hotel Maricel</h2>
            <p className="entity-id">ID: 8F-29-X1</p>
          </div>

          <div className="signal-card">
            <div className="signal-label">TOPIC TRENDING</div>
            <h3>La Terrassa</h3>
            <p>+40% mencions avui. Els clients valoren les vistes.</p>
          </div>

          <div className="signal-card">
            <div className="signal-label success">SENTIMENT</div>
            <h3>Molt Positiu</h3>
            <p>La darrera setmana ha estat excel·lent.</p>
          </div>

          <div className="quota-wrap">
            <div className="quota-head">
              <p className="quota-label">QUOTA AI</p>
              <p className="quota-value">82%</p>
            </div>
            <div className="quota-track">
              <div className="quota-fill" />
            </div>
          </div>
        </SpotlightCard>

        <SpotlightCard>
          <div className="tech-header">LITO INTELLIGENCE CORE</div>

          <div className="chat-core">
            <div className="chat-bubble ai">
              <strong>Proposta generada</strong>
              <br />
              <br />
              Basat en les ressenyes recents, et recomano una Story enfocada en &quot;Post-sopar&quot;.
              <br />
              He detectat que els clients valoren la tranquil.litat de la nit a la terrassa.
            </div>

            <div className="options-row">
              <button type="button" className="option-btn">📸 Format Post</button>
              <button type="button" className="option-btn active">✨ Format Story</button>
              <button type="button" className="option-btn">🎥 Format Reel</button>
            </div>
          </div>

          <div className="chat-input-wrap">
            <input type="text" placeholder="Dona'm instruccions addicionals..." />
          </div>
        </SpotlightCard>

        <SpotlightCard>
          <div className="tech-header">WORKBENCH // EXECUTION</div>

          <div className="preview-box">
            <div className="preview-label">PREVIEW</div>
            <p className="preview-text">
              &quot;La nit cau i el Maricel s&apos;il.lumina. ✨ La teva copa t&apos;espera a la nostra terrassa.&quot;
            </p>
          </div>

          <div className="ikea-label">MODE IKEA</div>

          <div className="task-item checked">
            <div className="custom-check">✓</div>
            <span>Neteja la taula 4</span>
          </div>
          <div className="task-item">
            <div className="custom-check" />
            <span>Foto zenital (des de dalt)</span>
          </div>
          <div className="task-item">
            <div className="custom-check" />
            <span>Puja la música &quot;Chill&quot;</span>
          </div>

          <button type="button" className="btn-nuclear">Copiar i Publicar</button>
        </SpotlightCard>
      </div>
    </div>
  );
}
