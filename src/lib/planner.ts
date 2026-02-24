import type {
  ContentAssetFormat,
  ContentPlannerChannel,
  ContentSuggestionType,
} from '@/types/database';

const DEFAULT_DAY_OFFSET = 3; // Thursday
const DEFAULT_HOUR = 19;
const DEFAULT_MINUTE = 30;

const DAY_TOKEN_MAP: Array<{ dayOffset: number; tokens: string[] }> = [
  { dayOffset: 0, tokens: ['dl', 'lun', 'mon', 'monday'] },
  { dayOffset: 1, tokens: ['dt', 'mar', 'tue', 'tuesday'] },
  { dayOffset: 2, tokens: ['dc', 'mie', 'mié', 'wed', 'wednesday'] },
  { dayOffset: 3, tokens: ['dj', 'jue', 'thu', 'thursday'] },
  { dayOffset: 4, tokens: ['dv', 'vie', 'fri', 'friday'] },
  { dayOffset: 5, tokens: ['ds', 'sab', 'sáb', 'sat', 'saturday'] },
  { dayOffset: 6, tokens: ['dg', 'dom', 'sun', 'sunday'] },
];

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseTime(bestTime: string): { hour: number; minute: number } | null {
  const twelveHour = bestTime.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (twelveHour) {
    const rawHour = Number.parseInt(twelveHour[1], 10);
    const minute = Number.parseInt(twelveHour[2] || '0', 10);
    if (!Number.isFinite(rawHour) || !Number.isFinite(minute)) return null;
    if (rawHour < 1 || rawHour > 12 || minute < 0 || minute > 59) return null;
    const marker = twelveHour[3].toLowerCase();
    const hour = marker === 'pm' ? (rawHour % 12) + 12 : rawHour % 12;
    return { hour, minute };
  }

  const twentyFourHour = bestTime.match(/(\d{1,2}):(\d{2})/);
  if (twentyFourHour) {
    const hour = Number.parseInt(twentyFourHour[1], 10);
    const minute = Number.parseInt(twentyFourHour[2], 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
  }

  return null;
}

function parseDayOffset(bestTime: string): number {
  const normalized = bestTime.toLowerCase();
  for (const mapping of DAY_TOKEN_MAP) {
    if (mapping.tokens.some((token) => normalized.includes(token))) {
      return mapping.dayOffset;
    }
  }
  return DEFAULT_DAY_OFFSET;
}

export function getWeekStartMondayFromDate(source: Date): string {
  if (Number.isNaN(source.getTime())) return getCurrentWeekStartMonday();
  const local = new Date(source);
  const day = local.getDay();
  const diffToMonday = (day + 6) % 7;
  local.setDate(local.getDate() - diffToMonday);
  local.setHours(0, 0, 0, 0);
  return toDateKey(local);
}

export function getCurrentWeekStartMonday(now: Date = new Date()): string {
  return getWeekStartMondayFromDate(now);
}

export function normalizeWeekStartMonday(weekStart: string): string {
  const parsed = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return getCurrentWeekStartMonday();
  return getWeekStartMondayFromDate(parsed);
}

export function deriveScheduledAtFromBestTime(args: {
  bestTime?: string | null;
  weekStart: string;
}): string {
  const weekStartMonday = normalizeWeekStartMonday(args.weekStart);
  const baseDate = new Date(`${weekStartMonday}T00:00:00`);
  if (Number.isNaN(baseDate.getTime())) {
    const fallbackDate = new Date();
    fallbackDate.setHours(DEFAULT_HOUR, DEFAULT_MINUTE, 0, 0);
    return fallbackDate.toISOString();
  }

  const normalized = (args.bestTime || '').trim();
  const dayOffset = normalized ? parseDayOffset(normalized) : DEFAULT_DAY_OFFSET;
  const parsedTime = normalized ? parseTime(normalized) : null;

  const scheduled = new Date(baseDate);
  scheduled.setDate(baseDate.getDate() + dayOffset);
  scheduled.setHours(parsedTime?.hour ?? DEFAULT_HOUR, parsedTime?.minute ?? DEFAULT_MINUTE, 0, 0);
  return scheduled.toISOString();
}

export function defaultScheduledAtTomorrow(now: Date = new Date()): string {
  const scheduled = new Date(now);
  scheduled.setDate(scheduled.getDate() + 1);
  scheduled.setHours(DEFAULT_HOUR, DEFAULT_MINUTE, 0, 0);
  return scheduled.toISOString();
}

export function plannerChannelFromSuggestionType(type: ContentSuggestionType): ContentPlannerChannel {
  if (type === 'reel') return 'ig_reel';
  if (type === 'story') return 'ig_story';
  return 'ig_feed';
}

export function plannerChannelFromAssetFormat(format: ContentAssetFormat): ContentPlannerChannel {
  return format === 'story' ? 'ig_story' : 'ig_feed';
}
