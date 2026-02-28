export type ReviewTriageInput = {
  rating?: number | null;
  text?: string | null;
  language?: string | null;
};

export type KeywordFlags = {
  refund: boolean;
  dirty: boolean;
  rude: boolean;
  late: boolean;
  great: boolean;
  recommend: boolean;
};

export type ReviewTriage = {
  rating: number;
  has_text: boolean;
  text_len: number;
  has_question_mark: boolean;
  keyword_flags: KeywordFlags;
  language: string | null;
  timestamp: string;
};

const KEYWORD_REGEX: Record<keyof KeywordFlags, RegExp> = {
  refund: /\brefund\b/i,
  dirty: /\bdirty\b/i,
  rude: /\brude\b/i,
  late: /\blate\b/i,
  great: /\bgreat\b/i,
  recommend: /\brecommend(?:ed|s|ation)?\b/i,
};

function safeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampRating(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  const rating = Math.trunc(Number(value));
  if (rating < 0) return 0;
  if (rating > 5) return 5;
  return rating;
}

export function buildTriage(input: ReviewTriageInput): ReviewTriage {
  const text = safeText(input.text);
  const keyword_flags: KeywordFlags = {
    refund: KEYWORD_REGEX.refund.test(text),
    dirty: KEYWORD_REGEX.dirty.test(text),
    rude: KEYWORD_REGEX.rude.test(text),
    late: KEYWORD_REGEX.late.test(text),
    great: KEYWORD_REGEX.great.test(text),
    recommend: KEYWORD_REGEX.recommend.test(text),
  };

  return {
    rating: clampRating(input.rating),
    has_text: text.length > 0,
    text_len: text.length,
    has_question_mark: text.includes('?'),
    keyword_flags,
    language: input.language?.trim() || null,
    timestamp: new Date().toISOString(),
  };
}
