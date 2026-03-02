'use client';

import { useEffect, useState } from 'react';

import { tokens, cx } from '@/lib/design/tokens';
import styles from '@/components/lito/LITOHome.module.css';

const IconMic = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="6" y="1.5" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3 9.5a6 6 0 0012 0M9 15.5v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const IconSend = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M14 2L7.5 8.5M14 2L9.5 14l-2-6L2 5.5 14 2z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconX = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const IconCheck = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
    <path d="M2.5 7.5l3.5 3.5 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconChevron = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M5 10l3-3-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill={filled ? '#f59e0b' : 'none'} aria-hidden="true">
      <path
        d="M8 1.5l1.8 4 4.2.6-3 3 .7 4.2L8 11l-3.7 2.3.7-4.2-3-3 4.2-.6L8 1.5z"
        stroke={filled ? '#f59e0b' : '#d4d4d8'}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReviewCard({ onResolve }: { onResolve: (action: 'reject' | 'approve') => void }) {
  const [expanded, setExpanded] = useState(false);
  const [hoveredBtn, setHoveredBtn] = useState<'reject' | 'approve' | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setExpanded(true), 500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      className={styles.floatCard}
      style={{
        background: 'white',
        borderRadius: 32,
        border: '1.5px solid rgba(255,255,255,0.9)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.07),0 4px 16px rgba(0,0,0,0.04)',
        padding: '36px 36px 32px',
        width: '100%',
        maxWidth: 580,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -40,
          right: -40,
          width: 180,
          height: 180,
          borderRadius: '50%',
          background: 'radial-gradient(circle,rgba(16,185,129,0.04) 0%,transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#fef3c7',
              padding: '4px 10px',
              borderRadius: 20,
              marginBottom: 12,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="#f59e0b" aria-hidden="true">
              <circle cx="5" cy="5" r="5" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#92400e', letterSpacing: '0.04em' }}>URGENT · Google</span>
          </div>
          <h2
            style={{
              fontSize: 20,
              fontWeight: 600,
              fontFamily: "Georgia,'Times New Roman',serif",
              color: '#18181b',
              lineHeight: 1.3,
              margin: 0,
            }}
          >
            Ressenya de 2 estrelles
          </h2>
          <p style={{ fontSize: 13, color: '#a1a1aa', margin: '4px 0 0', fontWeight: 400 }}>Fa 2 hores · Marta G.</p>
        </div>
        <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
          {[1, 2, 3, 4, 5].map((item) => (
            <StarIcon key={item} filled={item <= 2} />
          ))}
        </div>
      </div>
      <div style={{ height: 1, background: 'linear-gradient(90deg,#f4f4f5 0%,transparent 100%)', marginBottom: 20 }} />
      <blockquote style={{ margin: '0 0 24px', padding: '0 0 0 16px', borderLeft: '3px solid #f4f4f5' }}>
        <p style={{ fontSize: 15, color: '#3f3f46', lineHeight: 1.65, margin: 0, fontStyle: 'italic' }}>
          El menjar era bo pero el cambrer ha trigat molt. Vam esperar mes de 30 minuts entre plats. No tornarem.
        </p>
      </blockquote>
      <div
        style={{
          background: 'rgba(16,185,129,0.04)',
          border: '1px solid rgba(16,185,129,0.12)',
          borderRadius: 16,
          padding: '16px 20px',
          marginBottom: 28,
          transition: 'all 0.5s ease',
          opacity: expanded ? 1 : 0,
          transform: expanded ? 'translateY(0)' : 'translateY(8px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'linear-gradient(135deg,#10b981,#059669)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ color: 'white', fontSize: 10, fontWeight: 700, fontFamily: 'Georgia,serif' }}>L</span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#059669', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            LITO suggereix
          </span>
        </div>
        <p style={{ fontSize: 14, color: '#065f46', lineHeight: 1.65, margin: 0 }}>
          Hola Marta, sentim molt la teva experiencia. El temps de espera entre plats no reflecteix el nostre estandard de servei.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          onMouseEnter={() => setHoveredBtn('reject')}
          onMouseLeave={() => setHoveredBtn(null)}
          onClick={() => onResolve('reject')}
          style={{
            flex: 1,
            height: 52,
            borderRadius: 14,
            border: '1.5px solid #e4e4e7',
            background: hoveredBtn === 'reject' ? '#f9f9f9' : 'white',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: '#71717a',
            fontSize: 14,
            fontWeight: 500,
            transition: 'all 0.15s ease',
          }}
        >
          <IconX />
          Rebutjar
        </button>
        <button
          type="button"
          onMouseEnter={() => setHoveredBtn('approve')}
          onMouseLeave={() => setHoveredBtn(null)}
          onClick={() => onResolve('approve')}
          style={{
            flex: 2,
            height: 52,
            borderRadius: 14,
            border: 'none',
            background:
              hoveredBtn === 'approve'
                ? 'linear-gradient(135deg,#065f46 0%,#047857 100%)'
                : 'linear-gradient(135deg,#18181b 0%,#27272a 50%,#065f46 100%)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'white',
            fontSize: 14,
            fontWeight: 600,
            boxShadow: hoveredBtn === 'approve' ? '0 8px 24px rgba(5,150,105,0.3)' : '0 4px 16px rgba(0,0,0,0.15)',
            transition: 'all 0.2s ease',
            transform: hoveredBtn === 'approve' ? 'translateY(-1px)' : 'none',
          }}
        >
          <IconCheck />
          Aprovar i enviar
        </button>
      </div>
    </div>
  );
}

function QueuePills({ count }: { count: number }) {
  const labels = ['Post Instagram', 'Senyal · -0.4★', 'Setmana sense planif.'];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#a1a1aa', fontWeight: 500 }}>{count} mes:</span>
      {labels.slice(0, count).map((label) => (
        <button
          key={label}
          type="button"
          style={{
            padding: '5px 12px',
            borderRadius: 20,
            border: '1.5px solid #e4e4e7',
            background: 'white',
            fontSize: 12,
            color: '#52525b',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'all 0.15s',
          }}
        >
          {label}
          <IconChevron />
        </button>
      ))}
    </div>
  );
}

function CommandBar() {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);

  return (
    <div
      className={styles.commandWrap}
    >
      <div
        style={{
          background: focused ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: focused ? '1.5px solid #d4d4d8' : '1.5px solid rgba(212,212,216,0.6)',
          borderRadius: 32,
          boxShadow: focused
            ? '0 16px 48px rgba(0,0,0,0.12),0 4px 16px rgba(0,0,0,0.06)'
            : '0 8px 32px rgba(0,0,0,0.08),0 2px 8px rgba(0,0,0,0.04)',
          padding: '10px 14px 10px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          transition: 'all 0.2s ease',
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#10b981',
            flexShrink: 0,
            boxShadow: '0 0 0 3px rgba(16,185,129,0.15)',
          }}
          className={styles.pulseDot}
        />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Demana alguna cosa a LITO..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: 14,
            color: 'inherit',
            fontWeight: 400,
            fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif",
          }}
        />
        <button
          type="button"
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: '#f4f4f5',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#71717a',
            flexShrink: 0,
            transition: 'all 0.15s',
          }}
          aria-label="Microfon"
        >
          <IconMic />
        </button>
        {value.trim().length > 0 ? (
          <button
            type="button"
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: '#18181b',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              flexShrink: 0,
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            }}
            className={styles.sendVisible}
            aria-label="Enviar"
          >
            <IconSend />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function LITOHome() {
  const [resolved, setResolved] = useState(false);
  const [resolveAnim, setResolveAnim] = useState(false);

  const handleResolve = () => {
    setResolveAnim(true);
    window.setTimeout(() => {
      setResolved(true);
      setResolveAnim(false);
    }, 300);
  };

  return (
    <section className={cx(styles.shell, tokens.bg.global, tokens.text.primary)}>
      <main className={styles.main}>
        <div className={styles.slideUp} style={{ marginBottom: 40 }}>
          <h1
            className={tokens.text.primary}
            style={{
              fontSize: 34,
              fontWeight: 600,
              fontFamily: "Georgia,'Times New Roman',serif",
              lineHeight: 1.2,
              letterSpacing: '-0.5px',
              marginBottom: 8,
            }}
          >
            Bon dia.
          </h1>
          <p className={tokens.text.secondary} style={{ fontSize: 16, fontWeight: 400, lineHeight: 1.5 }}>
            {resolved ? 'Perfecte. Tot al dia per ara.' : 'Avui tenim 3 temes pendents.'}
          </p>
        </div>

        {!resolved ? (
          <div className={resolveAnim ? styles.resolveCard : styles.slideUpDelayed} style={{ width: '100%' }}>
            <ReviewCard onResolve={handleResolve} />
            <QueuePills count={2} />
          </div>
        ) : (
          <div
            className={styles.successPop}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 40px',
              background: 'white',
              borderRadius: 32,
              border: '1.5px solid rgba(255,255,255,0.9)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.05)',
              width: '100%',
              maxWidth: 580,
              gap: 20,
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'linear-gradient(135deg,#10b981,#059669)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(16,185,129,0.25)',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <path d="M5 14l6 6 12-12" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p className={tokens.text.primary} style={{ fontSize: 20, fontWeight: 600, fontFamily: 'Georgia,serif', marginBottom: 6 }}>Tot a punt.</p>
              <p className={tokens.text.secondary} style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 300 }}>
                La resposta sha enviat. La Marta rebra la teva resposta a Google.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setResolved(false)}
              style={{
                marginTop: 8,
                padding: '10px 24px',
                borderRadius: 14,
                border: '1.5px solid #e4e4e7',
                background: 'white',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                color: '#52525b',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              Veure el proper tema
              <IconChevron />
            </button>
          </div>
        )}
      </main>

      <CommandBar />
    </section>
  );
}
