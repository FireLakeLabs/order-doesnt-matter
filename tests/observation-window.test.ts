import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { instruments, sections } from '../src/document';
import { importStrudel } from '../src/import';
import { futureInstrumentCycle } from './observation-window';

const doc = importStrudel(readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8')).doc;
const kick = instruments(doc).find((row) => row.name === 'kick')!;

test('late observation avoids the real breakdown and intro before examining any kick callbacks', () => {
  expect(futureInstrumentCycle(sections(doc), kick.id, 7.816)).toBe(9);
  expect(futureInstrumentCycle(sections(doc), kick.id, 14.173333)).toBe(20);
  expect(futureInstrumentCycle(sections(doc), kick.id, 26.5)).toBe(36);
});

test('invalid clocks and absent or too-short instrument windows fail explicitly', () => {
  expect(() => futureInstrumentCycle(sections(doc), kick.id, Infinity)).toThrow('finite');
  expect(() => futureInstrumentCycle(sections(doc), 'missing', 0)).toThrow('No complete');
  expect(() =>
    futureInstrumentCycle(
      [
        {
          id: 'short',
          name: 'short',
          nameSource: 'author',
          start: 0,
          cycles: 0.5,
          instrumentIds: ['a'],
        },
      ],
      'a',
      0,
    ),
  ).toThrow('No complete');
});
