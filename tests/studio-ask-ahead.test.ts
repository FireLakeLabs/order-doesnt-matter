import { expect, test } from 'vitest';
import { initialState, loadPiece } from '../src/app/state';
import { importStrudel } from '../src/import';
import { scoreAheadRange } from '../src/studio/lanes/ask-ahead';

const state = loadPiece(
  initialState(),
  '',
  importStrudel('arrange([4,s("bd")],[4,s("sd")],[8,s("hh")],[4,s("cp")],[8,s("oh")])'),
);

test('Follow asks exactly one section ahead, including absolute song repeats', () => {
  for (const [now, from, to] of [
    [0, 4, 8],
    [3.9, 4, 8],
    [4, 8, 16],
    [8, 16, 20],
    [16, 20, 28],
    [20, 28, 32],
    [28, 32, 36],
  ])
    expect(scoreAheadRange(state, now, true, null)).toMatchObject({ from, to });
  expect(scoreAheadRange(state, 2, false, null)).toBeNull();
  expect(scoreAheadRange({ ...state, follow: false }, 2, true, null)).toBeNull();
});

test('transport loops ask the actual destination, including mid-section and within-section loops', () => {
  expect(scoreAheadRange(state, 20, true, { from: 0, to: 28 })).toMatchObject({ from: 0, to: 4 });
  expect(scoreAheadRange(state, 8, true, { from: 5, to: 10 })).toMatchObject({ from: 4, to: 8 });
  expect(scoreAheadRange(state, 5, true, { from: 5, to: 10 })).toMatchObject({ from: 8, to: 16 });
  expect(scoreAheadRange(state, 9, true, { from: 9, to: 10 })).toBeNull();
  expect(scoreAheadRange({ ...state, sections: [] }, 3, true, null)).toMatchObject({
    from: 4,
    to: 8,
  });
});
