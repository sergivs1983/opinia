/**
 * Dashboard Loading Skeleton
 * Next.js App Router: shown automatically during route transitions.
 * Simulates inbox layout: header + filter bar + review cards.
 */

export default function DashboardLoading() {
  return (
    <div className="p-6 animate-fade-in">
      {/* Page header skeleton */}
      <div className="flex items-center justify-between mb-6">
        <div className="h-6 w-48 rounded-lg bg-[var(--color-bg-muted)] animate-pulse" />
        <div className="h-9 w-32 rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] animate-pulse" />
      </div>

      {/* Filter bar skeleton */}
      <div className="flex gap-2 mb-6">
        {[72, 64, 80, 56].map((w, i) => (
          <div
            key={i}
            className="h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] animate-pulse"
            style={{ width: w, animationDelay: `${i * 75}ms` }}
          />
        ))}
      </div>

      {/* Review card skeletons */}
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="card p-4 flex gap-4"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            {/* Star rating placeholder */}
            <div className="shrink-0 flex flex-col items-center gap-1.5 pt-0.5">
              <div className="h-5 w-5 rounded-full bg-[var(--color-bg-muted)] animate-pulse" />
              <div className="flex gap-0.5">
                {[0, 1, 2, 3, 4].map((s) => (
                  <div key={s} className="h-3 w-3 rounded-sm bg-[var(--color-bg-muted)] animate-pulse" />
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 space-y-2.5">
              {/* Author + date */}
              <div className="flex items-center gap-3">
                <div className="h-4 w-28 rounded bg-[var(--color-bg-muted)] animate-pulse" />
                <div className="h-3 w-16 rounded bg-[var(--color-bg-muted)] animate-pulse" />
              </div>
              {/* Review text lines */}
              <div className="space-y-1.5">
                <div className="h-3.5 w-full rounded bg-[var(--color-bg-muted)] animate-pulse" />
                <div
                  className="h-3.5 rounded bg-[var(--color-bg-muted)] animate-pulse"
                  style={{ width: `${65 + i * 5}%` }}
                />
              </div>
              {/* Tags */}
              <div className="flex gap-2">
                <div className="h-5 w-16 rounded-full bg-[var(--color-bg-muted)] animate-pulse" />
                <div className="h-5 w-20 rounded-full bg-[var(--color-bg-muted)] animate-pulse" />
              </div>
            </div>

            {/* Status dot */}
            <div className="shrink-0 pt-1">
              <div className="h-2 w-2 rounded-full bg-[var(--color-bg-muted)] animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
