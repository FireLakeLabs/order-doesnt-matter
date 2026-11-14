import { expect, test } from 'vitest';
import { sections } from '../document';
import { importStrudel } from '../import';
import { contextLabels } from './context';

test('pinned editing and playing labels remain independent, including repeated sections', () => {
  const song = sections(importStrudel('arrange([4,s("sine")],[8,s("triangle")])').doc);
  expect(contextLabels(song, 4, 1)).toEqual({
    editing: `Editing ${song[1].name}`,
    playback: `Playing ${song[0].name} · cycles 0–4`,
  });
  expect(contextLabels(song, 4, 13).playback).toBe(`Playing ${song[0].name} · cycles 12–16`);
  expect(contextLabels(song, 4, null).playback).toBe(
    `Playback paused · preview ${song[1].name} · cycles 4–12`,
  );
  expect(contextLabels([], 8, 17).playback).toBe('Playing cycles 16–20');
});
