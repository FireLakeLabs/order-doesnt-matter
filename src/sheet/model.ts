import type { SheetInput, SheetSoundState } from '../contract';
import {
  shared,
  instruments,
  sections,
  walk,
  type Arg,
  type Layer,
  type Pattern,
} from '../document';

export const DRAW_CAP = 200;
export interface Mark {
  start: number;
  end: number;
  value: unknown;
  signal: boolean;
  x: number;
  width: number;
  y: number;
}
export interface Cell {
  nodeId: string;
  name: string;
  kind: 'unused' | 'empty' | 'constant' | 'steps' | 'curve' | 'rhythm' | 'definition';
  summary: string;
  label: string;
  values: unknown[];
  changes: number;
  totalCount: number;
  marks: Mark[];
  path: string;
}
export interface Chip {
  nodeId: string;
  name: string;
  summary: string;
  source: boolean;
}
export interface Row {
  id: string;
  name: string;
  nameSource: 'author' | 'generated';
  muted: boolean;
  broken: string | null;
  status: string;
  sounds: SheetSoundState[];
  cells: Cell[];
  rewrites: Chip[];
  useNotes: string[];
  useTargets: { nodeId: string; text: string }[];
}
export interface Section {
  nodeId: string;
  name: string;
  start: number;
  cycles: number;
  width: number;
  current: boolean;
  instruments: {
    id: string;
    name: string;
    state: 'present' | 'absent' | 'unknown';
    text: string;
  }[];
}
export interface SheetModel {
  columns: string[];
  rows: Row[];
  sections: Section[];
  fromCycle: number;
  toCycle: number;
  playheadX: number | null;
  caption: string;
}
const canonical = (name: string) => (name === 'cutoff' ? 'lpf' : name === 'hcutoff' ? 'hpf' : name);
function text(value: unknown): string {
  try {
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  } catch {
    return '[opaque value]';
  }
}
const short = (value: string) => (value.length > 56 ? `${value.slice(0, 53)}…` : value);
const bag = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).map(([key, value]) => [canonical(key), value]))
    : { value };
function argument(arg: Arg): string {
  if (arg.kind === 'literal') return text(arg.value);
  if (arg.kind === 'opaque') return arg.code;
  if (arg.kind === 'callback') return `${arg.parameter ?? 'pattern'} ⇒ …`;
  const c = arg.pattern.core;
  return c.kind === 'constant'
    ? text(c.value)
    : c.kind === 'sequence'
      ? c.notation
      : c.kind === 'ref'
        ? c.name
        : c.kind;
}
function signal(doc: SheetInput['doc'], p: Pattern): boolean {
  let found = false;
  const seen = new Set<string>();
  function scan(p: Pattern) {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    walk(
      { version: 1, body: [{ id: 'scan', tier: 1, kind: 'shared', name: 'scan', pattern: p }] },
      (node) => {
        if (!('core' in node)) return;
        const core = (node as Pattern).core;
        if (core.kind === 'signal') found = true;
        if (core.kind === 'ref') {
          const target = shared(doc, core.name);
          if (target) scan(target);
        }
      },
    );
  }
  scan(p);
  return found;
}

/** Geometry uses scored whole spans; part only clips query visibility. No grid. */
function makeCell(
  name: string,
  nodeId: string,
  events: SheetInput['events'][string]['events'],
  used: boolean,
  driven: boolean,
  status: string,
  input: SheetInput,
  definitionValue?: unknown,
  definitionLabel?: string,
): Cell {
  if (definitionLabel !== undefined)
    return {
      nodeId,
      name,
      kind: 'definition',
      label: definitionLabel,
      summary: `${name}: definition ${definitionLabel}; use-site variations listed separately`,
      values: [],
      changes: 0,
      totalCount: 0,
      marks: [],
      path: '',
    };
  const samples = (used ? events : [])
    .flatMap((event) => {
      const values = bag(event.value);
      return name === 'rhythm' || Object.hasOwn(values, name)
        ? [
            {
              event,
              value:
                name === 'rhythm'
                  ? (values.note ?? values.n ?? values.value ?? 'event')
                  : (definitionValue ?? values[name]),
            },
          ]
        : [];
    })
    .sort((a, b) => a.event.part[0] - b.event.part[0]);
  const values = [...new Map(samples.map(({ value }) => [text(value), value])).values()];
  const totalCount = samples.length;
  const continuous = driven || samples.some(({ event }) => !event.whole);
  const kind: Cell['kind'] = !used
    ? 'unused'
    : !totalCount
      ? 'empty'
      : continuous
        ? 'curve'
        : name === 'rhythm'
          ? 'rhythm'
          : values.length === 1
            ? 'constant'
            : 'steps';
  const changes = samples.reduce(
    (n, sample, i) => n + Number(i > 0 && text(sample.value) !== text(samples[i - 1].value)),
    0,
  );
  const numeric = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const lo = numeric.length ? Math.min(...numeric) : 0,
    hi = numeric.length ? Math.max(...numeric) : 1;
  const x = (cycle: number) =>
    Math.max(
      0,
      Math.min(100, ((cycle - input.fromCycle) / (input.toCycle - input.fromCycle)) * 100),
    );
  // Evenly retain at most DRAW_CAP samples, including both ends of a dense window.
  const drawn =
    totalCount <= DRAW_CAP
      ? samples
      : Array.from(
          { length: DRAW_CAP },
          (_, i) => samples[Math.round((i * (totalCount - 1)) / (DRAW_CAP - 1))],
        );
  const marks = drawn.map(({ event, value }): Mark => {
    const [start, end] = event.whole ?? event.part;
    const y =
      typeof value === 'number' && Number.isFinite(value)
        ? 29 - (hi === lo ? 0.5 : (value - lo) / (hi - lo)) * 23
        : 6 + (values.findIndex((v) => text(v) === text(value)) % 6) * 4;
    return {
      start,
      end,
      value,
      signal: driven || !event.whole,
      x: x(start),
      width: x(end) - x(start),
      y,
    };
  });
  const curve = marks.filter((m) => m.signal);
  const path =
    curve.map((m, i) => `${i ? 'L' : 'M'}${m.x},${m.y}`).join(' ') +
    (curve.length ? ` L${curve.at(-1)!.x + curve.at(-1)!.width},${curve.at(-1)!.y}` : '');
  const range =
    numeric.length === values.length && values.length > 1
      ? `${Number(lo.toPrecision(4))} to ${Number(hi.toPrecision(4))}`
      : values.map(text).join(', ');
  const unpitched =
    name === 'rhythm' &&
    samples.every(({ event }) => {
      const value = bag(event.value);
      return (
        value.note === undefined &&
        value.n === undefined &&
        value.freq === undefined &&
        value.value === undefined
      );
    });
  const label =
    kind === 'unused'
      ? 'Not used'
      : kind === 'empty'
        ? status
        : unpitched
          ? `${totalCount} hit${totalCount === 1 ? '' : 's'}`
          : short(range);
  const summary = `${name}: ${kind === 'unused' ? 'not used' : kind === 'empty' ? status : `${unpitched ? `${totalCount} hits` : range}; ${changes} changes; ${kind}`}${totalCount > DRAW_CAP ? `; showing ${DRAW_CAP} of ${totalCount} events` : ''}`;
  return { nodeId, name, kind, summary, label, values, changes, totalCount, marks, path };
}

/** Membership is structural, independent of a query window or a failed query. */
function song(input: SheetInput, rows: Row[]): Section[] {
  const parts = sections(input.doc);
  const total = parts.at(-1) ? parts.at(-1)!.start + parts.at(-1)!.cycles : 0;
  const now = input.playhead === null ? null : ((input.playhead % total) + total) % total;
  return parts.map((part) => ({
    nodeId: part.id,
    name: part.name,
    start: part.start,
    cycles: part.cycles,
    width: (part.cycles / total) * 100,
    current: now !== null && now >= part.start && now < part.start + part.cycles,
    instruments: rows.map((row) => {
      const present = part.instrumentIds.includes(row.id);
      return {
        id: row.id,
        name: row.name,
        state: present ? 'present' : 'absent',
        text: `${row.name}: ${present ? 'in this section' : 'not in this section'}`,
      };
    }),
  }));
}
function layerNote(layer: Layer): string {
  if (layer.kind === 'opaque') return layer.code;
  if (layer.kind === 'rewrite')
    return `${layer.name} ${layer.args.map(argument).join(', ')}`.trim();
  return layer.settings
    .map((s) => `${canonical(s.name)} ${argument({ kind: 'pattern', pattern: s.value })}`)
    .join('; ');
}

export function sheetModel(input: SheetInput): SheetModel {
  if (
    !(
      Number.isFinite(input.fromCycle) &&
      Number.isFinite(input.toCycle) &&
      input.toCycle > input.fromCycle
    )
  )
    throw Error('Sheet window must be finite and increasing');
  const columns = new Set<string>();
  const songSections = sections(input.doc);
  const sources = instruments(input.doc).map((voice) => {
    const contextual = new Set(
      voice.uses.flatMap((use) =>
        use.layers.flatMap((layer) =>
          layer.kind === 'settings' ? layer.settings.map((s) => canonical(s.name)) : [],
        ),
      ),
    );
    const useNotes = [
      ...new Set(
        voice.uses.flatMap((use) => {
          if (!use.layers.length) return [];
          const section = songSections.find((section) =>
            use.path.some((node) => node.id === section.id),
          );
          return [`in ${section?.name ?? 'piece'}: ${use.layers.map(layerNote).join('; ')}`];
        }),
      ),
    ];
    const useTargets = [
      ...new Map(
        voice.uses
          .flatMap((use) => {
            const section = songSections.find((s) => use.path.some((n) => n.id === s.id));
            return use.layers.flatMap((layer) =>
              layer.kind === 'settings'
                ? layer.settings.map((setting) => ({
                    nodeId: setting.id,
                    text: `in ${section?.name ?? 'piece'}: ${layerNote({ ...layer, settings: [setting] })}`,
                  }))
                : [
                    {
                      nodeId: layer.id,
                      text: `in ${section?.name ?? 'piece'}: ${layerNote(layer)}`,
                    },
                  ],
            );
          })
          .map((note) => [note.nodeId, note]),
      ).values(),
    ];
    const rewrites: Chip[] = [];
    function gather(p: Pattern, seen = new Set<string>()) {
      const settings = new Map<
        string,
        { nodeId: string; driven: boolean; definitionValue?: unknown; definitionLabel?: string }
      >();
      if (seen.has(p.id)) return settings;
      seen = new Set(seen).add(p.id);
      const c = p.core;
      if (c.kind === 'ref') {
        const target = shared(input.doc, c.name);
        if (target) gather(target, seen).forEach((fact, name) => settings.set(name, fact));
      }
      if (c.kind === 'group')
        c.parts.forEach((part) =>
          gather(part.pattern, seen).forEach((fact, name) =>
            settings.set(name, { ...fact, driven: fact.driven || !!settings.get(name)?.driven }),
          ),
        );
      if (c.kind === 'generator' && ['note', 'n', 'freq', 's'].includes(c.name))
        settings.set(c.name, {
          nodeId: p.id,
          driven: c.args.some((a) => a.kind === 'pattern' && signal(input.doc, a.pattern)),
          definitionLabel: contextual.has(c.name) ? c.args.map(argument).join(', ') : undefined,
        });
      if (c.kind === 'opaque')
        rewrites.push({ nodeId: p.id, name: 'Source text', summary: short(c.code), source: true });
      for (const layer of p.layers) {
        if (layer.kind === 'settings')
          for (const s of layer.settings) {
            const name = canonical(s.name);
            settings.set(name, {
              nodeId: s.id,
              driven: signal(input.doc, s.value),
              definitionValue:
                contextual.has(name) && s.value.core.kind === 'constant'
                  ? s.value.core.value
                  : undefined,
              definitionLabel:
                contextual.has(name) && s.value.core.kind !== 'constant'
                  ? [
                      argument({ kind: 'pattern', pattern: s.value }),
                      ...s.value.layers.map(layerNote),
                    ].join(' · ')
                  : undefined,
            });
          }
        else
          rewrites.push(
            layer.kind === 'opaque'
              ? { nodeId: layer.id, name: 'Source text', summary: short(layer.code), source: true }
              : {
                  nodeId: layer.id,
                  name: layer.name,
                  summary: short(layer.args.map(argument).join(', ')),
                  source: false,
                },
          );
      }
      return settings;
    }
    const settings = gather(voice.pattern);
    const result = input.events[voice.id];
    const events = result?.error
      ? []
      : (result?.events ?? []).filter(
          (e) => e.part[0] < input.toCycle && e.part[1] > input.fromCycle,
        );
    settings.forEach((_, name) => columns.add(name));
    events.forEach((e) =>
      Object.keys(bag(e.value)).forEach((name) => {
        if (contextual.has(name) && !settings.has(name)) return;
        columns.add(name);
        if (!settings.has(name)) settings.set(name, { nodeId: voice.pattern.id, driven: false });
      }),
    );
    return { voice, result, events, settings, rewrites, useNotes, useTargets };
  });
  const ordered = [
    'rhythm',
    ...['note', 'n', 'freq', 's'].filter((name) => columns.has(name)),
    ...[...columns].filter((name) => !['note', 'n', 'freq', 's'].includes(name)),
  ];
  const rows: Row[] = sources.map((source) => {
    const { voice, result, events, settings, rewrites, useNotes, useTargets } = source;
    const broken = result?.error?.message ?? null;
    const status =
      broken !== null
        ? `Broken: ${broken}`
        : !result
          ? 'Not queried'
          : voice.muted || voice.pattern.muted
            ? 'Muted'
            : !events.length
              ? 'No events in this window'
              : `${events.length} event${events.length === 1 ? '' : 's'}`;
    const names = [
      ...new Set(
        (result?.error ? [] : (result?.events ?? [])).flatMap((e) =>
          [bag(e.value).s].flat().filter((v): v is string => typeof v === 'string'),
        ),
      ),
    ];
    const sounds = names.map(
      (name): SheetSoundState =>
        input.sounds.find((s) => s.name === name) ??
        input.sounds.find((s) => s.name === name.split(':')[0]) ?? {
          name,
          state: 'not-loaded',
        },
    );
    return {
      id: voice.id,
      name: voice.name,
      nameSource: voice.nameSource,
      muted: voice.muted || !!voice.pattern.muted,
      broken,
      status,
      sounds,
      rewrites,
      useNotes,
      useTargets,
      cells: ordered.map((name) =>
        makeCell(
          name,
          settings.get(name)?.nodeId ?? voice.pattern.id,
          events,
          name === 'rhythm' || settings.has(name),
          settings.get(name)?.driven ?? false,
          status,
          input,
          settings.get(name)?.definitionValue,
          settings.get(name)?.definitionLabel,
        ),
      ),
    };
  });
  const playheadX =
    input.playhead !== null && input.playhead >= input.fromCycle && input.playhead < input.toCycle
      ? ((input.playhead - input.fromCycle) / (input.toCycle - input.fromCycle)) * 100
      : null;
  return {
    columns: ordered,
    rows,
    sections: song(input, rows),
    fromCycle: input.fromCycle,
    toCycle: input.toCycle,
    playheadX,
    caption: `Cycles ${input.fromCycle}–${input.toCycle} · scored spans · at most ${DRAW_CAP} events drawn per cell`,
  };
}
