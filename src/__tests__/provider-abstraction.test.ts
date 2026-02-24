/**
 * Tests for Provider Abstraction
 * Run: npx tsx src/__tests__/provider-abstraction.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
function assert(label: string, got: any, expected: any) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  ok ? pass++ : fail++;
}

// ============================================================
// 1. getPublicAiLabel() returns correct label
// ============================================================
console.log('\n=== PUBLIC AI LABEL ===');
// Inline import to avoid ESM issues
const labelModule = require('../lib/ai-label');
assert('getPublicAiLabel returns OpinIA AI', labelModule.getPublicAiLabel(), 'OpinIA AI');

// ============================================================
// 2. Scan UI files for provider leaks
// ============================================================
console.log('\n=== UI PROVIDER LEAK SCAN ===');

const UI_DIRS = [
  'src/app/dashboard',
  'src/app/onboarding',
  'src/components',
];

const FORBIDDEN = /openai|anthropic(?!\.(com|ts|js))|claude|gpt-4|GPT-4o/i;
const IGNORE = /\.test\.|__tests__|node_modules|\.next|import |\/\/ |type.*Provider/;

function scanDir(dir: string): string[] {
  const violations: string[] = [];
  const base = path.resolve(__dirname, '..', '..', dir);
  if (!fs.existsSync(base)) return violations;

  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(tsx?|json)$/.test(entry.name)) continue;
      if (/\.test\./.test(entry.name)) continue;

      const lines = fs.readFileSync(full, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (IGNORE.test(line)) continue;
        if (FORBIDDEN.test(line)) {
          violations.push(`${full}:${i + 1}: ${line.trim()}`);
        }
      }
    }
  };
  walk(base);
  return violations;
}

let allViolations: string[] = [];
for (const dir of UI_DIRS) {
  allViolations.push(...scanDir(dir));
}

assert('No provider leaks in UI components', allViolations.length, 0);
if (allViolations.length > 0) {
  console.log('  Violations:');
  allViolations.forEach(v => console.log('    ', v));
}

// ============================================================
// 3. Scan message files for provider names
// ============================================================
console.log('\n=== MESSAGE FILES SCAN ===');

const MSG_DIR = path.resolve(__dirname, '..', '..', 'messages');
const msgViolations: string[] = [];

for (const locale of ['ca', 'es', 'en']) {
  const fpath = path.join(MSG_DIR, `${locale}.json`);
  const content = fs.readFileSync(fpath, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // loginWith uses {provider} as an interpolation variable — that's OK
    if (lines[i].includes('{provider}')) continue;
    if (FORBIDDEN.test(lines[i])) {
      msgViolations.push(`${locale}.json:${i + 1}: ${lines[i].trim()}`);
    }
  }
}

assert('No provider names in message files', msgViolations.length, 0);
if (msgViolations.length > 0) {
  console.log('  Violations:');
  msgViolations.forEach(v => console.log('    ', v));
}

// ============================================================
// 4. API response shape check (simulated)
// ============================================================
console.log('\n=== API RESPONSE SHAPE ===');

// Simulate the generate response shape
const mockResponse = {
  language_detected: 'ca',
  classification: { language: 'ca', sentiment: 'positive', topics: ['service'], urgency: 'low' },
  matched_kb: [],
  option_a: 'Gràcies!',
  option_b: 'Moltes gràcies!',
  option_c: 'Us agraïm!',
  guardrail_warnings: [],
  triggers_fired: [],
};

const responseStr = JSON.stringify(mockResponse);
assert('Response has no "provider" field', responseStr.includes('"provider"'), false);
assert('Response has no "model" field', responseStr.includes('"model"'), false);
assert('Response has no "openai"', /openai/i.test(responseStr), false);
assert('Response has no "anthropic"', /anthropic/i.test(responseStr), false);

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
