import { shared, type Doc, type Instrument, type Pattern } from '../document';
import type { AppState } from '../app/state';

const inventories = new WeakMap<Doc, { names: string[]; sounds: (string | undefined)[] }>();
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
  if (!state.doc) return { names: [], sounds: [] };
  const cached = inventories.get(state.doc);
  if (cached) return cached;
  const counts = new Map<string, number>();
  const doc = state.doc;
  const sounds = state.rows.map((row) => sound(row, doc));
  const names = state.rows.map((row, index) => {
    if (row.nameSource === 'author') return row.name.replaceAll('$', '');
    const name = sounds[index] ?? 'sound';
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    return count === 1 ? name : `${name} ${String(count)}`;
  });
  const inventory = { names, sounds };
  inventories.set(doc, inventory);
  return inventory;
}
