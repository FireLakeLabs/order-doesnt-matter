import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { checkDoc, instruments, walk, type Doc } from '../src/document';
import { importStrudel } from '../src/import';
import { parseSteps, printSteps } from '../src/import/mini';
import { generate } from '../src/generate';
import { queryEvents } from '../src/strudel/evaluate';
import { queryEventsNode } from './node-query';
import { createEditSession } from '../src/editor/session';
import { replaceMiniStep } from '../src/document/edits/mini-replace';
import { spliceMiniSteps } from '../src/document/edits/mini-splice';
import { setMiniMark } from '../src/document/edits/mini-mark';
import { miniStepAt, sequenceOwner, stepChildren } from '../src/document/edits/step-shared';
import { layoutRhythm } from '../src/document/edits/rhythm-layout';
import { euclidRhythm } from '../src/document/edits/rhythm-euclid';
import { rhythmPulses } from '../src/document/edits/rhythm-pulses';
const load = (s: string) =>
  importStrudel(`setcpm(33); stack(note(${JSON.stringify(s)}).s("triangle"),s("bd*4").gain(.2))`)
    .doc;
const id = (d: Doc) => `${instruments(d)[0].pattern.id}:rhythm`;
const steps = (d: Doc) => {
  const c = sequenceOwner(d, id(d))!.core;
  if (c.kind !== 'sequence') throw Error('Expected sequence');
  return c.steps;
};
const good = (d: Doc | { ok: false; reason: string }): Doc => {
  if ('ok' in d) throw Error(d.reason);
  return d;
};
function freeze(v: unknown) {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
}
const windows = [
  [-2.25, -0.125],
  [0.125, 2.5],
  [17.25, 19.125],
  [17.25, 19.125],
] as const;
// Original mini motifs; real pinned engine answers, including fragments, values,
// tempo, errors, and repeated absolute-time random questions (no audio claim).
for (const text of [
  '{fs2 a2 cs3,e3 ~}%4',
  '[fs2 a2|~|[cs3|e3]]?',
  'fs2*<1 [2@2 3]>/2',
  'fs2*<1 ~>',
  'fs2(<2 ~>,8)',
  'fs2(2,<8 ~>)',
  'fs2(<2 -3>,<8 9>,<0 -1>)',
  'fs2!2!3@2@3?0.2?',
  'fs2?0.2!2@3*2*3/2',
  'fs2@3!2?0.3',
  'fs2(-3,8,-1)*2',
  'fs2*2(3,8)',
  '{fs2 a2}%<2 3>',
])
  it(`pinned round trip and time-addressed choices: ${text}`, async () => {
    const parsed = parseSteps(text),
      printed = printSteps(parsed);
    expect(parseSteps(printed)).toEqual(parsed);
    const doc = load(text);
    expect(checkDoc(doc)).toEqual([]);
    for (const [from, to] of windows) {
      const original = await queryEvents(
        `setcpm(33); stack(note(${JSON.stringify(text)}).s("triangle"),s("bd*4").gain(.2))`,
        from,
        to,
      );
      expect(original.error).toBeNull();
      expect(await queryEvents(generate(doc), from, to)).toEqual(original);
    }
  });
it('signed Euclid is complement first, then right rotation; zero and extrema are explicit', async () => {
  for (const [hits, turn, indices] of [
    [-3, 0, [1, 2, 4, 5, 7]],
    [-3, 1, [0, 2, 3, 5, 6]],
    [-3, -1, [0, 1, 3, 4, 6]],
    [0, 0, []],
    [8, 0, [0, 1, 2, 3, 4, 5, 6, 7]],
    [-8, 0, []],
  ] as const) {
    const r = await queryEvents(`note("fs2(${hits},8,${turn})")`, 0, 1);
    expect(r.error).toBeNull();
    expect(r.events.map((e) => e.whole![0]).sort((a, b) => a - b)).toEqual(
      indices.map((i) => i / 8),
    );
    const pulses = rhythmPulses(parseSteps(`fs2(${hits},8,${turn})`)[0], 0, 1)!;
    expect(pulses.filter((p) => p.value).map((p) => p.start)).toEqual(indices.map((i) => i / 8));
    const doc = load('fs2');
    expect(printSteps(steps(good(euclidRhythm(doc, id(doc), [0], hits, 8, turn))))).toBe(
      `fs2(${hits},8,${turn})`,
    );
  }
  for (const text of ['fs2(9,8)', 'fs2(-9,8)', 'fs2(1,0)', 'fs2(1.5,8)']) {
    const r = await queryEvents(`note("${text}")`, 0, 1);
    expect(r.error, text).not.toBeNull();
    expect(printSteps(parseSteps(text))).toBe(text);
  }
});
it('patterned arguments use actual cycles, not a fixed grid', async () => {
  const onsets = async (text: string, a: number, b: number) => {
    const r = await queryEvents(`note("${text}")`, a, b);
    expect(r.error).toBeNull();
    return r.events
      .filter((e) => e.hasOnset)
      .map((e) => e.whole![0])
      .sort((x, y) => x - y);
  };
  expect(await onsets('fs2*<1 2>', 0, 2)).toEqual([0, 1, 1.5]);
  expect(await onsets('fs2/<1 2>', 0, 3)).toEqual([0, 2]);
  expect(await onsets('fs2(<2 3>,8,<0 1>)', 0, 2)).toEqual([0, 0.5, 1.125, 1.5, 1.875]);
  expect(await onsets('fs2(2,<8 4>)', 0, 2)).toEqual([0, 0.5, 1, 1.5]);
  for (const text of ['fs2*<1 2>@3 a2', 'fs2(<2 3>,8) a2', 'fs2(<-3 -2>,8)']) {
    const layout = layoutRhythm(parseSteps(text));
    expect(layout[0].opaque).toBe(true);
  }
});
it('precise roles use stored paths, without widening ordinary number[] traversal', () => {
  const s = parseSteps('{fs2 a2,e3 ~}%4 [fs2|~] fs2(<2 3>,8,<0 1>) fs2*<1 2>');
  expect(stepChildren(s[0]).map((c) => [c.role, c.path])).toEqual([
    ['lane', ['steps', 0]],
    ['lane', ['steps', 1]],
    ['per', ['per']],
  ]);
  expect(stepChildren(s[1]).map((c) => c.role)).toEqual(['candidate', 'candidate']);
  expect(miniStepAt(s, [0, 'steps', 1, 'steps', 0])).toEqual({ kind: 'value', value: 'e3' });
  expect(miniStepAt(s, [2, 'pulses', 'steps', 1])).toEqual({ kind: 'value', value: '3' });
  expect(miniStepAt(s, [3, 'expression', 'marks', 0, 'amount', 'steps', 1])).toEqual({
    kind: 'value',
    value: '2',
  });
  for (const path of [[0, 1], [0, 'per', 'steps'], [-1], [2, 'steps', 0]])
    expect(miniStepAt(s, path)).toBeUndefined();
});
it('lane/candidate/argument/occurrence edits preserve unrelated references and ordered punctuation', async () => {
  const doc = load('{fs2 a2,e3 ~}%4 [fs2|a2|~] fs2(<2 3>,8) fs2*2*3!2!3@2@3?0.3?');
  freeze(doc);
  const snapshot = JSON.stringify(doc);
  const cases = [
    [[0, 'steps', 1, 'steps', 0], 'g3', '{fs2 a2,g3 ~}%4'],
    [[1, 'steps', 1], 'cs3', '[fs2|cs3|~]'],
    [[2, 'pulses', 'steps', 1], '-3', 'fs2(<2 -3>,8)'],
    [[3, 'expression', 'marks', 1, 'amount'], '<2 4>', 'fs2*2*<2 4>!2!3@2@3?0.3?'],
  ] as const;
  for (const [path, value, expected] of cases) {
    const next = good(replaceMiniStep(doc, id(doc), path, value));
    expect(JSON.stringify(doc)).toBe(snapshot);
    expect(printSteps([steps(next)[Number(path[0])]])).toBe(expected);
    expect(next.body).not.toBe(doc.body);
    for (let i = 0; i < 4; i++) if (i !== path[0]) expect(steps(next)[i]).toBe(steps(doc)[i]);
    expect(instruments(next)[1].pattern).toBe(instruments(doc)[1].pattern);
    const ids = (d: Doc) => {
      const found: string[] = [];
      walk(d, (n) => found.push(n.id));
      return found;
    };
    expect(ids(next)).toEqual(ids(doc));
    const direct = printSteps(steps(doc)).replace(
      printSteps([steps(doc)[Number(path[0])]]),
      expected,
    );
    for (const [from, to] of windows) {
      const answer = await queryEvents(generate(next), from, to);
      expect(answer.error).toBeNull();
      expect(answer).toEqual(await queryEvents(generate(load(direct)), from, to));
    }
  }
  const marked = good(
    setMiniMark(doc, id(doc), [3], 1, { name: 'slower', amount: { kind: 'value', value: '2' } }),
  );
  expect(printSteps([steps(marked)[3]])).toBe('fs2*2/2!2!3@2@3?0.3?');
  const added = good(spliceMiniSteps(doc, id(doc), [1, 'steps'], 1, 0, 'cs3'));
  expect(printSteps([steps(added)[1]])).toBe('[fs2|cs3|a2|~]');
  const removed = good(spliceMiniSteps(added, id(doc), [1, 'steps'], 1, 1));
  expect(steps(removed)).toEqual(steps(doc));
  const lane = good(spliceMiniSteps(doc, id(doc), [0, 'steps'], 1, 1, '[g3 ~ b3]'));
  expect(printSteps([steps(lane)[0]])).toBe('{fs2 a2,g3 ~ b3}%4');
});
it('invalid/unproven edits retain the original document and fallback source', () => {
  const doc = load('fs2(<2 3>,8) fs2*<1 2> [fs2|a2] {fs2 a2,e3}%4 fs2:2');
  freeze(doc);
  const before = JSON.stringify(doc);
  for (const [path, value] of [
    [[0, 'pulses'], '<2 -9>'],
    [[0, 'pulses'], '1.5'],
    [[0, 'steps'], '0'],
    [[0, 'step'], 'a2@0.1'],
    [[0, 'step'], 'a2!2'],
    [[0, 'rotation'], '1'],
    [[1, 'expression', 'marks', 0, 'amount'], '<0 2>'],
    [[1, 'expression', 'step'], 'a2@0.1'],
    [[1, 'expression', 'step'], 'a2?'],
    [[1, 'expression', 'marks', 0, 'amount'], '<1 ~>'],
    [[3, 'per'], '<2 3>'],
    [[3, 'steps', 0], 'a2'],
    [[4, 'expression', 'step'], 'a2'],
    [[0], '['],
    [[0], 'fs2*0'],
    [[0], 'fs2(3,2048)'],
    [[0], 'fs2*Infinity'],
    [[0], 'fs2!1000000'],
  ] as const)
    expect(replaceMiniStep(doc, id(doc), path, value)).toHaveProperty('ok', false);
  expect(spliceMiniSteps(doc, id(doc), [2, 'steps'], 0, 2, 'a2')).toHaveProperty('ok', false);
  expect(spliceMiniSteps(doc, id(doc), [3, 'steps'], 0, 1, 'a2')).toHaveProperty('ok', false);
  expect(spliceMiniSteps(doc, id(doc), [0, 'steps'], 0, 1)).toHaveProperty('ok', false);
  expect(
    setMiniMark(doc, id(doc), [1], 0, { name: 'faster', amount: { kind: 'value', value: '0' } }),
  ).toHaveProperty('ok', false);
  expect(JSON.stringify(doc)).toBe(before);
  expect(printSteps([steps(doc)[4]])).toBe('fs2:2');
});
it('original Kiln-derived piece: one selected lane changes, other instruments and session Undo are exact', async () => {
  const original = readFileSync('corpus/programs/piece-kiln.strudel', 'utf8');
  const motif = '{fs2 a2 cs3,e3 ~}%4 [fs2|a2|~] fs2*<1 2> fs2(<2 -3>,8,<0 1>)';
  const source = original.replace('fs2 fs2 a2 cs3', motif);
  const doc = importStrudel(source).doc,
    bass = instruments(doc).find((r) => r.name === 'bass')!;
  const target = `${bass.pattern.id}:rhythm`;
  freeze(doc);
  const after = good(replaceMiniStep(doc, target, [0, 'steps', 1, 'steps', 0], 'g3'));
  const reference = source.replace('cs3,e3 ~', 'cs3,g3 ~');
  for (const [from, to] of [
    [-1.5, 0.25],
    [4.125, 6.5],
    [17.25, 19.5],
    [17.25, 19.5],
  ] as const) {
    expect(await queryEventsNode(generate(doc), from, to)).toEqual(
      await queryEventsNode(source, from, to),
    );
    const actual = await queryEventsNode(generate(after), from, to);
    expect(actual.error).toBeNull();
    expect(actual).toEqual(await queryEventsNode(reference, from, to));
  }
  for (const row of instruments(doc).filter((r) => r.id !== bass.id)) {
    expect(await queryEventsNode(generate(after, { only: row.id }), 4, 20)).toEqual(
      await queryEventsNode(generate(doc, { only: row.id }), 4, 20),
    );
    expect(instruments(after).find((r) => r.id === row.id)!.pattern).toBe(row.pattern);
  }
  const session = createEditSession(doc, {
    playing: () => false,
    play: async () => 1,
    changed() {},
    refresh() {},
  });
  try {
    session.apply(after, {}, target);
    expect(session.state.doc).toBe(after);
    session.undo();
    expect(session.state.doc).toBe(doc);
    expect(JSON.stringify(session.state.doc)).toBe(JSON.stringify(doc));
    expect(generate(session.state.doc)).toBe(generate(doc));
    expect(await queryEventsNode(generate(session.state.doc), 4, 8)).toEqual(
      await queryEventsNode(source, 4, 8),
    );
  } finally {
    session.dispose();
  }
});

it('legacy v2 opaque marks remain playable and can be promoted without replacing IDs', () => {
  const doc = load('fs2*2*3');
  const original = steps(doc)[0];
  if (original.kind !== 'other') throw Error('Expected chunk');
  delete original.expression;
  const serialized = JSON.parse(JSON.stringify(doc)) as Doc;
  expect(checkDoc(serialized)).toEqual([]);
  const promoted = good(replaceMiniStep(serialized, id(serialized), [0], original.notation));
  expect(steps(promoted)[0]).toHaveProperty('expression');
  expect(generate(promoted)).toBe(generate(serialized));
  const edited = good(
    setMiniMark(serialized, id(serialized), [0], 1, {
      name: 'faster',
      amount: { kind: 'value', value: '4' },
    }),
  );
  expect(printSteps(steps(edited))).toBe('fs2*2*4');
});

it('signed literal pulse spans match the engine across partial, negative, and later windows', async () => {
  for (const text of [
    'fs2(-3,8)',
    'fs2(-3,8,-1)',
    'fs2(-3,8,1)',
    'fs2(-8,8)',
    'fs2(1024,1024)',
    'fs2(-1024,1024)',
  ]) {
    const step = parseSteps(text)[0];
    for (const [from, to] of [
      [-0.75, 0.25],
      [17.125, 18.25],
    ] as const) {
      const r = await queryEvents(`note("${text}")`, from, to);
      expect(r.error).toBeNull();
      const pulses = rhythmPulses(step, from, to)!;
      const key = (whole: number[], part: number[]) => JSON.stringify([whole, part]);
      expect(
        pulses
          .filter((p) => p.value)
          .map((p) => key([p.start, p.end], [p.from, p.to]))
          .sort(),
      ).toEqual(r.events.map((e) => key(e.whole!, e.part)).sort());
    }
  }
});
