import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { glass, glassStrong, glassActive, textMain, textSub, textMuted } from '../components/ui/glass';
import GlassCard from '../components/ui/GlassCard';
import Button from '../components/ui/Button';
import IconButton from '../components/ui/IconButton';
import Badge from '../components/ui/Badge';
import Chip from '../components/ui/Chip';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Toggle from '../components/ui/Toggle';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

// JSX in this repo is transpiled by Next (automatic runtime).
// Unit tests run with tsx + jsx=preserve, so we expose React globally.
(globalThis as { React?: typeof React }).React = React;

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

function render(component: React.ReactElement): string {
  return renderToStaticMarkup(component);
}

console.log('\n=== GLASS EXPORTS ===');
assert('glass export exists', typeof glass === 'string' && glass.includes('bg-white/5'));
assert('glassStrong export exists', typeof glassStrong === 'string' && glassStrong.includes('bg-white/10'));
assert('glassActive export exists', typeof glassActive === 'string' && glassActive.includes('border-brand-accent/40'));
assert('textMain export exists', textMain === 'text-white/90');
assert('textSub export exists', textSub === 'text-white/70');
assert('textMuted export exists', textMuted === 'text-white/55');

console.log('\n=== COMPONENT SMOKE ===');
assert(
  'GlassCard renders',
  render(React.createElement(GlassCard, { variant: 'glassStrong' }, 'Card content')).includes('Card content'),
);
assert(
  'Button renders primary',
  render(React.createElement(Button, { variant: 'primary' }, 'Action')).includes('Action'),
);
assert(
  'Button renders secondary',
  render(React.createElement(Button, { variant: 'secondary' }, 'Action')).includes('Action'),
);
assert(
  'Button renders ghost',
  render(React.createElement(Button, { variant: 'ghost' }, 'Action')).includes('Action'),
);
assert(
  'IconButton renders',
  render(React.createElement(IconButton, { icon: '•', label: 'icon-btn' })).includes('icon-btn'),
);
assert(
  'Badge renders with platform preset',
  render(React.createElement(Badge, { kind: 'platform', tone: 'google' }, 'Google')).includes('Google'),
);
assert(
  'Chip renders',
  render(React.createElement(Chip, { active: true }, 'Filter')).includes('Filter'),
);
assert(
  'Input renders',
  render(React.createElement(Input, { id: 'demo-input', placeholder: 'Type here' })).includes('demo-input'),
);
assert(
  'Select renders',
  render(
    React.createElement(Select, {
      id: 'demo-select',
      options: [
        { value: 'ca', label: 'Català' },
        { value: 'es', label: 'Español' },
      ],
    }),
  ).includes('demo-select'),
);
assert(
  'Toggle renders',
  render(React.createElement(Toggle, { checked: true, onChange: () => {}, label: 'toggle' })).includes('switch'),
);
assert(
  'Skeleton renders',
  render(React.createElement(Skeleton, { className: 'h-6' })).includes('skeleton'),
);
assert(
  'EmptyState renders',
  render(
    React.createElement(EmptyState, {
      title: 'No data',
      description: 'Try again later',
    }),
  ).includes('No data'),
);

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
