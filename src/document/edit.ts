import { parse } from 'acorn';
import type * as JS from 'estree';
import { callbackBranches, callbackTrail } from './edits/rewrite-shared';
import {
  findById,
  instruments,
  sections,
  shared,
  walk,
  type Doc,
  type DocumentNode,
  type Pattern,
  type Setting,
  type InstrumentUse,
  type SongSection,
} from './index';
export type Constant = number | string | boolean;
export type { Refusal } from './edits/shared';
const isSetting = (node?: DocumentNode): node is Setting =>
  !!node && 'name' in node && 'value' in node;
function contains(pattern: Pattern, id: string) {
  let found = false;
  walk(
    {
      version: 2,
      body: [
        { kind: 'shared', nameSource: 'generated', name: 'scan', id: 'scan', tier: 1, pattern },
      ],
    },
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
  if (c.kind === 'generator') {
    const arg = c.args[0];
    return arg?.kind === 'pattern'
      ? displayValue(doc, arg.pattern, seen)
      : arg?.kind === 'literal'
        ? String(arg.value)
        : c.name;
  }
  return 'a pattern of values';
}
export type TargetKind =
  | 'instrument'
  | 'setting-constant'
  | 'setting-values'
  | 'setting-signal'
  | 'rewrite'
  | 'rhythm'
  | 'section'
  | 'source'
  | 'unknown';
export interface Target {
  kind: TargetKind;
  node?: DocumentNode;
  instrumentId?: string;
  use?: InstrumentUse;
  section?: SongSection;
  /** Parallel to breadcrumb: author names are false, generated names true. */
  generatedParts: boolean[];
  nodeId: string;
  breadcrumb: string[];
  generated: boolean;
  control: string;
  value: Constant | null;
  displayValue: string;
  editable: boolean;
  reason: string;
}
/** A core has no serialized Meta id. Its selection address is scoped to its pattern. */
export const rhythmTargetId = (pattern: Pattern) => `${pattern.id}:rhythm`;
/** Plain setup labels shared by the sheet and its source breadcrumb. */
export function setupSummary(code: string): string {
  try {
    // Parse, never execute. Comments are trivia; strings and templates stay intact.
    const first = (
      parse(code, {
        ecmaVersion: 'latest',
        allowAwaitOutsideFunction: true,
      }) as unknown as JS.Program
    ).body[0];
    const expression = first?.type === 'ExpressionStatement' ? first.expression : undefined;
    const call = expression?.type === 'AwaitExpression' ? expression.argument : expression;
    if (
      call?.type === 'CallExpression' &&
      call.callee.type === 'Identifier' &&
      call.callee.name === 'samples'
    ) {
      const arg = call.arguments[0];
      const name =
        arg?.type === 'Literal' && typeof arg.value === 'string'
          ? arg.value
          : arg?.type === 'TemplateLiteral' && !arg.expressions.length
            ? arg.quasis[0].value.cooked
            : undefined;
      if (name !== undefined && name !== null) return `Loads sounds from ${name}`.slice(0, 60);
      if (arg?.type === 'ObjectExpression') return 'Loads sounds from a sample map';
    }
    if (first?.type === 'FunctionDeclaration' && first.id)
      return `Defines helper: ${first.id.name}`.slice(0, 60);
    if (first?.type === 'VariableDeclaration') {
      const declaration = first.declarations[0];
      if (
        declaration?.id.type === 'Identifier' &&
        declaration.init &&
        ['ArrowFunctionExpression', 'FunctionExpression'].includes(declaration.init.type)
      )
        return `Defines helper: ${declaration.id.name}`.slice(0, 60);
    }
  } catch {
    /* Invalid or unsupported JavaScript still has its complete source editor. */
  }
  return 'Setup source';
}
export function describeTarget(doc: Doc, nodeId: string): Target {
  const argument = /^(.*):arg:(\d+)$/.exec(nodeId);
  if (argument) {
    const parent = describeTarget(doc, argument[1]);
    return {
      ...parent,
      nodeId,
      kind: 'source',
      breadcrumb: [...parent.breadcrumb, `Argument ${Number(argument[2]) + 1}`, 'Source text'],
      generatedParts: [...parent.generatedParts, false, false],
    };
  }
  const rewrites = nodeId.endsWith(':rewrites');
  const rhythm = nodeId.endsWith(':rhythm'),
    sourceAddress = nodeId.endsWith(':source');
  const id = rewrites
    ? nodeId.slice(0, -9)
    : rhythm || sourceAddress
      ? nodeId.slice(0, -7)
      : nodeId;
  const node = findById(doc, id);
  const rows = instruments(doc);
  const definition = rows.find((r) => r.id === id || contains(r.pattern, id));
  const inUse = (use: InstrumentUse) =>
    use.path.some((p) => p.id === id) ||
    use.layers.some((layer) =>
      contains({ id: 'scan-pattern', tier: 1, core: { kind: 'hole' }, layers: [layer] }, id),
    );
  const local = definition ? undefined : rows.find((r) => r.uses.some(inUse));
  const row = definition ?? local;
  const use = local?.uses.find(inUse);
  const parts = sections(doc);
  const selectedSection = parts.find((s) => s.id === id);
  const section =
    selectedSection ?? (use && parts.find((s) => use.path.some((p) => p.id === s.id)));
  const setting = isSetting(node) ? node : undefined;
  const control =
    setting?.name === 'cutoff'
      ? 'lpf'
      : setting?.name === 'hcutoff'
        ? 'hpf'
        : (setting?.name ?? '');
  const value = setting?.value.core.kind === 'constant' ? setting.value.core.value : null;
  const editable = !!setting && value !== null && !setting.value.layers.length;
  function valueKind(p: Pattern, seen = new Set<string>()): TargetKind {
    if (seen.has(p.id)) return 'unknown';
    seen.add(p.id);
    if (p.core.kind === 'opaque' || p.layers.some((l) => l.kind === 'opaque')) return 'source';
    if (p.core.kind === 'signal') return 'setting-signal';
    if (p.core.kind === 'ref') {
      const target = shared(doc, p.core.name);
      if (target) return valueKind(target, seen);
    }
    return ['sequence', 'group', 'constant', 'data'].includes(p.core.kind)
      ? 'setting-values'
      : 'unknown';
  }
  const pattern = node && 'core' in node ? (node as Pattern) : undefined;
  const setup = node && 'kind' in node && node.kind === 'setup' && 'code' in node;
  const source =
    setup ||
    (node && 'tier' in node && node.tier === 3) ||
    (node && 'kind' in node && node.kind === 'opaque') ||
    pattern?.core.kind === 'opaque';
  let kind: TargetKind = 'unknown';
  if (sourceAddress) kind = 'source';
  else if (
    rewrites &&
    pattern &&
    (rows.some((r) => r.pattern.id === id) ||
      callbackBranches(doc).some((b) => b.body.id === id && b.supported))
  )
    kind = 'rewrite';
  else if (selectedSection && !rhythm && !sourceAddress) kind = 'section';
  else if (setting) kind = editable ? 'setting-constant' : valueKind(setting.value);
  else if (row?.id === id && !rhythm && !sourceAddress) kind = 'instrument';
  else if (source || sourceAddress) kind = 'source';
  else if (
    rhythm &&
    pattern &&
    (pattern.core.kind === 'sequence' ||
      (pattern.core.kind === 'generator' &&
        ['note', 'n', 'freq', 's', 'sound'].includes(pattern.core.name)))
  )
    kind = 'rhythm';
  else if (node && 'kind' in node && node.kind === 'rewrite') kind = 'rewrite';
  const label =
    control ||
    (rewrites
      ? 'Rewrites'
      : kind === 'rhythm'
        ? 'Rhythm'
        : kind === 'rewrite' && node && 'name' in node
          ? String(node.name)
          : kind === 'source'
            ? 'Source text'
            : 'Pattern');
  const trail = callbackTrail(doc, id);
  const breadcrumb = (
    setup
      ? ['setup', setupSummary(String(node.code))]
      : kind === 'section'
        ? ['Piece', selectedSection!.name]
        : [
            row?.name ?? 'Piece',
            ...(section ? [`in ${section.name}`] : []),
            ...(kind === 'instrument' ? [] : [label]),
            ...(sourceAddress && label !== 'Source text' ? ['Source text'] : []),
          ]
  ).map((part) => part.replaceAll('$', ''));
  if (!setup && kind !== 'section')
    breadcrumb.splice(
      1 + (section ? 1 : 0),
      0,
      ...trail.flatMap((b) => [b.parent.name, `${b.role} · ${b.parameter}`]),
    );
  return {
    nodeId,
    node,
    kind,
    instrumentId: kind === 'section' ? undefined : row?.id,
    use: kind === 'section' ? undefined : use,
    section,
    breadcrumb,
    generatedParts: breadcrumb.map((_, i) =>
      setup
        ? false
        : kind === 'section'
          ? i === 1 && selectedSection!.nameSource === 'generated'
          : i === 0
            ? row?.nameSource === 'generated'
            : !!section && i === 1 && section.nameSource === 'generated',
    ),
    generated: row?.nameSource === 'generated',
    control: control || label,
    value,
    displayValue: selectedSection
      ? `${selectedSection.start}–${selectedSection.start + selectedSection.cycles} · ${selectedSection.cycles} cycles`
      : setting
        ? displayValue(doc, setting.value)
        : pattern
          ? displayValue(doc, pattern)
          : node && 'code' in node
            ? String(node.code)
            : '',
    editable,
    reason: editable
      ? ''
      : setting
        ? reason(doc, setting.value)
        : ((
            {
              instrument: 'instrument editing is not available yet',
              rhythm:
                'rhythm editing is not available yet; source text is available in the pasted program',
              rewrite: 'ordered rewrite editing is not available yet',
              section: 'section editing is not available yet',
              source: 'source text',
              unknown: 'recognised by shape; no editor is available yet',
            } as Partial<Record<TargetKind, string>>
          )[kind] ?? 'source text'),
  };
}
export { setConstant } from './edits/set-constant';

/** Existing selection addresses only, including explicitly labelled use-site layers. */
export function instrumentTargets(doc: Doc, id: string): { nodeId: string; text: string }[] {
  const row = instruments(doc).find((row) => row.id === id);
  if (!row) return [];
  const targets = new Map<string, string>();
  const seen = new Set<string>();
  function gather(pattern: Pattern) {
    if (seen.has(pattern.id)) return;
    seen.add(pattern.id);
    if (pattern.core.kind === 'ref') {
      const target = shared(doc, pattern.core.name);
      if (target) gather(target);
    }
    if (pattern.core.kind === 'group') pattern.core.parts.forEach((part) => gather(part.pattern));
    for (const layer of pattern.layers) {
      if (layer.kind === 'settings')
        layer.settings.forEach((setting) => targets.set(setting.id, setting.name));
      else targets.set(layer.id, layer.kind === 'rewrite' ? layer.name : 'Source text');
    }
  }
  gather(row.pattern);
  const rhythm = rhythmTargetId(row.pattern);
  if (describeTarget(doc, rhythm).kind === 'rhythm') targets.set(rhythm, 'Rhythm');
  targets.set(`${row.pattern.id}:rewrites`, 'Rewrites');
  row.uses.forEach((use) =>
    use.layers.forEach((layer) => {
      if (layer.kind === 'settings')
        layer.settings.forEach((setting) => targets.set(setting.id, setting.name));
      else targets.set(layer.id, layer.kind === 'rewrite' ? layer.name : 'Source text');
    }),
  );
  return [...targets].map(([nodeId, text]) => {
    const target = describeTarget(doc, nodeId);
    const label = target.control || text;
    return {
      nodeId,
      text: target.section ? `${label} · in ${target.section.name.replaceAll('$', '')}` : label,
    };
  });
}
