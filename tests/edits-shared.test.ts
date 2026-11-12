import { expect, it } from 'vitest';
import { importStrudel } from '../src/import';
import { checkDoc, walk } from '../src/document';
import { findWithPath, replaceNode, freshIds } from '../src/document/edits/shared';
it('finds serialized paths, shares untouched structure and allocates collision-free ids', () => {
  const doc = importStrudel('note(60).gain(.5); note(72)').doc;
  const target = doc.body[0];
  expect(findWithPath(doc, target.id)?.path).toEqual(['body', 0]);
  const next = replaceNode(doc, target.id, { ...target, tier: 2 });
  if ('ok' in next) throw Error(next.reason);
  expect(next.body[0]).not.toBe(target);
  expect(next.body[1]).toBe(doc.body[1]);
  expect(doc.body[0].tier).toBe(1);
  expect(replaceNode(doc, target.id, target)).toBe(doc);
  expect(replaceNode(doc, 'absent', target)).toMatchObject({ ok: false });
  const allocate = freshIds(doc),
    used = new Set<string>();
  walk(doc, (n) => used.add(n.id));
  for (let i = 0; i < 100; i++) {
    const id = allocate();
    expect(used.has(id)).toBe(false);
    used.add(id);
  }
  expect(checkDoc(next)).toEqual([]);
});
