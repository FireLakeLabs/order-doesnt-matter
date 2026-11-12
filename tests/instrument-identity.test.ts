import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { importStrudel } from '../src/import';
import { instruments } from '../src/document';
import { generate } from '../src/generate';
import { queryEvents, queryEventsWithBudget } from '../src/strudel/evaluate';
import { query, plainEvent } from '../src/strudel';
import { instrumentIdentity } from '../src/strudel/instrument-identity';

for (const source of [
  'a: note("c2").s("sine"); b: note("c2").s("sine")',
  readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8'),
])
  it('playback tags preserve values and identify each document row, even identical voices', async () => {
    const doc = importStrudel(source).doc;
    const actual = new Map<string, unknown[]>();
    const tagged = generate(doc, { instrumentTags: true });
    const untagged = await queryEvents(generate(doc), 0, 28);
    expect(await queryEvents(tagged, 0, 28)).toEqual(untagged);
    const result = await queryEventsWithBudget(tagged, 0, 28, 100_000, undefined, 0.5, (p) => {
      for (const hap of query(p, 0, 28)) {
        const id = instrumentIdentity(hap);
        expect(
          id,
          'Pattern.tag must retain canonical row identity through arrangement',
        ).toBeDefined();
        actual.set(id!, [...(actual.get(id!) ?? []), plainEvent(hap)]);
      }
    });
    expect(result.error).toBe(null);
    const stable = (v: unknown): string =>
      JSON.stringify(v, (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value,
      );
    for (const row of instruments(doc)) {
      const expected = await queryEvents(generate(doc, { only: row.id }), 0, 28);
      // Querying a whole range may split fragments differently; note starts are the contract.
      const starts = (events: typeof expected.events) =>
        events
          .filter((e) => e.hasOnset)
          .map(stable)
          .sort();
      expect(starts(actual.get(row.id) as typeof expected.events)).toEqual(starts(expected.events));
    }
  });
