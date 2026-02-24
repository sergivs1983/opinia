import { createZipBuffer, type ZipEntry } from '@/lib/zip';
import { normalizeWeekStartMonday } from '@/lib/planner';
import type { JsonObject } from '@/types/json';
import type { Business, ContentPlannerChannel, ContentPlannerStatus, ExportLanguage } from '@/types/database';

export interface ExportManifest {
  week_start: string;
  language: ExportLanguage;
  items_count: number;
  generated_at: string;
  request_id: string;
}

export interface WeeklyExportItem {
  id: string;
  scheduled_at: string;
  channel: ContentPlannerChannel;
  title: string;
  caption: string;
  cta: string;
  status: ContentPlannerStatus;
  asset_filename: string;
}

export interface WeeklyExportAssetFile {
  filename: string;
  data: Buffer;
}

export interface BuildWeeklyZipOptions {
  manifest: ExportManifest;
  items: WeeklyExportItem[];
  includeCsv: boolean;
  includeTexts: boolean;
  includeReadme: boolean;
  assetFiles: WeeklyExportAssetFile[];
}

const EXPORTS_BUCKET = 'exports';
const LANGUAGE_SET = new Set<ExportLanguage>(['ca', 'es', 'en']);

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatOrderLine(item: WeeklyExportItem, language: ExportLanguage): string {
  const date = new Date(item.scheduled_at);
  const when = Number.isNaN(date.getTime())
    ? item.scheduled_at
    : date.toLocaleString(language, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return `- ${when} | ${item.channel} | ${item.title}`;
}

function buildReadmeText(manifest: ExportManifest, items: WeeklyExportItem[]): string {
  const ordered = [...items].sort((a, b) => (
    new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
  ));
  const orderLines = ordered.length > 0
    ? ordered.map((item) => formatOrderLine(item, manifest.language)).join('\n')
    : '- (empty week)';

  const localized = {
    ca: {
      title: 'Pack setmanal d\'exportació (OpinIA)',
      intro: 'Aquest ZIP inclou assets, textos i planner de la setmana seleccionada.',
      order: 'Ordre recomanat de publicació:',
      notes: 'Revisa títol/caption abans de publicar i adapta CTA si cal.',
    },
    es: {
      title: 'Pack semanal de exportación (OpinIA)',
      intro: 'Este ZIP incluye assets, textos y planner de la semana seleccionada.',
      order: 'Orden recomendado de publicación:',
      notes: 'Revisa título/caption antes de publicar y adapta CTA si hace falta.',
    },
    en: {
      title: 'Weekly export pack (OpinIA)',
      intro: 'This ZIP includes assets, texts, and planner entries for the selected week.',
      order: 'Recommended publishing order:',
      notes: 'Review title/caption before publishing and adjust CTA if needed.',
    },
  }[manifest.language];

  return [
    localized.title,
    '',
    localized.intro,
    `${manifest.language.toUpperCase()} | week_start=${manifest.week_start}`,
    `generated_at=${manifest.generated_at}`,
    '',
    localized.order,
    orderLines,
    '',
    localized.notes,
  ].join('\n');
}

export function resolveExportLanguage(args: {
  requestedLanguage?: unknown;
  business?: {
    default_language?: unknown;
    locale?: unknown;
    language?: unknown;
  } | null;
  orgLocale?: unknown;
}): ExportLanguage {
  const candidates: unknown[] = [
    args.requestedLanguage,
    args.business?.language,
    args.business?.locale,
    args.business?.default_language,
    args.orgLocale,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && LANGUAGE_SET.has(candidate as ExportLanguage)) {
      return candidate as ExportLanguage;
    }
  }

  return 'ca';
}

export function buildExportStoragePaths(args: {
  businessId: string;
  exportId: string;
  weekStart: string;
  language: ExportLanguage;
  now?: Date;
}): { storageBucket: string; storagePath: string; objectPath: string } {
  const now = args.now || new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const normalizedWeekStart = normalizeWeekStartMonday(args.weekStart);
  const fileName = `weekly_pack_${normalizedWeekStart}_${args.language}_${args.exportId}.zip`;
  const objectPath = `${args.businessId}/${year}/${month}/${fileName}`;
  const storagePath = `${EXPORTS_BUCKET}/${objectPath}`;

  return {
    storageBucket: EXPORTS_BUCKET,
    storagePath,
    objectPath,
  };
}

export function exportStoragePathToObjectPath(storagePath: string, bucket: string = EXPORTS_BUCKET): string {
  const prefix = `${bucket}/`;
  if (storagePath.startsWith(prefix)) {
    return storagePath.slice(prefix.length);
  }
  return storagePath;
}

export function buildPlannerCsv(items: WeeklyExportItem[]): string {
  const header = ['scheduled_at', 'channel', 'title', 'caption', 'cta', 'asset_filename'];
  const lines = [header.join(',')];
  for (const item of items) {
    lines.push([
      csvEscape(item.scheduled_at),
      csvEscape(item.channel),
      csvEscape(item.title),
      csvEscape(item.caption),
      csvEscape(item.cta),
      csvEscape(item.asset_filename),
    ].join(','));
  }
  return lines.join('\n');
}

export function buildManifestJson(manifest: ExportManifest): JsonObject {
  return manifest as unknown as JsonObject;
}

export function buildWeeklyZip({
  manifest,
  items,
  includeCsv,
  includeTexts,
  includeReadme,
  assetFiles,
}: BuildWeeklyZipOptions): {
  zipBuffer: Buffer;
  entries: string[];
  plannerCsv: string | null;
  readme: string | null;
} {
  const entries: ZipEntry[] = [];
  const addedNames: string[] = [];

  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  entries.push({ name: 'manifest.json', data: manifestContent });
  addedNames.push('manifest.json');

  let plannerCsv: string | null = null;
  if (includeCsv) {
    plannerCsv = buildPlannerCsv(items);
    entries.push({ name: 'planner.csv', data: plannerCsv });
    addedNames.push('planner.csv');
  }

  if (includeTexts) {
    for (const item of items) {
      const textBody = [
        `title: ${item.title}`,
        `channel: ${item.channel}`,
        `scheduled_at: ${item.scheduled_at}`,
        '',
        'caption:',
        item.caption || '-',
        '',
        'cta:',
        item.cta || '-',
      ].join('\n');

      const fileName = `texts/${item.id}.txt`;
      entries.push({ name: fileName, data: textBody });
      addedNames.push(fileName);
    }
  }

  for (const asset of assetFiles) {
    const fileName = `assets/${asset.filename}`;
    entries.push({ name: fileName, data: asset.data });
    addedNames.push(fileName);
  }

  let readme: string | null = null;
  if (includeReadme) {
    readme = buildReadmeText(manifest, items);
    entries.push({ name: 'README.txt', data: readme });
    addedNames.push('README.txt');
  }

  const zipBuffer = createZipBuffer(entries);
  return {
    zipBuffer,
    entries: addedNames,
    plannerCsv,
    readme,
  };
}

export function sanitizeExportLanguage(input: unknown): ExportLanguage | null {
  if (typeof input !== 'string') return null;
  if (!LANGUAGE_SET.has(input as ExportLanguage)) return null;
  return input as ExportLanguage;
}

export type ExportBusinessRow = Pick<Business, 'id' | 'org_id' | 'default_language'> & {
  language?: string | null;
  locale?: string | null;
};
