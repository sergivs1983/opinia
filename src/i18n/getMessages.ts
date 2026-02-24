import { type Locale, defaultLocale } from './config';

type Messages = Record<string, unknown>;

function deepMerge(base: Messages, override: Messages): Messages {
  const result: Messages = { ...base };
  for (const key of Object.keys(override)) {
    const bv = base[key];
    const ov = override[key];
    if (typeof ov === 'object' && ov !== null && !Array.isArray(ov) && typeof bv === 'object' && bv !== null) {
      result[key] = deepMerge(bv as Messages, ov as Messages);
    } else {
      result[key] = ov;
    }
  }
  return result;
}

/**
 * Load messages for the given locale with fallback to defaultLocale.
 *
 * Uses dynamic import() — works on both Vercel serverless and local dev.
 * Each import gets a fresh module (no stale cache across locale switches).
 */
export async function getMessages(locale: Locale): Promise<Messages> {
  async function loadJson(loc: string): Promise<Messages> {
    try {
      // Dynamic import with cache-busting timestamp ensures fresh reads.
      // Next.js bundles files from `messages/` at build time when imported this way.
      const mod = await import(`../../messages/${loc}.json`);
      return (mod.default ?? mod) as Messages;
    } catch {
      return {};
    }
  }

  let messages = await loadJson(locale);

  // Deep merge with fallback locale if not the default
  if (locale !== defaultLocale) {
    const fallback = await loadJson(defaultLocale);
    messages = deepMerge(fallback, messages);
  }

  // If messages is empty (bad locale), fall back entirely
  if (Object.keys(messages).length === 0) {
    messages = await loadJson(defaultLocale);
  }

  return messages;
}
