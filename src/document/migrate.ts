import { tokenizer } from 'acorn';
import { checkDoc, instruments, walk, type Doc, type Pattern } from './index';

/** Stored JSON is upgraded without changing the caller's object or evaluating code. */
export function migrate(value: unknown): Doc {
  if (!value || typeof value !== 'object' || !('version' in value))
    throw Error('Expected an ODM document with version 1 or 2');
  if (value.version !== 1 && value.version !== 2)
    throw Error(`Unsupported document version: ${String(value.version)}`);
  if (!('body' in value) || !Array.isArray(value.body)) throw Error('Invalid document body');
  try {
    if (value.version === 2) {
      const doc = value as Doc,
        problems = checkDoc(doc);
      if (problems.length) throw Error(problems.join('; '));
      return doc;
    }
    const doc = structuredClone(value) as Doc;
    doc.version = 2;
    const ids = new Set<string>();
    walk(doc, (n) => {
      if (n.id) ids.add(n.id);
    });
    let serial = 0;
    const fresh = () => {
      let id: string;
      do {
        id = `part${++serial}`;
      } while (ids.has(id));
      ids.add(id);
      return id;
    };
    const reservedSections = new Set<string>();
    const renames = new Map<string, string>(),
      names = new Set(doc.body.filter((n) => n.kind === 'shared').map((n) => n.name));
    for (const n of doc.body)
      if (n.kind === 'shared') {
        const generated = /^__odm_section_\d+$/.test(n.name);
        n.nameSource = generated || n.name.startsWith('__odm_instrument_') ? 'generated' : 'author';
        if (generated) {
          reservedSections.add(n.id);
          let name = n.name.replace('__odm_section_', 'section');
          while (names.has(name)) name += '_';
          names.add(name);
          renames.set(n.name, name);
          n.name = name;
        }
      }
    function code(source: string): string {
      const changes: { start: number; end: number; name: string }[] = [];
      for (const token of tokenizer(source, { ecmaVersion: 'latest' })) {
        const name =
          token.type.label === 'name' && renames.get(source.slice(token.start, token.end));
        if (name) changes.push({ start: token.start, end: token.end, name });
      }
      for (const change of changes.reverse())
        source = source.slice(0, change.start) + change.name + source.slice(change.end);
      return source;
    }
    walk(doc, (n) => {
      if ('pattern' in n && !('kind' in n)) {
        n.id = fresh();
        if (n.label !== undefined) n.labelSource = 'author';
      }
      if ('core' in n) {
        const p = n as Pattern;
        if (p.core.kind === 'ref' && renames.has(p.core.name))
          p.core.name = renames.get(p.core.name)!;
      }
    });
    function renameCode(value: unknown): void {
      if (!value || typeof value !== 'object') return;
      if ('code' in value && typeof value.code === 'string') value.code = code(value.code);
      for (const [key, child] of Object.entries(value)) {
        if (key === 'value' && 'kind' in value && ['data', 'literal'].includes(String(value.kind)))
          continue;
        renameCode(child);
      }
    }
    renameCode(doc);
    // Preserve v1's derived inventory where a leaf already has a shared definition.
    const rows = instruments(doc);
    for (const n of doc.body)
      if (n.kind === 'shared' && !n.purpose && rows.some((r) => r.pattern.id === n.pattern.id))
        n.purpose = 'instrument';
    for (const n of doc.body)
      if (n.kind === 'shared' && reservedSections.has(n.id) && !n.purpose) n.purpose = 'section';
    const problems = checkDoc(doc);
    if (problems.length) throw Error(problems.join('; '));
    return doc;
  } catch (error) {
    throw Error(
      `Invalid version-${value.version} document: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
