import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { importStrudel } from '../src/import';
import { instruments, sections, type Doc } from '../src/document';
import { describeTarget } from '../src/document/edit';
import { sheetModel } from '../src/sheet/model';
import { queryEventsNode } from '../src/strudel/evaluate-node';
import { generate } from '../src/generate';

for (const name of ['real-house-arranged', 'real-techno'])
  it(`${name}: every sheet selection has a known kind or an explicit reason`, async () => {
    const doc = importStrudel(readFileSync(`corpus/programs/${name}.strudel`, 'utf8')).doc;
    const rows = instruments(doc);
    const events = Object.fromEntries(
      await Promise.all(
        rows.map(async (row) => [
          row.id,
          await queryEventsNode(generate(doc, { only: row.id }), 0, 28),
        ]),
      ),
    );
    const model = sheetModel({
      doc,
      events,
      fromCycle: 0,
      toCycle: 28,
      playhead: null,
      sounds: [],
    });
    const ids = new Set([
      ...model.sections.map((s) => s.nodeId),
      ...model.rows.flatMap((r) => [
        r.id,
        ...r.cells.filter((c) => c.kind !== 'unused').map((c) => c.nodeId),
        ...r.useTargets.map((t) => t.nodeId),
        ...r.rewrites.map((c) => c.nodeId),
      ]),
    ]);
    // No exceptions in these two pieces. Future exceptions must name id and reason here.
    const exceptions: Record<string, string> = {};
    for (const id of ids) {
      const target = describeTarget(doc, id);
      expect(target.node, id).toBeDefined();
      expect(target.breadcrumb.join(' › ')).not.toContain('$');
      if (target.kind === 'unknown') expect(exceptions[id], `${id}: ${target.reason}`).toBeTruthy();
    }
    expect([...ids].filter((id) => describeTarget(doc, id).kind === 'unknown')).toEqual(
      Object.keys(exceptions),
    );
  });

it('handwritten nodes distinguish opaque source, shape generators, sections and layered signals', () => {
  const doc: Doc = {
    version: 1,
    body: [
      {
        id: 'voice',
        tier: 1,
        kind: 'voice',
        name: '$',
        nameSource: 'generated',
        muted: false,
        pattern: {
          id: 'pattern',
          tier: 1,
          label: 'Named',
          comment: 'Not a name',
          core: { kind: 'generator', name: 'mystery', args: [] },
          layers: [
            { id: 'opaque', tier: 3, kind: 'opaque', code: '.unknown()' },
            {
              id: 'settings',
              tier: 1,
              kind: 'settings',
              settings: [
                {
                  id: 'signal',
                  tier: 1,
                  name: 'lpf',
                  value: {
                    id: 'driver',
                    tier: 1,
                    core: { kind: 'signal', shape: 'sine' },
                    layers: [
                      {
                        id: 'slow',
                        tier: 1,
                        kind: 'rewrite',
                        name: 'slow',
                        args: [{ kind: 'literal', value: 2 }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
  expect(describeTarget(doc, 'voice')).toMatchObject({ kind: 'instrument', breadcrumb: ['Named'] });
  expect(describeTarget(doc, 'opaque').kind).toBe('source');
  expect(describeTarget(doc, 'pattern:rhythm').kind).toBe('unknown');
  expect(describeTarget(doc, 'signal').kind).toBe('setting-signal');
  const arranged = importStrudel('const named=note(60); arrange([4,named],[4,named.lpf(900)])').doc;
  for (const section of sections(arranged))
    expect(describeTarget(arranged, section.id).kind).toBe('section');
  const row = instruments(arranged)[0];
  const local = row.uses.flatMap((u) => u.layers).find((l) => l.kind === 'settings');
  if (local?.kind !== 'settings') throw Error('fixture');
  expect(describeTarget(arranged, local.settings[0].id)).toMatchObject({
    instrumentId: row.id,
    section: sections(arranged)[1],
    use: expect.any(Object),
  });
});
