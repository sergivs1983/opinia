'use client';

import { useEffect, useMemo, useState } from 'react';

import { useWorkspace } from '@/contexts/WorkspaceContext';
import { tokens, cx } from '@/lib/design/tokens';

type PlannerItem = {
  id: string;
  title: string;
  status: string;
  scheduled_at: string;
  channel: string;
};

type PlannerPayload = {
  items?: PlannerItem[];
  error?: string;
  message?: string;
};

function weekStartMondayIso(): string {
  const date = new Date();
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - (day - 1));
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function LITOPlannerTab() {
  const { biz } = useWorkspace();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PlannerItem[]>([]);

  const title = useMemo(() => (biz?.name ? `Planner · ${biz.name}` : 'Planner'), [biz?.name]);

  useEffect(() => {
    if (!biz?.id) {
      setItems([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          weekStart: weekStartMondayIso(),
          limit: '20',
        });

        const response = await fetch(`/api/planner?${params.toString()}`, {
          headers: { 'x-biz-id': biz.id },
          cache: 'no-store',
        });

        const payload = (await response.json().catch(() => ({}))) as PlannerPayload;

        if (!response.ok || payload.error) {
          throw new Error(payload.message || 'No he pogut carregar el planner.');
        }

        if (cancelled) return;
        setItems(Array.isArray(payload.items) ? payload.items : []);
      } catch (loadError) {
        if (cancelled) return;
        setItems([]);
        setError(loadError instanceof Error ? loadError.message : 'No he pogut carregar el planner.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [biz?.id]);

  return (
    <section className="space-y-4 pb-12" data-testid="lito-planner-tab">
      <header className="space-y-1">
        <h1 className={cx('text-2xl font-semibold md:text-3xl', tokens.text.primary)}>{title}</h1>
        <p className={cx('text-sm md:text-base', tokens.text.secondary)}>
          Vista setmanal de contingut i publicacions programades.
        </p>
      </header>

      {!biz?.id ? (
        <article className={cx('p-5', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}>
          <p className={cx(tokens.text.cardTitle, tokens.text.primary)}>Selecciona un negoci per veure el planner.</p>
        </article>
      ) : null}

      {error ? (
        <article className={cx('p-4 text-sm', tokens.bg.warning, tokens.border.warning, tokens.radius.button, tokens.text.warning)}>
          {error}
        </article>
      ) : null}

      {loading ? (
        <article className={cx('p-4', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}>
          <p className={cx('text-sm', tokens.text.secondary)}>Carregant planner...</p>
        </article>
      ) : null}

      {!loading && biz?.id ? (
        <div className="space-y-3">
          {items.length === 0 ? (
            <article className={cx('p-5', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}>
              <p className={cx(tokens.text.cardTitle, tokens.text.primary)}>No hi ha publicacions programades aquesta setmana.</p>
              <p className={cx('mt-1', tokens.text.cardSub, tokens.text.secondary)}>Quan n hi hagi, apareixeran aquí.</p>
            </article>
          ) : (
            items.map((item) => (
              <article
                key={item.id}
                className={cx('p-4', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className={cx(tokens.text.cardTitle, tokens.text.primary)}>{item.title || 'Sense títol'}</h2>
                    <p className={cx('mt-1', tokens.text.cardSub, tokens.text.secondary)}>
                      {formatWhen(item.scheduled_at)} · {item.channel}
                    </p>
                  </div>
                  <span className={cx(tokens.badge.base, tokens.badge.neutral)}>{item.status}</span>
                </div>
              </article>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
