import { shared, voices } from './index';
import type { Doc, Layer, Pattern, Voice, GroupPart } from './types';

export interface InstrumentUse {
  voiceId: string;
  /** Evaluation ancestry, including references and the definition itself. */
  path: (Voice | Pattern | GroupPart)[];
  /** Inner to outer; excludes the instrument definition's own layers. */
  layers: Layer[];
  muted: boolean;
}
export interface Instrument {
  id: string;
  name: string;
  nameSource: 'author' | 'generated';
  pattern: Pattern;
  uses: InstrumentUse[];
  muted: boolean;
}
export interface SongSection {
  id: string;
  name: string;
  nameSource: 'author' | 'generated';
  start: number;
  cycles: number;
  instrumentIds: string[];
}
const author = (name?: string) => (name?.trim() && !/^[_$]+$/.test(name.trim()) ? name : undefined);
function resolve(doc: Doc, p: Pattern, seen = new Set<string>()): Pattern {
  if (seen.has(p.id) || p.core.kind !== 'ref') return p;
  seen.add(p.id);
  const target = shared(doc, p.core.name);
  return target ? resolve(doc, target, seen) : p;
}
function sound(p: Pattern): string | undefined {
  let value: Pattern | undefined;
  for (const layer of p.layers)
    if (layer.kind === 'settings')
      for (const setting of layer.settings)
        if (['s', 'sound'].includes(setting.name)) value = setting.value;
  const core = value?.core ?? p.core;
  if (core.kind === 'generator' && ['s', 'sound'].includes(core.name)) {
    const arg = core.args[0];
    if (arg?.kind === 'literal' && typeof arg.value === 'string')
      return arg.value.match(/[\w:.-]+/)?.[0];
    if (arg?.kind === 'pattern') return sound(arg.pattern);
  }
  const text =
    core.kind === 'sequence' ? core.notation : core.kind === 'constant' ? String(core.value) : '';
  return text.match(/[\w:.-]+/)?.[0];
}

/** Leaves of group/ref traversal. Settings and rewrite arguments belong to a leaf,
 * not to separate instruments. Shared leaves deduplicate by definition identity. */
export function instruments(doc: Doc, { origins = true } = {}): Instrument[] {
  const rows = new Map<string, Instrument>();
  const definitions = doc.body.filter((n) => n.kind === 'shared');
  const byId = new Map<string, Pattern>();
  // Index score patterns only: drivers and rewrite arguments are not instruments.
  function index(p: Pattern) {
    byId.set(p.id, p);
    if (p.core.kind === 'group') p.core.parts.forEach((part) => index(part.pattern));
  }
  for (const n of doc.body) if (n.kind === 'voice' || n.kind === 'shared') index(n.pattern);
  const sharedNames = new Map(definitions.map((n) => [n.pattern.id, n]));
  function descend(
    p: Pattern,
    voice: Voice,
    path: (Voice | Pattern | GroupPart)[],
    muted: boolean,
    groupName?: string,
  ) {
    const cyclic = path.some((node) => node.id === p.id);
    path = [...path, p];
    muted ||= !!p.muted;
    const definition = sharedNames.get(p.id);
    if (definition?.purpose === 'value') return;
    const canonical = origins && p.origin ? byId.get(p.origin) : undefined;
    const ownName =
      author((canonical ?? p).label) ??
      author(definition?.nameSource === 'author' ? definition.name : undefined);
    if (canonical) {
      path = [...path, canonical];
      muted ||= !!canonical.muted;
    }
    if (!canonical && !cyclic && definition?.purpose !== 'instrument' && p.core.kind === 'ref') {
      const target = shared(doc, p.core.name);
      if (target) {
        descend(target, voice, path, muted, groupName);
        return;
      }
    }
    if (!canonical && !cyclic && definition?.purpose !== 'instrument' && p.core.kind === 'group') {
      for (const part of p.core.parts)
        descend(
          part.pattern,
          voice,
          [...path, part],
          muted || !!part.muted,
          ownName ?? groupName ?? (voice.nameSource === 'author' ? author(voice.name) : undefined),
        );
      return;
    }
    // A bare spacer retains its arrangement duration without becoming a row.
    if (
      definition?.purpose !== 'instrument' &&
      p.core.kind === 'generator' &&
      p.core.name === 'silence' &&
      !p.core.args.length &&
      !p.layers.length
    )
      return;
    if (definition?.purpose === 'section') return;
    const actual = canonical ?? p;
    const id = actual.id;
    let row = rows.get(id);
    if (!row) {
      const direct = !!voice && resolve(doc, voice.pattern).id === actual.id;
      const entry = sharedNames.get(actual.id);
      const name =
        author(actual.label) ??
        author(entry?.nameSource === 'author' ? entry.name : undefined) ??
        (direct && voice.nameSource === 'author' ? author(voice.name) : undefined);
      const generated =
        (direct ? author(voice.name) : undefined) ??
        (groupName && sound(p) ? `${groupName} · ${sound(p)}` : `Instrument ${rows.size + 1}`);
      row = {
        id,
        name: name ?? generated,
        nameSource: entry?.nameSource ?? (name ? 'author' : 'generated'),
        pattern: actual,
        uses: [],
        muted: false,
      };
      rows.set(id, row);
    }
    row.uses.push({
      voiceId: voice.id,
      path,
      layers: path
        .slice(1, -1)
        .reverse()
        .flatMap((node) => ('layers' in node ? node.layers : [])),
      muted,
    });
    row.muted = !!actual.muted || row.uses.every((use) => use.muted);
  }
  for (const voice of voices(doc)) descend(voice.pattern, voice, [voice], voice.muted);
  for (const entry of definitions) {
    if (entry.purpose !== 'instrument' || rows.has(entry.pattern.id)) continue;
    rows.set(entry.pattern.id, {
      id: entry.pattern.id,
      name: entry.pattern.label ?? entry.name,
      nameSource: entry.nameSource,
      pattern: entry.pattern,
      uses: [],
      muted: !!entry.pattern.muted,
    });
  }
  return [...rows.values()].map((row) => {
    // An unreused standalone pattern retains its existing voice id. Shared
    // identity takes precedence when the definition occurs in several voices.
    if (
      !row.uses.some((u) => u.path.some((n) => 'origin' in n)) &&
      row.uses.length === 1 &&
      row.uses[0].path.every((node) => !('core' in node) || node.core.kind !== 'group')
    )
      row.id = row.uses[0].voiceId;
    return row;
  });
}

/** One top-level arrange is one song strip. Multiple voices (even aligned
 * arrangements) have no single unambiguous section vocabulary: return no strip. */
export function sections(doc: Doc): SongSection[] {
  const roots = voices(doc);
  if (roots.length !== 1) return [];
  const root = resolve(doc, roots[0].pattern);
  if (root.core.kind !== 'group' || root.core.how !== 'arrange') return [];
  const rows = instruments(doc);
  let start = 0;
  return root.core.parts.map((part, index) => {
    const definition =
      part.pattern.core.kind === 'ref'
        ? doc.body.findLast(
            (n) => n.kind === 'shared' && n.name === (part.pattern.core as { name: string }).name,
          )
        : undefined;
    const name =
      part.label ??
      (definition?.kind === 'shared' ? (definition.pattern.label ?? definition.name) : undefined) ??
      author(part.pattern.label);
    const section: SongSection = {
      id: part.id,
      name: name ?? `Section ${index + 1}`,
      nameSource:
        part.label !== undefined
          ? (part.labelSource ?? 'author')
          : definition?.kind === 'shared'
            ? definition.nameSource
            : name
              ? 'author'
              : 'generated',
      start,
      cycles: part.cycles ?? 1,
      instrumentIds: rows
        .filter((row) =>
          row.uses.some((use) => !use.muted && use.path.some((node) => node === part)),
        )
        .map((row) => row.id),
    };
    start += section.cycles;
    return section;
  });
}
