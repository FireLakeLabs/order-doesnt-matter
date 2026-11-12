import { instruments, sections, shared, walk, type Arg, type Doc, type Pattern } from '../index';
import type { Refusal } from './shared';

/** Remove a score leaf everywhere. Sequential groups keep silent timing slots;
 * parallel groups lose empty branches. Drivers and callbacks are never rewritten. */
export function removeInstrument(doc: Doc, id: string): Doc | Refusal {
  const rows = instruments(doc),
    row = rows.find((r) => r.id === id);
  if (!row) return { ok: false, reason: 'This instrument no longer exists' };
  if (rows.length === 1)
    return {
      ok: false,
      reason:
        'This is the only instrument. Add another instrument before deleting it, or mute it instead.',
    };
  const parts = new Map(sections(doc).map((s) => [s.id, s]));
  const memo = new Map<Pattern, Pattern | null>(),
    changed = new Set<Pattern>();
  const visiting = new Set<Pattern>(),
    scoreRefs = new Set<string>(),
    changedNames = new Set<string>();
  let problem = '';
  const silent = (p: Pattern): Pattern => ({
    id: p.id,
    tier: 1,
    core: { kind: 'generator', name: 'silence', args: [] },
    layers: [],
  });
  function prune(p: Pattern): Pattern | null {
    if (p.id === row!.pattern.id || p.origin === row!.pattern.id) return null;
    if (
      rows.some(
        (other) =>
          other !== row && other.pattern.id === p.id && ['group', 'ref'].includes(p.core.kind),
      )
    )
      return p;
    if (memo.has(p)) return memo.get(p)!;
    if (visiting.has(p)) return p;
    visiting.add(p);
    let next: Pattern | null = p;
    const c = p.core;
    if (c.kind === 'ref') {
      scoreRefs.add(p.id);
      const target = shared(doc, c.name);
      if (target) {
        const replacement = prune(target);
        if (replacement !== target || changed.has(target)) {
          changedNames.add(c.name);
          changed.add(p);
        }
        if (!replacement) next = null;
      }
    } else if (c.kind === 'group') {
      const children = c.parts.map((part) => prune(part.pattern));
      if (
        children.some((child, i) => child !== c.parts[i].pattern || changed.has(c.parts[i].pattern))
      ) {
        changed.add(p);
        if (!['stack', 'arrange', 'cat', 'seq', 'slowcat', 'fastcat'].includes(c.how))
          problem = `the ${c.how} grouping can change the other instruments' timing`;
        const kept = c.parts.flatMap((part, i) => {
          const child = children[i];
          if (!child && c.how === 'stack') return [];
          const section = parts.get(part.id);
          return [
            {
              ...part,
              pattern: child ?? silent(part.pattern),
              ...(!child && section
                ? { label: section.name, labelSource: section.nameSource }
                : {}),
            },
          ];
        });
        next = kept.length ? { ...p, core: { ...c, parts: kept } } : null;
      }
    }
    if (next && (next !== p || changed.has(p))) {
      // Only distributive score rewrites are safe across removed siblings.
      // Check callback bodies too: every(..., p => p.arp(...)) is not safe.
      function inspect(pattern: Pattern, callback = false) {
        if (callback && pattern.core.kind !== 'hole')
          problem = 'a shared callback replaces the whole score rather than transforming its notes';
        if (pattern.core.kind === 'opaque')
          problem = 'shared source text can depend on the removed notes';
        for (const layer of pattern.layers) {
          if (layer.kind === 'settings') {
            for (const setting of layer.settings)
              walk(
                {
                  version: 2,
                  body: [
                    {
                      id: 'scan',
                      tier: 1,
                      kind: 'shared',
                      name: 'scan',
                      nameSource: 'generated',
                      pattern: setting.value,
                    },
                  ],
                },
                (node) => {
                  if ('core' in node && ['hole', 'opaque'].includes((node as Pattern).core.kind))
                    problem = 'a shared setting uses the whole score or source text as its driver';
                },
              );
            continue;
          }
          if (layer.kind === 'opaque') {
            problem = 'shared source text can depend on the removed notes';
            continue;
          }
          if (
            ![
              'fast',
              'slow',
              'early',
              'late',
              'rev',
              'ply',
              'every',
              'jux',
              'off',
              'sometimes',
              'degrade',
              'degradeBy',
            ].includes(layer.name)
          )
            problem = `a shared ${layer.name} rewrite can depend on the removed notes`;
          for (const arg of layer.args) {
            if (arg.kind === 'callback') inspect(arg.body, true);
            if (arg.kind === 'opaque')
              problem = 'shared source text can depend on the removed notes';
          }
        }
      }
      inspect(p);
    }
    visiting.delete(p);
    memo.set(p, next);
    return next;
  }
  // Compute all score definitions first, including aliases not currently in use.
  for (const node of doc.body)
    if (node.kind === 'voice' || node.kind === 'shared') {
      const next = prune(node.pattern);
      if (node.kind === 'shared' && (next !== node.pattern || changed.has(node.pattern)))
        changedNames.add(node.name);
    }
  const next: Doc = {
    ...doc,
    body: doc.body.flatMap<Doc['body'][number]>((node) => {
      if (node.kind !== 'voice' && node.kind !== 'shared') return [node];
      const pattern = prune(node.pattern);
      return pattern ? [{ ...node, pattern }] : [];
    }),
  };
  // A name may also feed a surviving instrument's settings or callback. Refuse
  // rather than silently altering that instrument or leaving a dangling name.
  let dependency = '';
  walk(next, (node) => {
    if ('core' in node) {
      const p = node as Pattern;
      if (p.core.kind === 'ref' && changedNames.has(p.core.name) && !scoreRefs.has(p.id))
        dependency = p.id;
    }
    // Opaque arguments are not addressable walk nodes. Check source only:
    // labels and generated names can legitimately contain a shared name.
    const p = 'core' in node ? (node as Pattern) : undefined;
    const core = p?.core;
    const code = [
      ...('code' in node ? [String(node.code)] : []),
      ...(core?.kind === 'opaque' ? [core.code] : []),
      ...('args' in node
        ? (node.args as Arg[])
        : core && 'args' in core
          ? (core.args ?? [])
          : []
      ).flatMap((arg) => (arg.kind === 'opaque' ? [arg.code] : [])),
    ].join('\n');
    if (
      [...changedNames].some((name) =>
        new RegExp(`(^|[^\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w$]|$)`).test(
          code,
        ),
      )
    )
      dependency = node.id;
  });
  if (dependency || problem) {
    const affected = rows
      .filter((r) => r !== row)
      .find(
        (r) =>
          r.uses.some((u) => u.path.some((p) => p.id === dependency)) ||
          JSON.stringify(r.pattern).includes(`"${dependency}"`),
      );
    const names = (affected ? [affected] : rows.filter((r) => r !== row))
      .map((r) => r.name.replaceAll('$', ''))
      .join(', ');
    return {
      ok: false,
      reason: `Cannot delete ${row.name.replaceAll('$', '')}: ${names} ${dependency ? 'depends on it in a setting or source text' : `would change because ${problem}`}. Edit that shared part as source first, or mute this instrument instead.`,
    };
  }
  return next;
}
