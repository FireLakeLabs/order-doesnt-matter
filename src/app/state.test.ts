import { expect, it } from 'vitest';
import { importStrudel } from '../import';
import {
  initialState,
  loadPiece,
  loadFailure,
  selectSection,
  setFollow,
  tick,
  mergeSounds,
  startCycle,
} from './state';
const arranged = 'const a=s("bd"); const b=note(60).s("sine"); arrange([2,a],[3,b])';
const loaded = () => loadPiece(initialState(), arranged, importStrudel(arranged));
it('loads source, document, sections and first window, with sounds not loaded yet', () => {
  const s = loaded();
  expect(s.source).toBe(arranged);
  expect(s.rows).toHaveLength(2);
  expect(s.sections.map((p) => p.name)).toEqual(['a', 'b']);
  expect([s.fromCycle, s.toCycle, s.follow]).toEqual([0, 2, true]);
  expect(mergeSounds(s.sounds, ['bd', 'sine'], [])).toEqual([
    { name: 'bd', state: 'not-loaded' },
    { name: 'sine', state: 'not-loaded' },
  ]);
});
it('failed parse keeps previous piece, events and playing state', () => {
  const s = { ...loaded(), playing: true };
  const failed = loadFailure(s);
  expect(failed.doc).toBe(s.doc);
  expect(failed.events).toBe(s.events);
  expect(failed.playing).toBe(true);
  expect(failed.loadError).toContain('Could not read');
});
it('click pins a section until Follow, and starting pinned playback seeks its beginning', () => {
  let s = selectSection(loaded(), loaded().sections[1].id);
  expect([s.follow, s.fromCycle, s.toCycle, startCycle(s)]).toEqual([false, 2, 5, 2]);
  s = tick(s, 6);
  expect(s.fromCycle).toBe(2);
  s = tick(setFollow(s, true), 6);
  expect([s.fromCycle, s.toCycle, startCycle(s)]).toEqual([5, 7, 0]);
  s = tick(s, 8);
  expect([s.fromCycle, s.toCycle]).toEqual([7, 10]);
});
it('pages a sectionless score by four real cycles, including late cycles', () => {
  let s = loadPiece(initialState(), 's("bd")', importStrudel('s("bd")'));
  expect([s.fromCycle, s.toCycle]).toEqual([0, 4]);
  s = tick(s, 8.3);
  expect([s.fromCycle, s.toCycle]).toEqual([8, 12]);
  expect(tick(s, 8.7)).toBe(s);
});
it('sound updates merge by name without erasing unrelated states', () => {
  const first = mergeSounds([], ['bd', 'hh'], [{ name: 'bd', state: 'loading' }]);
  expect(first.map((s) => s.state)).toEqual(['loading', 'not-loaded']);
  const second = mergeSounds(
    first,
    ['bd', 'hh'],
    [
      { name: 'bd', state: 'ready' },
      { name: 'hh', state: 'missing', detail: 'offline' },
    ],
  );
  expect(second).toEqual([
    { name: 'bd', state: 'ready' },
    { name: 'hh', state: 'missing', detail: 'offline' },
  ]);
});
