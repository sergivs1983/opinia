export type SocialSchedulePlatform = 'instagram' | 'tiktok';
export type SocialScheduleStatus = 'scheduled' | 'notified' | 'published' | 'missed' | 'snoozed' | 'canceled';
export type SocialReminderKind = 't_minus_24h' | 't_minus_1h' | 't_plus_15m';
export type SocialReminderStatus = 'pending' | 'sent' | 'canceled';
export type SocialSnoozeMode = 'plus_1h' | 'tomorrow_same_time';

export type SocialReminderInsertRow = {
  schedule_id: string;
  trigger_at: string;
  kind: SocialReminderKind;
  status: SocialReminderStatus;
};

export function toIsoStringUtc(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('invalid_datetime');
  }
  return date.toISOString();
}

export function computeSnoozedAt(currentScheduledAtIso: string, mode: SocialSnoozeMode): string {
  const current = new Date(currentScheduledAtIso);
  if (Number.isNaN(current.getTime())) {
    throw new Error('invalid_datetime');
  }

  const next = new Date(current);
  if (mode === 'plus_1h') {
    next.setTime(next.getTime() + 60 * 60 * 1000);
  } else {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.toISOString();
}

export function buildReminderQueueRows(scheduleId: string, scheduledAtIso: string): SocialReminderInsertRow[] {
  const scheduledAt = new Date(scheduledAtIso);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error('invalid_datetime');
  }

  const minus24h = new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000);
  const minus1h = new Date(scheduledAt.getTime() - 60 * 60 * 1000);
  const plus15m = new Date(scheduledAt.getTime() + 15 * 60 * 1000);

  return [
    {
      schedule_id: scheduleId,
      trigger_at: minus24h.toISOString(),
      kind: 't_minus_24h',
      status: 'pending',
    },
    {
      schedule_id: scheduleId,
      trigger_at: minus1h.toISOString(),
      kind: 't_minus_1h',
      status: 'pending',
    },
    {
      schedule_id: scheduleId,
      trigger_at: plus15m.toISOString(),
      kind: 't_plus_15m',
      status: 'pending',
    },
  ];
}

export function toLocalDateTimeInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function parseDateRange(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
