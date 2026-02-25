'use client';

/**
 * Dashboard Error Boundary
 * Next.js App Router: catches unhandled errors in dashboard routes.
 * Shows friendly message + retry button.
 */

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="card max-w-md w-full p-8 text-center">
        {/* Icon */}
        <div
          className="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: 'var(--color-danger-subtle)' }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-danger)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        {/* Message */}
        <h2
          className="text-lg font-semibold mb-1.5"
          style={{ color: 'var(--color-text)' }}
        >
          Alguna cosa no ha anat com esperàvem
        </h2>
        <p
          className="text-sm mb-6"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Hi ha hagut un error carregant aquesta pàgina. Pots reintentar-ho o tornar a l&apos;inici.
        </p>

        {/* Error detail (collapsed, dev-friendly) */}
        {error?.message && (
          <details className="mb-5 text-left">
            <summary
              className="text-xs cursor-pointer mb-1"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              Detalls tècnics
            </summary>
            <pre
              className="text-xs p-3 rounded-[var(--radius-sm)] overflow-auto max-h-24 font-mono"
              style={{
                background: 'var(--color-bg-muted)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {error.message}
            </pre>
          </details>
        )}

        {/* Error reference — correlate with server logs */}
        {error?.digest && (
          <p
            className="text-xs mb-4 font-mono"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Ref: {error.digest.slice(0, 8).toUpperCase()}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-5 py-2 text-sm font-medium rounded-[var(--radius-md)] transition-all"
            style={{
              background: 'var(--color-brand)',
              color: 'var(--color-text-inverse)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-brand-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-brand)')}
          >
            Reintentar
          </button>
          <a
            href="/dashboard/inbox"
            className="px-5 py-2 text-sm font-medium rounded-[var(--radius-md)] border transition-all"
            style={{
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-secondary)',
            }}
          >
            Tornar a l&apos;inici
          </a>
        </div>
      </div>
    </div>
  );
}
