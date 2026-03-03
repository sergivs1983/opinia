import * as fs from 'node:fs';
import * as path from 'node:path';

type ClassifiedRow = {
  route: string;
  cls: string;
  status: string;
};

type FullTableRow = {
  route: string;
  gate: string;
  note: string;
};

type GateCoverageRow = {
  route: string;
  cls: string;
  status: string;
  gate: string;
  note: string;
};

type WarningRouteRow = {
  route: string;
  cls: string;
  gate: 'NO';
  note: string;
};

type Report = {
  ok: boolean;
  docsPath: string;
  classifiedTotal: number;
  pendingOrUnknown: ClassifiedRow[];
  classes: Record<string, number>;
  fullTableRows: number; // only rows reconciled to CLASSIFIED routes
  noGateRows: GateCoverageRow[];
  noGateNonPublic: WarningRouteRow[];
  warnings: string[];
};

function splitMarkdownRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cols: string[] = [];
  let current = '';
  let escaped = false;
  for (const ch of trimmed) {
    if (ch === '\\') {
      escaped = !escaped;
      current += ch;
      continue;
    }
    if (ch === '|' && !escaped) {
      cols.push(current.trim());
      current = '';
      continue;
    }
    escaped = false;
    current += ch;
  }
  cols.push(current.trim());
  return cols;
}

function readDocs(docsPath: string): string {
  if (!fs.existsSync(docsPath)) {
    throw new Error(`Missing docs file: ${docsPath}`);
  }
  return fs.readFileSync(docsPath, 'utf8');
}

function extractBetween(content: string, startMarker: string, endMarker: string): string {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) return '';
  return content.slice(start + startMarker.length, end);
}

function parseClassified(content: string): ClassifiedRow[] {
  const tableSection = extractBetween(content, '<!-- WAVE2_CLASSIFIED_START -->', '<!-- WAVE2_CLASSIFIED_END -->');
  const rows: ClassifiedRow[] = [];

  for (const line of tableSection.split('\n')) {
    if (!line.trim().startsWith('| /api/')) continue;
    const cols = splitMarkdownRow(line);
    if (cols.length < 4) continue;
    rows.push({
      route: cols[0],
      cls: cols[1],
      status: cols[3],
    });
  }
  return rows;
}

function parseFullTable(content: string): FullTableRow[] {
  const title = "## Taula completa d'endpoints (tenant-data candidats)";
  const start = content.indexOf(title);
  if (start < 0) return [];
  const tail = content.slice(start + title.length);
  const end = tail.indexOf('## ENDPOINTS SENSE GATE');
  const body = end >= 0 ? tail.slice(0, end) : tail;

  const rows: FullTableRow[] = [];
  for (const line of body.split('\n')) {
    if (!line.trim().startsWith('| /api/')) continue;
    const cols = splitMarkdownRow(line);
    if (cols.length < 4) continue;
    rows.push({
      route: cols[0],
      gate: cols[3].toUpperCase(),
      note: cols[5] || '',
    });
  }
  return rows;
}

function buildReport(docsPath: string, strictGuard = false): Report {
  const content = readDocs(docsPath);
  const classified = parseClassified(content);
  const fullRows = parseFullTable(content);
  const fullByRoute = new Map(fullRows.map((r) => [r.route, r]));

  const pendingOrUnknown = classified.filter((r) => /PENDING|UNKNOWN/i.test(r.status));
  const classes: Record<string, number> = {};
  for (const row of classified) {
    classes[row.cls] = (classes[row.cls] || 0) + 1;
  }

  // Strict parsing: evaluate gate coverage only for routes listed in CLASSIFIED table.
  // This ignores legacy/unclassified rows from auxiliary sections.
  const reconciledRows: GateCoverageRow[] = classified.map((row) => {
    const full = fullByRoute.get(row.route);
    return {
      route: row.route,
      cls: row.cls,
      status: row.status,
      gate: (full?.gate || 'UNKNOWN').toUpperCase(),
      note: full?.note || '',
    };
  });

  const noGateRows = reconciledRows.filter((r) => r.gate === 'NO');
  const noGateNonPublic: WarningRouteRow[] = noGateRows
    .map((r) => ({
      route: r.route,
      cls: r.cls || 'UNCLASSIFIED',
      gate: 'NO' as const,
      note: r.note,
    }))
    .filter((r) => r.cls !== 'PUBLIC_NON_TENANT');

  const warnings: string[] = [];
  if (noGateNonPublic.length > 0) {
    warnings.push(
      `Found ${noGateNonPublic.length} route(s) with gate=NO outside PUBLIC_NON_TENANT in docs table.`,
    );
  }

  const ok = pendingOrUnknown.length === 0 && (!strictGuard || noGateNonPublic.length === 0);
  return {
    ok,
    docsPath,
    classifiedTotal: classified.length,
    pendingOrUnknown,
    classes,
    fullTableRows: reconciledRows.length,
    noGateRows,
    noGateNonPublic,
    warnings,
  };
}

function printReport(report: Report): void {
  console.log(`COVERAGE_CHECK=${report.ok ? 'OK' : 'FAIL'}`);
  console.log(`docs=${report.docsPath}`);
  console.log(`classified_total=${report.classifiedTotal}`);
  console.log(`pending_or_unknown=${report.pendingOrUnknown.length}`);
  console.log(`class_counts=${JSON.stringify(report.classes)}`);
  console.log(`full_table_rows=${report.fullTableRows}`);
  console.log(`gate_no_total=${report.noGateRows.length}`);
  console.log(`gate_no_non_public=${report.noGateNonPublic.length}`);

  if (report.pendingOrUnknown.length > 0) {
    console.log('pending_or_unknown_routes:');
    for (const row of report.pendingOrUnknown) {
      console.log(`- ${row.route} [${row.status}]`);
    }
  }

  if (report.warnings.length > 0) {
    console.log('warnings:');
    for (const warning of report.warnings) {
      console.log(`- ${warning}`);
    }
    console.log('warning_routes:');
    for (const row of report.noGateNonPublic) {
      const note = row.note.trim().length > 0 ? row.note : '<none>';
      console.log(`- route=${row.route} | class=${row.cls} | gate=${row.gate} | note=${note}`);
    }
  }
}

function main(): void {
  const strictGuard = process.argv.includes('--strict-guard');
  const docsPath = path.resolve(process.cwd(), 'docs/security/gate-audit.md');
  const report = buildReport(docsPath, strictGuard);
  printReport(report);
  if (!report.ok) process.exit(1);
}

main();
