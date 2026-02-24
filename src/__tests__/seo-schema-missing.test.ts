/**
 * SEO schema-missing UI + audit dedupe checks.
 * Run: npx tsx src/__tests__/seo-schema-missing.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  getSeoSchemaMissingAuditKey,
  hasSeoSchemaColumns,
  markSeoSchemaMissingAudit,
} from '../lib/seo-schema';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

class MemoryStorage {
  private data = new Map<string, string>();

  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

console.log('\n=== SEO SCHEMA DETECTION ===');
assert(
  'Incomplete schema returns false',
  hasSeoSchemaColumns({ seo_enabled: true, seo_keywords: ['hotel'] }) === false
);
assert(
  'Complete schema returns true (seo_aggressiveness)',
  hasSeoSchemaColumns({
    seo_enabled: true,
    seo_keywords: ['hotel'],
    seo_aggressiveness: 2,
  }) === true
);
assert(
  'Complete schema returns true (seo_aggressivity)',
  hasSeoSchemaColumns({
    seo_enabled: true,
    seo_keywords: ['hotel'],
    seo_aggressivity: 2,
  }) === true
);

console.log('\n=== AUDIT DEDUPE ===');
const storage = new MemoryStorage();
assert(
  'First audit mark for org returns true',
  markSeoSchemaMissingAudit(storage, 'org-1') === true
);
assert(
  'Second audit mark for same org returns false',
  markSeoSchemaMissingAudit(storage, 'org-1') === false
);
assert(
  'Different org still returns true',
  markSeoSchemaMissingAudit(storage, 'org-2') === true
);
assert(
  'Audit localStorage key is namespaced by org',
  getSeoSchemaMissingAuditKey('org-1') === 'opinia.audit.seo-schema-missing.org-1'
);

console.log('\n=== UI WIRING ===');
const voiceSettings = read('src/components/settings/VoiceSettings.tsx');
assert(
  'Badge text is present',
  voiceSettings.includes('SEO no disponible en aquest entorn')
);
assert(
  'SEO toggle is disabled when schema is missing',
  voiceSettings.includes('data-testid="settings-seo-toggle"') && voiceSettings.includes('disabled={seoSchemaMissing}')
);
assert(
  'SEO controls render in schema-missing mode',
  voiceSettings.includes('(seoMode || seoSchemaMissing)')
);
assert(
  'SEO keywords input is disabled when schema is missing',
  voiceSettings.includes('data-testid="settings-seo-keywords"') && voiceSettings.includes('disabled={seoSchemaMissing}')
);

console.log('\n=== AUDIT ACTION REGISTRY ===');
const audit = read('src/lib/audit.ts');
assert(
  'SEO_SCHEMA_MISSING is included in AuditAction union',
  audit.includes("'SEO_SCHEMA_MISSING'")
);
assert(
  'SEO_SCHEMA_MISSING has label',
  audit.includes("SEO_SCHEMA_MISSING: 'Schema SEO no disponible'")
);
assert(
  'SEO_SCHEMA_MISSING has icon',
  audit.includes("SEO_SCHEMA_MISSING: '⚠️'")
);

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
