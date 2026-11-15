import { shared, sections, type Doc, type Instrument, type Pattern } from '../document';
import type { AppState } from '../app/state';

const inventories = new WeakMap<
  Doc,
  { names: string[]; sounds: (string | undefined)[]; groups: (string | undefined)[] }
>();
const firstSound = (text: string) => /[\w.-]+/.exec(text)?.[0];
function literal(pattern: Pattern, doc: Doc, seen = new Set<string>()): string | undefined {
  const core = pattern.core;
  if (core.kind === 'constant' && typeof core.value === 'string') return firstSound(core.value);
  if (core.kind === 'sequence') return firstSound(core.notation);
  if (core.kind === 'ref' && !seen.has(core.name)) {
    seen.add(core.name);
    const target = shared(doc, core.name);
    if (target) return literal(target, doc, seen);
  }
  return undefined;
}
function sound(row: Instrument, doc: Doc, seen = new Set<string>()): string | undefined {
  if (seen.has(row.pattern.id)) return undefined;
  seen.add(row.pattern.id);
  let name: string | undefined;
  const pattern = row.pattern;
  if (pattern.core.kind === 'generator' && ['s', 'sound'].includes(pattern.core.name)) {
    const arg = pattern.core.args.at(0);
    if (arg?.kind === 'literal' && typeof arg.value === 'string') name = firstSound(arg.value);
    else if (arg?.kind === 'pattern') name = literal(arg.pattern, doc);
  } else if (pattern.core.kind === 'ref') {
    const target = shared(doc, pattern.core.name);
    if (target) name = sound({ ...row, pattern: target, uses: [] }, doc, seen);
  }
  // Use a written occurrence, independent of which section is currently playing.
  for (const layer of [...pattern.layers, ...(row.uses.at(0)?.layers ?? [])])
    if (layer.kind === 'settings')
      for (const setting of layer.settings)
        if (['s', 'sound'].includes(setting.name)) name = literal(setting.value, doc);
  return name;
}
/** Document identity owns names and suffixes, including rows resting in every sampled window. */
export function instrumentInventory(state: Pick<AppState, 'doc' | 'rows'>) {
  if (!state.doc) return { names: [], sounds: [], groups: [] };
  const cached = inventories.get(state.doc);
  if (cached) return cached;
  const counts = new Map<string, number>();
  const used = new Set(
    state.rows
      .filter((row) => row.nameSource === 'author')
      .map((row) => row.name.replaceAll('$', '')),
  );
  const doc = state.doc;
  const sounds = state.rows.map((row) => sound(row, doc));
  const parts = sections(doc);
  const sectionNames = state.rows.map((row) => [
    ...new Set(
      parts
        .filter((section) =>
          row.uses.some((use) => use.path.some((node) => node.id === section.id)),
        )
        .map((section) => section.name),
    ),
  ]);
  const generated = sounds.map((name) => name ?? 'sound');
  const names = state.rows.map((row, index) => {
    if (row.nameSource === 'author') return row.name.replaceAll('$', '');
    const base = generated[index];
    const siblings = state.rows.flatMap((other, i) =>
      other.nameSource !== 'author' && generated[i] === base ? [i] : [],
    );
    const ownSections = sectionNames[index];
    const distinctSection =
      siblings.length > 1 &&
      ownSections.length === 1 &&
      siblings.some((i) => sectionNames[i].length === 1 && sectionNames[i][0] !== ownSections[0]);
    const name = distinctSection ? `${base} · ${ownSections[0]}` : base;
    let count = (counts.get(name) ?? 0) + 1;
    let unique = count === 1 ? name : `${name} ${String(count)}`;
    while (used.has(unique)) {
      count++;
      unique = `${name} ${String(count)}`;
    }
    counts.set(name, count);
    used.add(unique);
    return unique;
  });
  const groups = state.rows.map((row) => {
    // The nearest named stack/cat is the useful group; arrange names are sections.
    for (const node of [...(row.uses[0]?.path ?? [])].reverse()) {
      if (!('core' in node) || node.core.kind !== 'group' || node.core.how === 'arrange') continue;
      const definition = doc.body.find(
        (entry) => entry.kind === 'shared' && entry.pattern.id === node.id,
      );
      if (node.label && !parts.some((section) => section.name === node.label)) return node.label;
      if (
        definition?.kind === 'shared' &&
        definition.nameSource === 'author' &&
        definition.purpose !== 'section' &&
        !parts.some((section) => section.name === definition.name)
      )
        return definition.name;
    }
    return undefined;
  });
  const inventory = { names, sounds, groups };
  inventories.set(doc, inventory);
  return inventory;
}
