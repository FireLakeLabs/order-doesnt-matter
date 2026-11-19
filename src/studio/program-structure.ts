import {
  findById,
  instruments,
  shared,
  walk,
  type Arg,
  type Doc,
  type Layer,
  type Pattern,
} from '../document';
import type { Instrument, InstrumentUse } from '../document/instruments';
import { generate, generatePattern } from '../generate';
import { patternMethods } from '../import/registry';
import type { QueryEvents } from '../contract';
import type {
  ViewDriver,
  ViewProgramStructure,
  ViewSnapshot,
  ViewStructureLookup,
  ViewStructureStep,
  ViewUseTiming,
} from '../views/types';

interface Questions {
  query: QueryEvents;
  cancel(): void;
}
const unavailable = (reason: string): ViewSnapshot => ({ status: 'unavailable', reason });
const MAX_RESULTS = 64;
const MAX_PENDING = 32;

/** A separate, inert-until-asked score worker queue. At most one query runs and
 * 32 are outstanding; retain 64 completed results, only for the current Doc
 * identity (the app's immutable document revision). Old frame handles expire.
 * Queries use the same worker seam/budgets as the score, never the audio engine. */
export function createStructureCache(questions: Questions) {
  let document: Doc | null = null;
  let revision = 0;
  let structures = new Map<string, ViewProgramStructure>();
  const results = new Map<string, Promise<ViewSnapshot>>();
  interface Job {
    key: string;
    code: () => string;
    from: number;
    to: number;
    resolve: (value: ViewSnapshot) => void;
  }
  const queue: Job[] = [];
  let active: Job | undefined;
  function clear() {
    ++revision;
    results.clear();
    for (const job of [...queue.splice(0), ...(active ? [active] : [])])
      job.resolve(unavailable('This structure frame has expired'));
    active = undefined;
    questions.cancel();
  }
  function pump() {
    if (active) return;
    const job = queue.shift();
    if (!job) return;
    active = job;
    const version = revision;
    // Defer generation and query dispatch out of the view's synchronous frame.
    void Promise.resolve()
      .then(() => {
        if (version !== revision) return unavailable('This structure frame has expired');
        return questions
          .query(job.code(), job.from, job.to)
          .then((result): ViewSnapshot => ({ status: 'available', result }));
      })
      .catch((error: unknown) =>
        unavailable(error instanceof Error ? error.message : String(error)),
      )
      .then((result) => {
        if (version !== revision) return;
        job.resolve(result);
        active = undefined;
        // Pending entries are never evicted: repeated frames share their promise.
        while (results.size > MAX_RESULTS) {
          const pending = new Set(queue.map((item) => item.key));
          const oldest = [...results.keys()].find((key) => !pending.has(key));
          if (!oldest) break;
          results.delete(oldest);
        }
        pump();
      });
  }
  function ask(
    doc: Doc,
    key: string,
    range: { from: number; to: number },
    code: () => string,
  ): Promise<ViewSnapshot> {
    if (doc !== document) return Promise.resolve(unavailable('This structure frame has expired'));
    if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from)
      return Promise.resolve(unavailable('Expected a finite, increasing frame range'));
    const cacheKey = JSON.stringify([key, range.from, range.to]);
    const cached = results.get(cacheKey);
    if (cached) return cached;
    if (queue.length + Number(!!active) >= MAX_PENDING)
      return Promise.resolve(unavailable('Structure query queue is full; retry on a later frame'));
    const promise = new Promise<ViewSnapshot>((resolve) =>
      queue.push({ key: cacheKey, code, ...range, resolve }),
    );
    results.set(cacheKey, promise);
    pump();
    return promise;
  }
  return {
    forFrame(doc: Doc | null, range: { from: number; to: number }): ViewStructureLookup {
      if (doc !== document) {
        clear();
        document = doc;
        structures = new Map();
      }
      const version = revision;
      return {
        get(id) {
          if (!doc || version !== revision) return undefined;
          // Build metadata once per instrument/range, without evaluating Strudel.
          const key = JSON.stringify([id, range.from, range.to]);
          const cached = structures.get(key);
          if (cached) return cached;
          const row = instruments(doc).find((instrument) => instrument.id === id);
          if (!row) return undefined;
          const structure = describe(doc, row, range, (key, code) =>
            version === revision
              ? ask(doc, key, range, code)
              : Promise.resolve(unavailable('This structure frame has expired')),
          );
          structures.set(key, structure);
          const oldest = structures.keys().next().value;
          if (structures.size > MAX_RESULTS && oldest) structures.delete(oldest);
          return structure;
        },
      };
    },
    dispose() {
      clear();
      document = null;
      structures.clear();
    },
  };
}

/** Mirror only affine score-time operations. In particular arrange keeps a
 * section's speed and advances it by its duration on the next song turn.
 * Source-only ancestry and non-affine rewrites deliberately have no mapping. */
function useTiming(
  doc: Doc,
  use: InstrumentUse,
  range: { from: number; to: number },
): ViewUseTiming {
  const unknown = (reason: string): ViewUseTiming => ({ status: 'unavailable', reason });
  if (doc.body.some((node) => node.kind === 'transform'))
    return unknown('Global score transforms have no established driver timing');
  let spans = [{ ...range, offset: 0, scale: 1 }];
  for (let index = 1; index < use.path.length - 1; index++) {
    const node = use.path[index];
    if (!('core' in node)) continue;
    if (node.origin) return unknown('Localized instrument timing is unavailable');
    for (const layer of [...node.layers].reverse()) {
      if (layer.kind === 'settings') continue;
      if (layer.kind !== 'rewrite' || !['fast', 'slow', 'early', 'late'].includes(layer.name))
        return unknown('Non-affine use-site rewrite');
      const arg = layer.args.length ? layer.args[0] : undefined;
      const value =
        arg?.kind === 'literal'
          ? arg.value
          : arg?.kind === 'pattern' &&
              arg.pattern.layers.length === 0 &&
              arg.pattern.core.kind === 'constant'
            ? arg.pattern.core.value
            : null;
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (['fast', 'slow'].includes(layer.name) && value <= 0)
      )
        return unknown('Patterned or invalid use-site time transform');
      spans = spans.map((span) => ({
        ...span,
        offset:
          span.offset +
          span.scale * (layer.name === 'late' ? value : layer.name === 'early' ? -value : 0),
        scale: span.scale * (layer.name === 'fast' ? 1 / value : layer.name === 'slow' ? value : 1),
      }));
    }
    if (node.core.kind === 'group') {
      if (node.core.how === 'stack') continue;
      if (node.core.how !== 'arrange') return unknown('Unsupported group timing');
      const parts = node.core.parts;
      const partIndex = parts.findIndex((part) => part.id === use.path[index + 1]?.id);
      const durations = parts.map((part) => part.cycles ?? 1);
      const total = durations.reduce((sum, value) => sum + value, 0);
      if (partIndex < 0 || durations.some((value) => !Number.isFinite(value) || value <= 0))
        return unknown('Invalid arrangement timing');
      const start = durations.slice(0, partIndex).reduce((sum, value) => sum + value, 0);
      const duration = durations[partIndex];
      const next: typeof spans = [];
      for (const span of spans) {
        const first = Math.floor((span.from - span.offset) / span.scale / total);
        const last = Math.ceil((span.to - span.offset) / span.scale / total);
        if (last - first > 512) return unknown('Arrangement timing range is too large');
        for (let turn = first; turn < last; turn++) {
          const from = Math.max(span.from, span.offset + span.scale * (turn * total + start));
          const to = Math.min(
            span.to,
            span.offset + span.scale * (turn * total + start + duration),
          );
          if (from < to)
            next.push({
              from,
              to,
              offset: span.offset + span.scale * (turn * (total - duration) + start),
              scale: span.scale,
            });
        }
      }
      spans = next;
    } else if (node.core.kind !== 'ref') return unknown('Unsupported ancestry timing');
    if (
      spans.some(
        (span) => !Number.isFinite(span.offset) || !Number.isFinite(span.scale) || span.scale <= 0,
      )
    )
      return unknown('Invalid use-site time mapping');
  }
  return { status: 'available', spans };
}

type Ask = (key: string, code: () => string) => Promise<ViewSnapshot>;

/** Conservative source boundary, not an implementation of any rewrite. */
function opaquePattern(doc: Doc, pattern: Pattern, seen = new Set<string>()): string | null {
  if (seen.has(pattern.id)) return 'Cyclic pattern reference';
  seen = new Set(seen).add(pattern.id);
  const c = pattern.core;
  let reason: string | null = null;
  if (c.kind === 'opaque') reason = 'Source-only phrase';
  else if (c.kind === 'hole') reason = 'Callback parameter has no standalone score';
  else if (c.kind === 'ref') {
    const target = shared(doc, c.name);
    reason = target ? opaquePattern(doc, target, seen) : `Unresolved reference: ${c.name}`;
  } else if (c.kind === 'generator' || c.kind === 'signal')
    reason = opaqueArgs(doc, c.args ?? [], seen);
  else if (c.kind === 'group')
    reason = c.parts.map((part) => opaquePattern(doc, part.pattern, seen)).find(Boolean) ?? null;
  return (
    reason ?? pattern.layers.map((layer) => opaqueLayer(doc, layer, seen)).find(Boolean) ?? null
  );
}
function opaqueArgs(doc: Doc, args: Arg[], seen: Set<string>): string | null {
  for (const arg of args) {
    if (arg.kind === 'callback') return 'Callback snapshots are not yet supported';
    if (arg.kind === 'opaque') return 'Source-only argument';
    if (arg.kind === 'pattern') {
      const reason = opaquePattern(doc, arg.pattern, seen);
      if (reason) return reason;
    }
  }
  return null;
}
function opaqueLayer(doc: Doc, layer: Layer, seen = new Set<string>()): string | null {
  if (layer.kind === 'opaque') return 'Source-only chain step';
  if (layer.kind === 'settings')
    return (
      layer.settings.map((setting) => opaquePattern(doc, setting.value, seen)).find(Boolean) ?? null
    );
  if (!patternMethods.has(layer.name)) return `Unknown method: ${layer.name}`;
  return opaqueArgs(doc, layer.args, seen);
}

function describe(
  doc: Doc,
  row: Instrument,
  range: { from: number; to: number },
  ask: Ask,
): ViewProgramStructure {
  const { pattern, id: instrument } = row;
  // Metadata belongs to the view; never hand out mutable references into the Doc.
  const exposed = structuredClone(pattern);
  const steps: ViewStructureStep[] = [
    {
      kind: 'phrase',
      id: pattern.id,
      core: exposed.core,
      opaque: opaquePattern(doc, { ...pattern, layers: [] }),
    },
  ];
  const prefixes: Layer[][] = [[]];
  const prefix: Layer[] = [];
  for (const layer of exposed.layers) {
    if (layer.kind === 'settings') {
      const settings: typeof layer.settings = [];
      for (const setting of layer.settings) {
        settings.push(setting);
        steps.push({
          kind: 'setting',
          id: setting.id,
          layerId: layer.id,
          name: setting.name,
          args: [{ kind: 'pattern', pattern: setting.value }],
          driver: driver(doc, setting.value, ask),
          opaque: opaquePattern(doc, setting.value),
        });
        prefixes.push([...prefix, { ...layer, settings: [...settings] }]);
      }
    } else {
      steps.push(
        layer.kind === 'rewrite'
          ? {
              kind: 'rewrite',
              id: layer.id,
              name: layer.name,
              args: layer.args,
              opaque: opaqueLayer(doc, layer),
            }
          : { kind: 'opaque', id: layer.id, code: layer.code, opaque: 'Source-only chain step' },
      );
      prefixes.push([...prefix, layer]);
    }
    prefix.push(layer);
  }
  // Localized copies can have a different chain. No single prefix describes them.
  const contextReasons: string[] = [];
  walk(doc, (node) => {
    if ('core' in node && (node as Pattern).origin === pattern.id)
      contextReasons.push('Localized instrument copies have separate chains');
  });
  for (const step of steps) step.opaque ??= contextReasons[0] ?? null;
  // Keep generation inputs private even if a consumer mutates its descriptions.
  const savedPrefixes = structuredClone(prefixes);
  const addresses = steps.map((step) => ({ id: step.id, opaque: step.opaque }));
  return {
    instrument,
    from: range.from,
    to: range.to,
    steps,
    context: {
      uses: row.uses.map((use) => ({
        voiceId: use.voiceId,
        pathIds: use.path.map((node) => node.id),
        layers: structuredClone(use.layers),
        timing: useTiming(doc, use, range),
      })),
      transforms: structuredClone(doc.body.filter((node) => node.kind === 'transform')),
    },
    snapshot(index) {
      if (!Number.isInteger(index) || index < 0 || index >= addresses.length)
        return Promise.resolve(unavailable('No such chain step'));
      const reason = addresses.slice(0, index + 1).find((step) => step.opaque)?.opaque;
      if (reason) return Promise.resolve(unavailable(reason));
      return ask(`snapshot:${instrument}:${addresses[index].id}`, () => {
        const visual = structuredClone(doc);
        walk(visual, (node) => {
          if ('muted' in node) node.muted = false;
        });
        const target = findById(visual, pattern.id) as Pattern;
        target.layers = savedPrefixes[index];
        return generate(visual, { only: instrument });
      });
    },
  };
}

function driver(doc: Doc, pattern: Pattern, ask: Ask): ViewDriver {
  const reason = opaquePattern(doc, pattern);
  let root = pattern;
  const seen = new Set<string>();
  const chains: Pattern[] = [];
  while (!seen.has(root.id)) {
    seen.add(root.id);
    chains.unshift(root);
    if (root.core.kind !== 'ref') break;
    const target = shared(doc, root.core.name);
    if (!target) break;
    root = target;
  }
  const core = root.core;
  const kind = reason
    ? 'opaque'
    : core.kind === 'signal'
      ? 'signal'
      : core.kind === 'constant' && !chains.some((p) => p.layers.length)
        ? 'constant'
        : 'values';
  const query = (key: string, p: Pattern) => {
    const why = opaquePattern(doc, p);
    if (why) return () => Promise.resolve(unavailable(why));
    const expression = generatePattern(p);
    return () =>
      ask(key, () => {
        const context: Doc = {
          ...doc,
          body: doc.body.filter((node) => ['setup', 'tempo', 'shared'].includes(node.kind)),
        };
        return `${generate(context)}\nstack(${expression})`;
      });
  };
  const layers = chains.flatMap((p) => p.layers);
  return {
    kind,
    time: 'definition',
    pattern: structuredClone(pattern),
    opaque: reason,
    events: query(`driver:${pattern.id}`, pattern),
    rates: layers.flatMap((layer, index) => {
      if (layer.kind !== 'rewrite' || !['fast', 'slow'].includes(layer.name)) return [];
      const argument = layer.args.length ? layer.args[0] : undefined;
      const opaque = layers
        .slice(index + 1)
        .some(
          (outer) =>
            outer.kind === 'opaque' ||
            (outer.kind === 'rewrite' && !['range', 'rangex'].includes(outer.name)),
        )
        ? 'Rate timing through later driver rewrites is not yet supported'
        : opaqueArgs(doc, layer.args, new Set());
      return [
        {
          id: layer.id,
          name: layer.name as 'fast' | 'slow',
          args: structuredClone(layer.args),
          time: 'argument',
          opaque,
          events: opaque
            ? () => Promise.resolve(unavailable(opaque))
            : argument?.kind === 'pattern'
              ? query(`rate:${layer.id}`, argument.pattern)
              : argument?.kind === 'literal'
                ? query(`rate:${layer.id}`, {
                    id: layer.id,
                    tier: layer.tier,
                    core: { kind: 'data', value: argument.value },
                    layers: [],
                  })
                : () => Promise.resolve(unavailable('Source-only rate argument')),
        },
      ];
    }),
  };
}
