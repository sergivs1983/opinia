const PLACEHOLDER_REGEX = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

const ALLOWED_PLACEHOLDERS = new Set([
  'business_name',
  'reviewer_name',
  'rating',
  'review_text',
  'signature',
]);

export type RuleTemplateValidation = {
  valid: boolean;
  placeholders: string[];
  unknown_placeholders: string[];
};

export type RuleTemplateData = {
  business_name: string;
  reviewer_name: string;
  rating: string | number;
  review_text: string;
  signature: string;
};

function listPlaceholders(template: string): string[] {
  const placeholders: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = PLACEHOLDER_REGEX.exec(template)) !== null) {
    placeholders.push(match[1]);
  }
  return placeholders;
}

export function validateTemplate(template: string): RuleTemplateValidation {
  const safeTemplate = typeof template === 'string' ? template : '';
  const placeholders = listPlaceholders(safeTemplate);
  const unknown_placeholders = placeholders.filter((placeholder) => !ALLOWED_PLACEHOLDERS.has(placeholder));

  return {
    valid: unknown_placeholders.length === 0,
    placeholders,
    unknown_placeholders,
  };
}

export function renderTemplate(template: string, data: RuleTemplateData): string {
  const validation = validateTemplate(template);
  if (!validation.valid) {
    throw new Error(`template_invalid_placeholders:${validation.unknown_placeholders.join(',')}`);
  }

  const replacements: Record<string, string> = {
    business_name: data.business_name || '',
    reviewer_name: data.reviewer_name || '',
    rating: String(data.rating ?? ''),
    review_text: data.review_text || '',
    signature: data.signature || '',
  };

  return template.replace(PLACEHOLDER_REGEX, (_, key: string) => replacements[key] ?? '');
}
