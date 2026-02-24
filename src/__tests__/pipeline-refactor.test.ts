/**
 * Pipeline Refactor Tests
 * Run: npx tsx src/__tests__/pipeline-refactor.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
function assert(label: string, got: unknown, expected: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `— got ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}
function includes(label: string, haystack: string, needle: string) {
  const ok = haystack.includes(needle);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `— not found: "${needle}"`);
  ok ? pass++ : fail++;
}
function notIncludes(label: string, haystack: string, needle: string) {
  const ok = !haystack.includes(needle);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `— still present: "${needle}"`);
  ok ? pass++ : fail++;
}

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(root, p));

// ═══════════════════════════════════════════
console.log('\n=== A: MODULE STRUCTURE ===');

const modules = ['types.ts', 'classify.ts', 'context.ts', 'generate.ts', 'guardrails.ts', 'triggers.ts', 'orchestrator.ts', 'index.ts'];
for (const m of modules) {
  assert(`pipeline/${m} exists`, exists(`src/lib/pipeline/${m}`), true);
}

// ═══════════════════════════════════════════
console.log('\n=== B: ROUTE IS SLIM ===');

const route = read('src/app/api/reviews/[reviewId]/generate/route.ts');
const routeLines = route.split('\n').length;
assert('Route is under 150 lines', routeLines <= 150, true);
includes('Route uses validateBody', route, 'validateBody');
includes('Route uses ReviewGenerateBodySchema', route, 'ReviewGenerateBodySchema');
includes('Route validates params with ReviewGenerateParamsSchema', route, 'ReviewGenerateParamsSchema');
includes('Route uses runPipeline', route, 'runPipeline');
notIncludes('Route has NO inline classification logic', route, 'callLLMClient');
notIncludes('Route has NO inline guardrail logic', route, 'checkFactValidation');
notIncludes('Route has NO inline prompt building', route, '<role>');
notIncludes('Route has NO generateFallback function', route, 'function generateFallback');
notIncludes('Route has NO buildSeoBlock function', route, 'function buildSeoBlock');
notIncludes('Route has NO matchAndFireTriggers function', route, 'function matchAndFireTriggers');

// ═══════════════════════════════════════════
console.log('\n=== C: TYPES ===');

const types = read('src/lib/pipeline/types.ts');
includes('Has PipelineInput type', types, 'PipelineInput');
includes('Has PipelineOutput type', types, 'PipelineOutput');
includes('Has Classification type', types, 'Classification');
includes('Has RAGContext type', types, 'RAGContext');
includes('Has GeneratedResponses type', types, 'GeneratedResponses');
includes('Has FiredTrigger type', types, 'FiredTrigger');
includes('Has Modifier type', types, 'Modifier');
includes('Imports from database.ts', types, "from '@/types/database'");
includes('Imports LLMProvider', types, "LLMProvider");

// ═══════════════════════════════════════════
console.log('\n=== D: CLASSIFY ===');

const classify = read('src/lib/pipeline/classify.ts');
includes('classify uses callLLMClient', classify, 'callLLMClient');
includes('classify has topic taxonomy', classify, 'service, staff, food, breakfast');
includes('classify has fallback', classify, 'defaultClassification');
includes('classify saves topics', classify, 'saveTopics');
notIncludes('classify has no : any', classify, ': any');

// ═══════════════════════════════════════════
console.log('\n=== E: CONTEXT (RAG) ===');

const context = read('src/lib/pipeline/context.ts');
includes('context matches KB triggers', context, 'match_score');
includes('context loads recent replies', context, 'recentReplies');
includes('context extracts openings/closings', context, 'recentOpenings');
includes('context sorts by score', context, 'sort((a, b)');

// ═══════════════════════════════════════════
console.log('\n=== F: GENERATE ===');

const generate = read('src/lib/pipeline/generate.ts');
includes('generate has buildPrompt function', generate, 'export function buildPrompt');
includes('generate has generateDrafts function', generate, 'export async function generateDrafts');
includes('generate has buildNegativeConstraints', generate, 'buildNegativeConstraints');
includes('generate has buildSeoBlock', generate, 'buildSeoBlock');
includes('generate has generateFallback', generate, 'generateFallback');
includes('generate uses callLLMClient', generate, 'callLLMClient');
includes('generate re-throws CircuitOpenError', generate, 'CircuitOpenError');
includes('generate has SEO rules (avoid_if_negative)', generate, 'avoid_if_negative');
includes('generate has SEO rules (max_keywords_per_reply)', generate, 'max_keywords_per_reply');
includes('generate has anti-repetition block', generate, '<anti_repetition>');
includes('generate has prohibited_phrases', generate, '<prohibited_phrases>');

// ═══════════════════════════════════════════
console.log('\n=== G: GUARDRAILS ===');

const guardrails = read('src/lib/pipeline/guardrails.ts');
includes('guardrails checks prices', guardrails, 'price_mention');
includes('guardrails checks times', guardrails, 'schedule_mention');
includes('guardrails checks percentages', guardrails, 'unverified_fact');
includes('guardrails checks formality', guardrails, 'Formalitat incorrecta');
includes('guardrails checks repetition (Jaccard)', guardrails, 'getGrams');
includes('guardrails checks SEO stuffing', guardrails, 'keyword stuffing');
includes('guardrails checks comma-separated lists', guardrails, 'llistat artificial');

// ═══════════════════════════════════════════
console.log('\n=== H: TRIGGERS ===');

const triggers = read('src/lib/pipeline/triggers.ts');
includes('triggers matches topics', triggers, 'match_topics');
includes('triggers matches phrases', triggers, 'match_phrases');
includes('triggers filters by rating', triggers, 'min_rating');
includes('triggers filters by sentiment', triggers, 'sentiment_filter');
includes('triggers fires notifications', triggers, "from('notifications')");

// ═══════════════════════════════════════════
console.log('\n=== I: ORCHESTRATOR ===');

const orch = read('src/lib/pipeline/orchestrator.ts');
includes('orchestrator checks panic mode', orch, 'panic_mode');
includes('orchestrator checks usage limit', orch, 'checkUsageLimit');
includes('orchestrator calls classifyReview', orch, 'classifyReview');
includes('orchestrator calls buildRAGContext', orch, 'buildRAGContext');
includes('orchestrator calls buildPrompt', orch, 'buildPrompt');
includes('orchestrator calls generateDrafts', orch, 'generateDrafts');
includes('orchestrator calls runGuardrails', orch, 'runGuardrails');
includes('orchestrator calls matchAndFireTriggers', orch, 'matchAndFireTriggers');
includes('orchestrator saves replies', orch, "from('replies')");
includes('orchestrator increments usage', orch, 'incrementUsage');
includes('orchestrator creates audit log', orch, 'audit(supabase');
includes('orchestrator handles CircuitOpenError', orch, 'CircuitOpenError');
includes('orchestrator returns typed result', orch, 'OrchestratorResult');

// ═══════════════════════════════════════════
console.log('\n=== J: TYPE SAFETY (no any) ===');

const allPipeline = [types, classify, context, generate, guardrails, triggers, orch].join('\n');
const anyCount = (allPipeline.match(/: any\b/g) || []).length;
assert('Pipeline modules have 0 ": any"', anyCount, 0);

// ═══════════════════════════════════════════
console.log('\n=== K: BARREL EXPORT ===');

const barrel = read('src/lib/pipeline/index.ts');
includes('Barrel exports runPipeline', barrel, 'runPipeline');
includes('Barrel exports PipelineInput', barrel, 'PipelineInput');

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
