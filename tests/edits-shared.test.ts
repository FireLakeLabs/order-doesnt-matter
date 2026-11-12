import { expect, it } from 'vitest';
import { importStrudel } from '../src/import';
import { checkDoc, walk, type Doc, type Setting, type Pattern } from '../src/document';
import {
  findWithPath,
  replaceNode,
  freshIds,
  replaceAtPath,
  instrumentEditStatus,
} from '../src/document/edits/shared';
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

// A stored v2 localized instrument remains supported even though section edits
// now only create reference uses.
function localized() {
  const doc = importStrudel(
    'const bass=note("c2 d2").lpf(450).gain(.5); arrange([2,bass],[2,bass])',
  ).doc;
  const definition = doc.body[0];
  if (definition.kind !== 'shared') throw Error('definition');
  const root = doc.body.at(-1)!;
  if (root.kind !== 'voice' || root.pattern.core.kind !== 'group') throw Error('arrange');
  const copy = structuredClone(definition.pattern);
  walk({ version: 2, body: [{ ...definition, pattern: copy }] }, (n) => (n.id = `local-${n.id}`));
  copy.origin = definition.pattern.id;
  root.pattern.core.parts[1].label = 'Own drop';
  root.pattern.core.parts[1].pattern = copy;
  return { doc, canonical: definition.pattern, copy };
}
it('applies at the same relative address, retaining local identities and unrelated differences', () => {
  const { doc, canonical, copy } = localized();
  const old = canonical.layers[0];
  if (old.kind !== 'settings' || copy.layers[0].kind !== 'settings') throw Error('settings');
  const gain = old.settings.find((s) => s.name === 'gain')!;
  const localGain = copy.layers[0].settings.find((s) => s.name === 'gain')!;
  const changed = replaceNode(doc, gain.id, {
    ...gain,
    value: { ...gain.value, core: { kind: 'constant', value: 0.8 } },
  } as Setting);
  if ('ok' in changed) throw Error(changed.reason);
  expect(findWithPath(changed, localGain.id)?.node).toMatchObject({
    value: { id: localGain.value.id, core: { value: 0.8 } },
  });
  expect(copy.layers[0].settings.find((s) => s.name === 'gain')!.value.core).toMatchObject({
    value: 0.5,
  });
  expect(checkDoc(changed)).toEqual([]);
});
it('keeps a different value at the edited address and names its section in status', () => {
  const { doc, canonical, copy } = localized();
  if (canonical.core.kind !== 'generator' || copy.core.kind !== 'generator')
    throw Error('generator');
  const arg = copy.core.args[0];
  if (arg.kind !== 'pattern' || arg.pattern.core.kind !== 'sequence') throw Error('sequence');
  arg.pattern.core.steps[0] = { kind: 'value', value: 'e2' };
  arg.pattern.core.notation = 'e2 d2';
  const next = replaceAtPath(
    doc,
    [...findWithPath(doc, canonical.id)!.path, 'core', 'args', 0, 'pattern', 'core'],
    {
      kind: 'sequence',
      steps: [
        { kind: 'value', value: 'f2' },
        { kind: 'value', value: 'd2' },
      ],
      notation: 'f2 d2',
    },
  );
  expect(findWithPath(next, copy.id)?.node).toEqual(copy);
  expect(instrumentEditStatus(next)).toBe('One section keeps its own version: Own drop.');
  expect(checkDoc(next, { warnings: true })).toMatchObject({
    errors: [],
    warnings: [expect.stringContaining('Own drop')],
  });
});
it('edits another note in a divergent copy and does not propagate a use-site setting', () => {
  const { doc, canonical, copy } = localized();
  if (canonical.core.kind !== 'generator' || copy.core.kind !== 'generator')
    throw Error('generator');
  const arg = copy.core.args[0];
  if (arg.kind !== 'pattern' || arg.pattern.core.kind !== 'sequence') throw Error('sequence');
  arg.pattern.core.steps[0] = { kind: 'value', value: 'e2' };
  arg.pattern.core.notation = 'e2 d2';
  const next = accept(setRhythmValue(doc, `${canonical.id}:rhythm`, [1], 'g2'));
  expect(sequenceOwner(next, `${copy.id}:rhythm`)?.core).toMatchObject({ notation: 'e2 g2' });
  expect(instrumentEditStatus(next)).toBe('');
  const localSetting = copy.layers[0];
  if (localSetting.kind !== 'settings') throw Error('setting');
  const local = accept(setConstant(next, localSetting.settings[0].id, 0.9));
  expect(findWithPath(local, canonical.id)?.node).toEqual(findWithPath(next, canonical.id)?.node);
});
const accept = (result: Doc | { ok: false; reason: string }): Doc => {
  if ('ok' in result) throw Error(result.reason);
  return result;
};

import { setRhythmValue } from '../src/document/edits/rhythm-set';
import { sequenceOwner } from '../src/document/edits/step-shared';
import { setConstant } from '../src/document/edits/set-constant';

import { constantToSignal } from '../src/document/edits/signal-from-constant';
import { setSignalRange } from '../src/document/edits/signal-range';
import { convertValues } from '../src/document/edits/values-convert';
import { setValue } from '../src/document/edits/values-set';
import { addRewrite } from '../src/document/edits/rewrite-add';
import { setRewriteArgument } from '../src/document/edits/rewrite-argument';
import { moveRewrite } from '../src/document/edits/rewrite-move';
import { removeRewrite } from '../src/document/edits/rewrite-remove';
import { replaceFromSource } from '../src/document/edits/source-node';
import { content, sameContent } from '../src/document/content';
it('all row editor families use the same application, including new nodes, reorder and removal', () => {
  const { doc, canonical, copy } = localized();
  const layer = canonical.layers[0];
  if (layer.kind !== 'settings') throw Error('settings');
  const gain = layer.settings.find((s) => s.name === 'gain')!.id;
  const cutoff = layer.settings.find((s) => s.name === 'cutoff')!.id;
  let next = doc;
  const apply = (result: Doc | { ok: false; reason: string }) => {
    next = accept(result);
    expect(checkDoc(next)).toEqual([]);
    expect(
      sameContent(findWithPath(next, canonical.id)?.node, findWithPath(next, copy.id)?.node),
    ).toBe(true);
  };
  apply(setConstant(next, gain, 0.7));
  apply(convertValues(next, gain, 'values'));
  apply(setValue(next, gain, [0, 1], '0.9'));
  apply(constantToSignal(next, cutoff));
  apply(setSignalRange(next, cutoff, 200, 900));
  apply(addRewrite(next, canonical.id, 'fast'));
  const rewrite = (findWithPath(next, canonical.id)!.node as Pattern).layers.at(-1)!;
  apply(setRewriteArgument(next, rewrite.id, 0, 2));
  apply(addRewrite(next, canonical.id, 'rev'));
  apply(moveRewrite(next, rewrite.id, 1));
  apply(removeRewrite(next, rewrite.id));
  apply(setRhythmValue(next, `${canonical.id}:rhythm`, [0], 'f2'));
  apply(replaceFromSource(next, `${canonical.id}:rhythm`, 'note("g2 a2")'));
  expect(content(findWithPath(doc, copy.id)?.node)).toEqual(content(copy));
});
it('a visible local layer accounts for its value difference, but a missing setting warns', () => {
  const { doc, copy } = localized();
  if (copy.layers[0].kind !== 'settings') throw Error('settings');
  copy.layers[0].settings[0].value.core = { kind: 'constant', value: 0.9 };
  expect(checkDoc(doc, { warnings: true })).toEqual({ errors: [], warnings: [] });
  copy.layers[0].settings.pop();
  expect(checkDoc(doc, { warnings: true })).toMatchObject({
    errors: [],
    warnings: [expect.stringContaining('Own drop')],
  });
});
it('appends a rewrite without replacing a different local setting, and deletes only that rewrite', () => {
  const { doc, canonical, copy } = localized();
  if (copy.layers[0].kind !== 'settings') throw Error('settings');
  copy.layers[0].settings[0].value.core = { kind: 'constant', value: 0.9 };
  const added = accept(addRewrite(doc, canonical.id, 'fast'));
  const own = findWithPath(added, copy.id)!.node as Pattern;
  expect(own.layers[0]).toEqual(copy.layers[0]);
  expect(own.layers.at(-1)).toMatchObject({ kind: 'rewrite', name: 'fast' });
  expect(instrumentEditStatus(added)).toBe('');
  const rewrite = (findWithPath(added, canonical.id)!.node as Pattern).layers.at(-1)!;
  const removed = accept(removeRewrite(added, rewrite.id));
  expect(findWithPath(removed, copy.id)!.node).toEqual(copy);
});
it('literal data fields named like document metadata remain content', () => {
  expect(
    sameContent(
      { kind: 'data', value: { id: 'a', tier: 1 } },
      { kind: 'data', value: { id: 'b', tier: 1 } },
    ),
  ).toBe(false);
});
it('resolves nested rhythm addresses independently inside a locally different group', () => {
  const { doc, canonical, copy } = localized();
  const sharedCore = sequenceOwner(doc, `${canonical.id}:rhythm`)!.core;
  const ownCore = sequenceOwner(doc, `${copy.id}:rhythm`)!.core;
  if (sharedCore.kind !== 'sequence' || ownCore.kind !== 'sequence') throw Error('sequence');
  sharedCore.steps = [{ kind: 'sub', steps: sharedCore.steps }];
  ownCore.steps = [{ kind: 'sub', steps: [{ kind: 'value', value: 'f2' }, ownCore.steps[1]] }];
  sharedCore.notation = '[c2 d2]';
  ownCore.notation = '[f2 d2]';
  const next = accept(setRhythmValue(doc, `${canonical.id}:rhythm`, [0, 1], 'a2'));
  expect(sequenceOwner(next, `${copy.id}:rhythm`)?.core).toMatchObject({ notation: '[f2 a2]' });
  expect(instrumentEditStatus(next)).toBe('');
});
it('moves rewrite order while retaining unrelated localized setting content', () => {
  const { doc, canonical, copy } = localized();
  let next = accept(addRewrite(doc, canonical.id, 'fast'));
  next = accept(addRewrite(next, canonical.id, 'rev'));
  const local = findWithPath(next, copy.id)!.node as Pattern;
  if (local.layers[0].kind !== 'settings') throw Error('settings');
  // Build a stored variation without changing the prior immutable document.
  next = structuredClone(next);
  const own = findWithPath(next, copy.id)!.node as Pattern;
  if (own.layers[0].kind !== 'settings') throw Error('settings');
  own.layers[0].settings[0].value.core = { kind: 'constant', value: 0.9 };
  const fast = (findWithPath(next, canonical.id)!.node as Pattern).layers[1];
  const moved = accept(moveRewrite(next, fast.id, 1));
  expect(
    (findWithPath(moved, copy.id)!.node as Pattern).layers.map((l) =>
      l.kind === 'rewrite' ? l.name : 'settings',
    ),
  ).toEqual(['settings', 'rev', 'fast']);
  expect((findWithPath(moved, copy.id)!.node as Pattern).layers[0]).toEqual(own.layers[0]);
  expect(instrumentEditStatus(moved)).toBe('');
});
