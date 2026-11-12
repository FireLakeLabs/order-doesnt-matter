import {
  walk,
  type Arg,
  type Doc,
  type Meta,
  type Pattern,
  type Path,
  type Setting,
} from '../index';
import { generate, generatePattern } from '../../generate';
import { importStrudel } from '../../import';
import type { EventResult } from '../../contract';
import { findWithPath, freshIds, replaceAtPath, type Refusal } from './shared';
export const refusal = (reason: string): Refusal => ({ ok: false, reason });
export function callAt(doc: Doc, id: string) {
  const found = findWithPath(doc, id);
  if (!found) return;
  const n = found.node;
  if ('args' in n && 'name' in n)
    return { name: String(n.name), args: n.args as Arg[], path: [...found.path, 'args'] };
  if ('core' in n) {
    const c = (n as Pattern).core;
    if (c.kind === 'generator' || (c.kind === 'signal' && c.args))
      return {
        name: c.kind === 'generator' ? c.name : c.shape,
        args: c.args!,
        path: [...found.path, 'core', 'args'],
      };
  }
}
export function argumentSource(arg: Arg, hole?: string) {
  return generatePattern(
    {
      id: 'fragment',
      tier: 1,
      core: { kind: 'generator', name: 'fragment', args: [arg] },
      layers: [],
    },
    hole,
  ).slice(9, -1);
}
export function sourceSlot(doc: Doc, address: string) {
  const match = /^(.*):arg:(\d+)$/.exec(address);
  const id = (match?.[1] ?? address).replace(/:(source|rhythm|rewrites)$/, '');
  const found = findWithPath(doc, id);
  if (!found) return;
  let hole: string | undefined;
  // Callback parameters have lexical scope; the fragment must be imported in that scope.
  let ancestor: unknown = doc;
  for (const key of found.path) {
    if (
      ancestor &&
      typeof ancestor === 'object' &&
      'kind' in ancestor &&
      ancestor.kind === 'callback'
    )
      hole = (ancestor as Extract<Arg, { kind: 'callback' }>).parameter ?? 'p';
    ancestor = (ancestor as Record<string | number, unknown>)[key];
  }
  const node = found.node;
  let coreOnly = address.endsWith(':rhythm');
  let path: Path = found.path,
    shape: 'pattern' | 'layers' | 'argument' | 'top' | 'setting' = 'top',
    code: string;
  if (match) {
    const call = callAt(doc, id),
      index = Number(match[2]),
      arg = call?.args[index];
    if (!call || !arg) return;
    path = [...call.path, index];
    shape = 'argument';
    code = argumentSource(arg, hole);
  } else if (
    'core' in node ||
    ('pattern' in node && 'kind' in node && ['voice', 'shared'].includes(String(node.kind)))
  ) {
    const p = 'core' in node ? (node as Pattern) : (node as Meta & { pattern: Pattern }).pattern;
    if (!('core' in node)) path = [...path, 'pattern'];
    shape = 'pattern';
    code = generatePattern(p, hole);
    coreOnly ||= address.endsWith(':source') && 'core' in node && p.core.kind === 'opaque';
    if (coreOnly) {
      code =
        p.core.kind === 'opaque'
          ? p.core.code
          : generatePattern(
              { ...p, layers: [], label: undefined, comment: undefined, muted: undefined },
              hole,
            );
    }
  } else if ('value' in node && 'name' in node) {
    shape = 'setting';
    const s = node as Setting;
    code = `.${s.name}(${generatePattern(s.value, hole)})`;
  } else if ('kind' in node && ['rewrite', 'opaque', 'settings'].includes(String(node.kind))) {
    shape = 'layers';
    code = generatePattern(
      {
        id: 'fragment',
        tier: 1,
        core: { kind: 'hole' },
        layers: [node as Pattern['layers'][number]],
      },
      hole,
    ).slice((hole ?? 'p').length);
  } else {
    code = generate({ version: 1, body: [node as Doc['body'][number]] });
  }
  return { node, path, shape, code, hole, core: coreOnly };
}
export const sourceFragment = (doc: Doc, id: string) => sourceSlot(doc, id)?.code;
/** Same parser and lexical bindings as a whole import, without executing any code. */
export function parseFragment(doc: Doc, code: string, layer: boolean, hole?: string) {
  const expression = layer ? `${hole ?? 'silence'}${code}` : code;
  const probe = hole ? `silence.off(0, ${hole} => (${expression}\n))` : `(${expression}\n)`;
  const parsed = importStrudel(`${generate(doc)}\n$: ${probe};`).doc.body.at(-1);
  if (parsed?.kind !== 'voice') throw Error('Use one expression in this place.');
  const p = parsed.pattern;
  if (!hole) return p;
  const arg = p.layers.at(-1);
  if (arg?.kind === 'rewrite' && arg.args[1]?.kind === 'callback') return arg.args[1].body;
  // A callback may stop using its parameter. Parsing it in a declared scope
  // lets the importer model that expression without losing captured references.
  const declaration = doc.body.some((n) => n.kind === 'shared' && n.name === hole)
    ? ''
    : `const ${hole}=silence;`;
  const fallback = importStrudel(
    `${generate(doc)}\n${declaration}\n$: (${expression}\n);`,
  ).doc.body.at(-1);
  if (fallback?.kind !== 'voice') throw Error('Use one expression in this place.');
  walk({ version: 1, body: [fallback] }, (node) => {
    if ('core' in node) {
      const p = node as Pattern;
      if (p.core.kind === 'ref' && p.core.name === hole) p.core = { kind: 'opaque', code: hole };
    }
  });
  return fallback.pattern;
}
export function adopt<T>(doc: Doc, value: T, fresh = freshIds(doc)): T {
  const next = structuredClone(value);
  function visit(n: unknown) {
    if (!n || typeof n !== 'object') return;
    if ('id' in n && 'tier' in n) {
      (n as Meta).id = fresh();
      delete (n as Meta).span;
    }
    Object.entries(n).forEach(([key, value]) => {
      if (key === 'value' && 'kind' in n && ['literal', 'data'].includes(String(n.kind))) return;
      visit(value);
    });
  }
  visit(next);
  return next;
}
export function installSource(
  doc: Doc,
  id: string,
  code: string,
  understood: boolean,
): Doc | Refusal {
  const slot = sourceSlot(doc, id);
  if (!slot) return refusal('This selection no longer exists.');
  if (!code.trim()) return refusal('Enter source text before applying.');
  try {
    let next: Doc;
    const fresh = freshIds(doc);
    if (slot.shape === 'top') {
      const parsed = importStrudel(code).doc;
      if (understood && !parsed.body.length) return refusal('Keep this text as source.');
      const items = understood
        ? adopt(doc, parsed.body, fresh)
        : [{ ...slot.node, kind: 'setup', tier: 3, code }];
      if (items.length) items[0].id = slot.node.id;
      const index = Number(slot.path[1]);
      next = {
        ...doc,
        body: [
          ...doc.body.slice(0, index),
          ...(items as Doc['body']),
          ...doc.body.slice(index + 1),
        ],
      };
    } else {
      const layer = slot.shape === 'layers' || slot.shape === 'setting';
      const parsed = parseFragment(doc, code, layer, slot.hole);
      if (layer) {
        if (
          (!(parsed.core.kind === 'generator' && parsed.core.name === 'silence') &&
            !(slot.hole && parsed.core.kind === 'hole')) ||
          !parsed.layers.length
        )
          return refusal('Keep a call beginning with a dot in this place.');
        const layers: Pattern['layers'] = understood
          ? adopt(doc, parsed.layers, fresh)
          : [{ id: slot.node.id, tier: 3, kind: 'opaque', code }];
        if (
          slot.shape === 'setting' &&
          layers.length === 1 &&
          layers[0].kind === 'settings' &&
          layers[0].settings.length === 1
        ) {
          const s = layers[0].settings[0];
          s.id = slot.node.id;
          next = replaceAtPath(doc, slot.path, s);
        } else {
          const layerPath = slot.shape === 'setting' ? slot.path.slice(0, -2) : slot.path;
          const parentPath = layerPath.slice(0, -1),
            index = Number(layerPath.at(-1));
          let parent: unknown = doc;
          for (const key of parentPath) parent = (parent as Record<string | number, unknown>)[key];
          const old = parent as Pattern['layers'];
          if (slot.shape === 'setting') {
            if (layers.length === 1 && layers[0].kind !== 'settings') layers[0].id = slot.node.id;
            const settings = (
              old[index] as Extract<Pattern['layers'][number], { kind: 'settings' }>
            ).settings;
            const at = Number(slot.path.at(-1));
            if (at > 0)
              layers.unshift({
                ...old[index],
                id: fresh(),
                kind: 'settings',
                settings: settings.slice(0, at),
              });
            if (at < settings.length - 1)
              layers.push({
                ...old[index],
                id: fresh(),
                kind: 'settings',
                settings: settings.slice(at + 1),
              });
          } else if (layers[0].kind === 'settings') layers[0].settings[0].id = slot.node.id;
          else layers[0].id = slot.node.id;
          next = replaceAtPath(doc, parentPath, [
            ...old.slice(0, index),
            ...layers,
            ...old.slice(index + 1),
          ]);
        }
      } else if (slot.shape === 'argument') {
        const arg = parseFragment(doc, `silence.fragment(${code}\n)`, false, slot.hole).layers.at(
          -1,
        );
        if (arg?.kind !== 'rewrite' || arg.args.length !== 1)
          return refusal('Use one argument in this place.');
        next = replaceAtPath(
          doc,
          slot.path,
          understood ? adopt(doc, arg.args[0], fresh) : { kind: 'opaque', code },
        );
      } else {
        const p = understood
          ? adopt(doc, parsed, fresh)
          : {
              ...('core' in slot.node
                ? { label: (slot.node as Pattern).label, comment: (slot.node as Pattern).comment }
                : {}),
              id: slot.node.id,
              tier: 3 as const,
              core: { kind: 'opaque' as const, code },
              layers: [],
            };
        p.id =
          'core' in slot.node
            ? slot.node.id
            : (slot.node as Meta & { pattern: Pattern }).pattern.id;
        if (slot.core && 'core' in slot.node) {
          const old = slot.node as Pattern;
          next = replaceAtPath(doc, slot.path, {
            ...old,
            core: p.core,
            layers: [...p.layers, ...old.layers],
          });
        } else next = replaceAtPath(doc, slot.path, p);
      }
    }
    importStrudel(generate(next));
    return next;
  } catch (error) {
    const e = error as Error & { loc?: { line: number; column: number } };
    return refusal(
      `Check the source text${e.loc ? ` near line ${e.loc.line}, position ${e.loc.column + 1} of the generated piece` : ''}: ${e.message}`,
    );
  }
}
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable)}]`
    : v && typeof v === 'object'
      ? `{${Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => `${k}:${stable(x)}`)}}`
      : JSON.stringify(v);
/** D26: onset multisets compare whole spans and values, never query fragments. */
export function sameOnsets(a: EventResult, b: EventResult) {
  const notes = (r: EventResult) =>
    r.events
      .filter((e) => e.hasOnset)
      .map((e) => stable([e.whole, e.value]))
      .sort();
  return (
    !a.error &&
    !b.error &&
    !a.opaqueValues &&
    !b.opaqueValues &&
    a.cps === b.cps &&
    stable(notes(a)) === stable(notes(b))
  );
}
