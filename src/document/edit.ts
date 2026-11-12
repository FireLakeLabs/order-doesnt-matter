import {
  findById,
  instruments,
  sections,
  walk,
  type Doc,
  type Meta,
  type Path,
  type Pattern,
  type Setting,
} from './index';
export type Constant = number | string | boolean;
export interface Refusal {
  ok: false;
  reason: string;
}
const isSetting = (node?: Meta): node is Setting => !!node && 'name' in node && 'value' in node;
function contains(pattern: Pattern, id: string) {
  let found = false;
  walk(
    { version: 1, body: [{ kind: 'shared', name: 'scan', id: 'scan', tier: 1, pattern }] },
    (n) => {
      found ||= n.id === id;
    },
  );
  return found;
}
function reason(doc: Doc, pattern: Pattern, seen = new Set<string>()): string {
  if (seen.has(pattern.id)) return 'a pattern of values';
  seen.add(pattern.id);
  if (pattern.core.kind === 'opaque' || pattern.layers.some((l) => l.kind === 'opaque'))
    return 'source text';
  if (pattern.core.kind === 'signal') return 'driven by a signal';
  if (pattern.core.kind === 'ref') {
    const name = pattern.core.name;
    const shared = doc.body.findLast((n) => n.kind === 'shared' && n.name === name);
    if (shared?.kind === 'shared') return reason(doc, shared.pattern, seen);
  }
  return 'a pattern of values';
}
/** Text for read-only targets comes from the document, including signal bounds. */
function displayValue(doc: Doc, p: Pattern, seen = new Set<string>()): string {
  if (seen.has(p.id)) return 'reused pattern';
  seen.add(p.id);
  const c = p.core;
  if (c.kind === 'constant') return String(c.value);
  if (c.kind === 'sequence') return c.notation;
  if (c.kind === 'data') return JSON.stringify(c.value);
  if (c.kind === 'opaque') return c.code;
  if (c.kind === 'ref') {
    const shared = doc.body.findLast((n) => n.kind === 'shared' && n.name === c.name);
    return shared?.kind === 'shared' ? displayValue(doc, shared.pattern, seen) : c.name;
  }
  if (c.kind === 'signal') {
    const range = p.layers.find(
      (l) => l.kind === 'rewrite' && ['range', 'rangex'].includes(l.name),
    );
    if (
      range?.kind === 'rewrite' &&
      range.args.length === 2 &&
      range.args.every((a) => a.kind === 'literal')
    )
      return range.args.map((a) => (a.kind === 'literal' ? String(a.value) : '')).join(' to ');
    return c.shape;
  }
  return c.kind === 'generator' ? c.name : 'a pattern of values';
}
export interface Target {
  nodeId: string;
  breadcrumb: string[];
  generated: boolean;
  control: string;
  value: Constant | null;
  displayValue: string;
  editable: boolean;
  reason: string;
}
export function describeTarget(doc: Doc, nodeId: string): Target {
  const node = findById(doc, nodeId),
    setting = isSetting(node) ? node : undefined;
  const rows = instruments(doc);
  const definition = rows.find((r) => contains(r.pattern, nodeId));
  const local = definition
    ? undefined
    : rows.find((r) =>
        r.uses.some((u) =>
          u.layers.some((l) => l.kind === 'settings' && l.settings.some((s) => s.id === nodeId)),
        ),
      );
  const row = definition ?? local;
  const use = local?.uses.find((u) =>
    u.layers.some((l) => l.kind === 'settings' && l.settings.some((s) => s.id === nodeId)),
  );
  const section = use && sections(doc).find((s) => use.path.some((p) => p.id === s.id));
  const name = setting?.name;
  const control = name === 'cutoff' ? 'lpf' : name === 'hcutoff' ? 'hpf' : (name ?? 'Source text');
  const value = setting?.value.core.kind === 'constant' ? setting.value.core.value : null;
  const editable = !!setting && value !== null && !setting.value.layers.length;
  return {
    nodeId,
    breadcrumb: [row?.name ?? 'Piece', ...(section ? [`in ${section.name}`] : []), control],
    generated: row?.nameSource === 'generated',
    control,
    value,
    displayValue: setting ? displayValue(doc, setting.value) : '',
    editable,
    reason: editable ? '' : setting ? reason(doc, setting.value) : 'source text',
  };
}
/** Copy only the serialized path to the setting. Refusals are values, never throws. */
export function setConstant(doc: Doc, nodeId: string, value: Constant): Doc | Refusal {
  const target = describeTarget(doc, nodeId);
  if (!target.editable) return { ok: false, reason: target.reason };
  if (
    typeof value !== typeof target.value ||
    (typeof value === 'number' && !Number.isFinite(value))
  )
    return { ok: false, reason: 'Use a finite value of the same type' };
  if (value === target.value) return doc;
  let path: Path = [];
  walk(doc, (node, p) => {
    if (node.id === nodeId) path = [...p, 'value', 'core', 'value'];
  });
  function replace(node: unknown, depth: number): unknown {
    if (depth === path.length) return value;
    const key = path[depth],
      next = Array.isArray(node) ? [...node] : { ...(node as object) };
    (next as Record<string | number, unknown>)[key] = replace(
      (node as Record<string | number, unknown>)[key],
      depth + 1,
    );
    return next;
  }
  return replace(doc, 0) as Doc;
}
