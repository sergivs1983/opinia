/**
 * Design System Tests — verify tokens, components, theme support
 * Run: npx tsx src/__tests__/design-system.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
function assert(label: string, got: any, expected: any) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `— got ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}
function includes(label: string, haystack: string, needle: string) {
  const ok = haystack.includes(needle);
  console.log(ok ? '✅' : '❌', label);
  ok ? pass++ : fail++;
}

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

// ═══════════════════════════════════════════
console.log('\n=== A: CSS TOKENS (globals.css) ===');
const css = read('src/app/globals.css');
includes('Has :root light tokens', css, '--color-bg:');
includes('Has .dark dark tokens', css, '.dark {');
includes('Has --color-brand', css, '--color-brand:');
includes('Has --color-text', css, '--color-text:');
includes('Has --color-border', css, '--color-border:');
includes('Has --radius-lg', css, '--radius-lg:');
includes('Has --shadow-md', css, '--shadow-md:');
includes('Has --transition-base', css, '--transition-base:');
includes('Has .card class', css, '.card {');
includes('Has .badge class', css, '.badge {');
includes('Has .nav-item class', css, '.nav-item {');
includes('Has .dropdown class', css, '.dropdown {');
includes('Has .skeleton class', css, '.skeleton {');
includes('Has .separator class', css, '.separator');
assert('No hardcoded body bg-white (uses var)', css.includes('background: var(--color-bg)'), true);

// ═══════════════════════════════════════════
console.log('\n=== B: TAILWIND CONFIG ===');
const tw = read('tailwind.config.ts');
includes('Has darkMode: class', tw, 'darkMode: "class"');
includes('Has CSS var colors', tw, 'var(--color-');
includes('Keeps brand scale (backward compat)', tw, 'brand:');
includes('Keeps surface scale (backward compat)', tw, 'surface:');

// ═══════════════════════════════════════════
console.log('\n=== C: THEME SYSTEM ===');
const theme = read('src/components/theme/ThemeProvider.tsx');
includes('ThemeProvider exists', theme, 'ThemeProvider');
includes('Has light/dark/system', theme, "'light' | 'dark' | 'system'");
includes('Uses localStorage', theme, 'localStorage');
includes('Listens to prefers-color-scheme', theme, 'prefers-color-scheme');
includes('Adds .dark class', theme, "classList.add(resolved)");

const toggle = read('src/components/theme/ThemeToggle.tsx');
includes('ThemeToggle exists', toggle, 'ThemeToggle');
includes('ThemeToggle has aria-label', toggle, 'aria-label');

// ═══════════════════════════════════════════
console.log('\n=== D: COMPONENTS ===');

// Button
const btn = read('src/components/ui/Button.tsx');
includes('Button uses CSS vars', btn, 'var(--color-');
includes('Button has focus-visible', btn, 'focus-visible');
includes('Button has disabled state', btn, 'disabled:opacity');

// Input
const inp = read('src/components/ui/Input.tsx');
includes('Input uses CSS vars', inp, 'var(--color-');
includes('Input has focus ring', inp, 'focus:ring');

// Card
assert('Card.tsx exists', fs.existsSync(path.join(root, 'src/components/ui/Card.tsx')), true);
const card = read('src/components/ui/Card.tsx');
includes('Card uses .card class', card, "'card'");

// Badge
assert('Badge.tsx exists', fs.existsSync(path.join(root, 'src/components/ui/Badge.tsx')), true);
const badge = read('src/components/ui/Badge.tsx');
includes('Badge uses CSS vars', badge, 'var(--color-');

// Tabs
assert('Tabs.tsx exists', fs.existsSync(path.join(root, 'src/components/ui/Tabs.tsx')), true);
const tabs = read('src/components/ui/Tabs.tsx');
includes('Tabs has role=tablist', tabs, "role=\"tablist\"");
includes('Tabs has aria-selected', tabs, 'aria-selected');

// Select
assert('Select.tsx exists', fs.existsSync(path.join(root, 'src/components/ui/Select.tsx')), true);

// Toast
assert('Toast.tsx exists', fs.existsSync(path.join(root, 'src/components/ui/Toast.tsx')), true);
const toast = read('src/components/ui/Toast.tsx');
includes('Toast has success/error/warning/info', toast, "'success' | 'error'");

// ═══════════════════════════════════════════
console.log('\n=== E: LAYOUT ===');
const layout = read('src/app/dashboard/layout.tsx');
includes('Layout uses SVG icons (no emojis in nav)', layout, '<svg width');
includes('Layout has ThemeToggle', layout, 'ThemeToggle');
includes('Layout has LanguageSwitcher', layout, 'LanguageSwitcher');
includes('Layout has mobile bottom nav', layout, 'md:hidden fixed bottom-0');
includes('Layout uses CSS var bg', layout, "var(--color-bg");
includes('Layout has backdrop-blur', layout, 'backdrop-blur');
includes('Layout uses nav-item class', layout, 'nav-item');

// Root layout
const root_layout = read('src/app/layout.tsx');
includes('Root layout has ThemeProvider', root_layout, 'ThemeProvider');
includes('Root layout has ToastProvider', root_layout, 'ToastProvider');
includes('Root layout has suppressHydrationWarning', root_layout, 'suppressHydrationWarning');

// ═══════════════════════════════════════════
console.log('\n=== F: BACKWARD COMPAT ===');
includes('Button still exports default', btn, 'export default');
includes('Input still exports default', inp, 'export default');
includes('Layout still has WorkspaceProvider', layout, 'WorkspaceProvider');
includes('Layout still has switchOrg', layout, 'switchOrg');
includes('Layout still has switchBiz', layout, 'switchBiz');

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
