import type { Arg, Core, Doc, Meta, Pattern, Step } from './types';
let serial = 0;
const meta = (): Meta => ({ id: `fixture-${serial++}`, tier: 1 });
const pattern = (core: Core): Pattern => ({ ...meta(), core, layers: [] });
const value = (value: string): Step => ({
  kind: 'value',
  value,
  weight: 2,
  repeat: 2,
  chance: 0.5,
});
const steps: Step[] = [
  value('a'),
  { kind: 'rest', was: 'b', weight: 2 },
  { kind: 'sub', steps: [value('c')], weight: 3 },
  { kind: 'alternate', steps: [value('d')] },
  { kind: 'together', steps: [value('e')] },
  { kind: 'euclid', step: value('f'), pulses: value('3'), steps: value('8'), rotation: value('1') },
  { kind: 'polymeter', steps: [value('g')], per: value('4') },
  { kind: 'choose', steps: [value('h'), value('i')] },
  { kind: 'other', notation: 'x@2' },
];
const args = (): Arg[] => [
  { kind: 'literal', name: 'options', value: { nested: [null, true, 2, 'x'] } },
  { kind: 'pattern', name: 'driver', pattern: pattern({ kind: 'constant', value: 2 }) },
  { kind: 'callback', name: 'rewrite', parameter: 'p', body: pattern({ kind: 'hole' }) },
  { kind: 'opaque', name: 'code', code: 'custom' },
];
const theme = pattern({ kind: 'sequence', steps, notation: 'a ~' });
Object.assign(theme, {
  label: 'theme',
  comment: 'An author comment',
  muted: false,
  role: 'rhythm',
  span: { start: 0, end: 4 },
});
const root = pattern({
  kind: 'group',
  how: 'arrange',
  parts: [
    { pattern: pattern({ kind: 'ref', name: 'theme' }), cycles: 2, label: 'Intro', muted: false },
    ...(
      [
        { kind: 'signal', shape: 'irand', args: args() },
        { kind: 'data', value: [1, { x: true }] },
        { kind: 'generator', name: 'custom', args: args() },
        { kind: 'opaque', code: 'custom()' },
      ] satisfies Core[]
    ).map((core) => ({ pattern: pattern(core) })),
  ],
});
root.layers = [
  {
    ...meta(),
    kind: 'settings',
    settings: [{ ...meta(), name: 'gain', value: pattern({ kind: 'constant', value: 0.5 }) }],
  },
  { ...meta(), kind: 'rewrite', name: 'off', args: args() },
  { ...meta(), kind: 'opaque', code: '.custom()' },
];
/** Synthetic contract fixture, not a program or third-party composition. */
export const fixture: Doc = {
  version: 1,
  body: [
    { ...meta(), kind: 'setup', code: 'const custom = 1', role: 'setup' },
    { ...meta(), kind: 'tempo', cpm: 120 },
    { ...meta(), kind: 'shared', name: 'theme', pattern: theme },
    {
      ...meta(),
      kind: 'voice',
      name: 'Example',
      nameSource: 'author',
      muted: false,
      pattern: root,
    },
    { ...meta(), kind: 'transform', name: 'all', args: args() },
  ],
};
