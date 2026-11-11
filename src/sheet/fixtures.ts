import type { EventResult, SheetInput } from '../contract';
import type { Core, Pattern, Voice, TopLevel } from '../document';

const pattern = (id: string, core: Core): Pattern => ({ id, tier: 1, core, layers: [] });
const voice = (id: string, name: string, core: Core): Voice => ({
  id,
  tier: 1,
  kind: 'voice',
  name,
  nameSource: 'author',
  muted: false,
  pattern: pattern(`${id}-pattern`, core),
});
const sequence = (): Core => ({
  kind: 'sequence',
  notation: 'a [b c]',
  steps: [
    { kind: 'value', value: 'a' },
    {
      kind: 'sub',
      steps: [
        { kind: 'value', value: 'b' },
        { kind: 'value', value: 'c' },
      ],
    },
  ],
});
const event = (
  start: number,
  end: number,
  value: unknown,
  signal = false,
): EventResult['events'][number] => ({
  whole: signal ? null : [start, end],
  part: [start, end],
  value,
  hasOnset: !signal,
});
const result = (events: EventResult['events']): EventResult => ({
  events,
  cps: 0.5,
  error: null,
  opaqueValues: false,
});
const input = (body: TopLevel[], events: SheetInput['events'], toCycle = 1): SheetInput => ({
  doc: { version: 1, body },
  events,
  fromCycle: 0,
  toCycle,
  playhead: 0.375,
  sounds: [
    { name: 'triangle', state: 'ready' },
    { name: 'sine', state: 'loading' },
  ],
});
const lead = voice('lead', 'Lantern', sequence());
lead.pattern.comment = 'This comment is never an instrument name';
lead.pattern.layers = [
  {
    id: 'lead-settings',
    tier: 1,
    kind: 'settings',
    settings: [
      {
        id: 'lead-s',
        tier: 1,
        name: 's',
        value: pattern('lead-s-value', { kind: 'constant', value: 'triangle' }),
      },
      {
        id: 'lead-gain',
        tier: 1,
        name: 'gain',
        value: pattern('lead-gain-value', { kind: 'constant', value: 0 }),
      },
      {
        id: 'lead-lpf',
        tier: 1,
        name: 'lpf',
        value: pattern('lead-lpf-value', {
          kind: 'sequence',
          notation: 'wrong on purpose',
          steps: [],
        }),
      },
    ],
  },
  {
    id: 'lead-fast',
    tier: 1,
    kind: 'rewrite',
    name: 'fast',
    args: [{ kind: 'literal', value: 2 }],
  },
  { id: 'lead-source', tier: 3, kind: 'opaque', code: '.customScore()' },
  { id: 'lead-rev', tier: 1, kind: 'rewrite', name: 'rev', args: [] },
];
const bass = voice('bass', 'Sine 1', sequence());
bass.nameSource = 'generated';
bass.pattern.comment = 'Do not call this the bass name';
bass.pattern.layers = [
  {
    id: 'bass-settings',
    tier: 1,
    kind: 'settings',
    settings: [
      {
        id: 'bass-pan',
        tier: 1,
        name: 'pan',
        value: pattern('bass-driver', { kind: 'signal', shape: 'sine' }),
      },
    ],
  },
];
const bell = voice('bell', 'Glass', sequence());
bell.muted = true;
export const trio = input([lead, bass, bell], {
  lead: result([
    event(0, 0.5, { note: 'c4', s: 'triangle', gain: 0, cutoff: 400 }),
    event(0.5, 0.75, { note: 'e4', s: 'triangle', gain: 0, cutoff: 2000 }),
    event(0.75, 1, { note: 'g4', s: 'triangle', gain: 0, cutoff: 700 }),
  ]),
  bass: result([
    event(0, 0.5, { note: 'c2', s: 'sine', pan: 0.1 }),
    event(0.5, 1, { note: 'g2', s: 'sine', pan: 0.9 }),
  ]),
  bell: result([event(0, 0.2, { note: 'c5', s: 'triangle', room: 0.3 })]),
});

const pulse = voice('pulse', 'Pulse', sequence());
const spark = voice('spark', 'Spark', sequence());
export const arrange = input(
  [
    ...[pulse, spark].map((v) => ({
      id: `shared-${v.id}`,
      tier: 1 as const,
      kind: 'shared' as const,
      name: v.name,
      pattern: { ...v.pattern, id: v.id },
    })),
    voice('song', 'Song', {
      kind: 'group',
      how: 'arrange',
      parts: ['Opening', 'Build', 'Space', 'Return'].map((label, index) => ({
        label,
        cycles: [2, 1, 3, 2][index],
        pattern: pattern(`section-${index}`, {
          kind: 'group',
          how: 'stack',
          parts: [pulse, spark].map((v) => ({
            muted: v.id === 'spark' && index === 2,
            pattern: pattern(`${v.id}-use-${index}`, { kind: 'ref', name: v.name }),
          })),
        }),
      })),
    }),
  ],
  {
    pulse: result([
      event(0, 2, { s: 'triangle' }),
      event(2, 3, { s: 'triangle' }),
      event(3, 6, { s: 'triangle' }),
      event(6, 8, { s: 'triangle' }),
    ]),
    spark: result([
      event(0, 2, { s: 'sine' }),
      event(2, 3, { s: 'sine' }),
      event(6, 8, { s: 'sine' }),
    ]),
  },
  8,
);
arrange.playhead = 4;

export const missing = input([voice('lost', 'Paper drum', sequence())], {
  lost: result([event(0, 0.6, { s: 'paper', gain: 0.7 })]),
});
missing.sounds = [{ name: 'paper', state: 'missing', detail: 'Sample collection is unavailable' }];
export const broken = input([voice('broken', 'Tangle', sequence())], {
  broken: { ...result([]), error: { phase: 'query', message: 'Cannot query custom rewrite' } },
});
export const dense = input([voice('dense', 'Pinpoints', sequence())], {
  dense: result(
    Array.from({ length: 640 }, (_, i) =>
      event(i / 640, (i + 0.6) / 640, { note: 48 + (i % 12), s: 'triangle' }),
    ),
  ),
});
export const irregular = input(
  [
    voice('odd', 'Folded rhythm', {
      kind: 'sequence',
      notation: 'a [b [c d]] e@3',
      steps: [
        { kind: 'value', value: 'a' },
        {
          kind: 'sub',
          steps: [
            { kind: 'value', value: 'b' },
            {
              kind: 'sub',
              steps: [
                { kind: 'value', value: 'c' },
                { kind: 'value', value: 'd' },
              ],
            },
          ],
        },
        { kind: 'value', value: 'e', weight: 3 },
      ],
    }),
    voice('signal', 'Drifting control', { kind: 'signal', shape: 'sine' }),
  ],
  {
    odd: result(
      [
        [0, 0.2],
        [0.2, 0.3],
        [0.3, 0.35],
        [0.35, 0.4],
        [0.4, 1],
      ].map(([a, b], i) => event(a, b, { note: 60 + i, s: 'triangle' })),
    ),
    signal: result([
      event(0, 0.25, 0.1, true),
      event(0.25, 0.5, 0.8, true),
      event(0.5, 0.75, 0.6, true),
      event(0.75, 1, 0.2, true),
    ]),
  },
);
export const fixtures = { trio, arrange, missing, broken, dense, irregular };
