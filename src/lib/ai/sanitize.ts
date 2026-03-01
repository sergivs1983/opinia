/**
 * sanitize.ts — PII redaction before sending text to any LLM.
 *
 * Removes / masks:
 *   • Email addresses
 *   • Spanish phone numbers (+34 / 034 / 6xx / 7xx / 8xx / 9xx)
 *   • DNI (8 digits + letter) and NIE (X/Y/Z + 7 digits + letter)
 *   • URLs (http/https/www)
 *   • @handles (social mentions)
 *   • Long digit sequences that look like IDs / card numbers (≥ 8 digits)
 *
 * Output is clamped to MAX_CHARS to prevent prompt-injection via long payloads.
 *
 * SERVER-SIDE ONLY — never import from client components.
 */

const MAX_CHARS = 400;

/** Ordered list of [pattern, replacement] pairs applied sequentially. */
const REDACTION_RULES: [RegExp, string][] = [
  // Emails
  [/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, '[REDACTAT]'],

  // Spanish mobile / landline — optional +34 / 0034 prefix, then 6-9 leading digit
  [/(?:\+34|0034)?[\s.\-]?[6-9]\d{2}[\s.\-]?\d{3}[\s.\-]?\d{3}\b/g, '[REDACTAT]'],

  // DNI: 8 digits + uppercase letter (with optional separator)
  [/\b\d{8}[\s\-]?[A-Z]\b/g, '[REDACTAT]'],

  // NIE: X/Y/Z + 7 digits + uppercase letter
  [/\b[XYZ][\s\-]?\d{7}[\s\-]?[A-Z]\b/gi, '[REDACTAT]'],

  // URLs
  [/https?:\/\/[^\s"'<>]+/gi, '[REDACTAT]'],
  [/\bwww\.[^\s"'<>]+/gi, '[REDACTAT]'],

  // @social handles
  [/@[A-Za-z0-9_]{2,50}\b/g, '[REDACTAT]'],

  // Long digit sequences ≥ 8 consecutive digits (IBANs, card numbers, order IDs…)
  [/\b\d{8,}\b/g, '[REDACTAT]'],
];

/**
 * Sanitize a single text string before it is included in an LLM prompt.
 * Returns an empty string for non-string / falsy inputs.
 */
export function sanitizeForLLM(text: string): string {
  if (typeof text !== 'string') return '';
  let result = text;
  for (const [pattern, replacement] of REDACTION_RULES) {
    result = result.replace(pattern, replacement);
  }
  // Clamp to avoid prompt injection via very long payloads
  if (result.length > MAX_CHARS) {
    result = `${result.slice(0, MAX_CHARS - 1).trim()}…`;
  }
  return result;
}

/**
 * Sanitize an array of thread-context lines (user/assistant messages).
 * Each line is individually clamped and PII-stripped.
 * Returns at most `maxLines` lines.
 */
export function sanitizeThreadContext(lines: string[], maxLines = 10): string[] {
  return lines
    .slice(0, maxLines)
    .map((line) => sanitizeForLLM(line))
    .filter(Boolean);
}
