import { readFileSync } from 'node:fs';
import { initialState, loadPiece } from '../../src/app/state';
import { importStrudel } from '../../src/import';
import { generate } from '../../src/generate';
import { buildFrame, viewNotes, neededRange } from '../../src/studio/frame';
import { themes } from '../../src/studio/themes';
import { queryEventsNode } from '../node-query';

export async function soundstageCorpusFrame(file = 'real-dubstep-arranged', now = 10.4) {
  const source = readFileSync(`corpus/programs/${file}.strudel`, 'utf8');
  const state = loadPiece(initialState(), source, importStrudel(source));
  const { from, to } = neededRange('window', now, 1, state.sections);
  const events = Object.fromEntries(
    await Promise.all(
      state.rows.map(async (row) => {
        const result = await queryEventsNode(generate(state.doc!, { only: row.id }), from, to);
        if (result.error) throw Error(result.error.message);
        return [row.id, result];
      }),
    ),
  );
  const score = { from, to, events };
  return buildFrame({
    state,
    score,
    notes: viewNotes(score),
    now,
    playing: false,
    cps: 140 / 240,
    theme: themes.arcade,
    lookAhead: 1,
    trails: 1,
    width: 1300,
    height: 675,
    dpr: 1,
  });
}
