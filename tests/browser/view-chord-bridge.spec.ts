import { expect, test } from '@playwright/test';
import { viewSmoke } from './view-smoke';
import { prepare } from './view-evidence';
viewSmoke(test, 'chord-bridge');

test('chord-bridge: a held pitch keeps its drawn height as a sibling ends or leaves the score', async ({
  page,
}) => {
  await prepare(page, 'chord-bridge');
  const ticks = await page.evaluate(async () => {
    await document.fonts.ready;
    const source = {
      ...window.viewProbe.frame!,
      from: 16,
      to: 20,
      width: 1300,
      height: 760,
      dpr: 1,
      lookAhead: 4,
    };
    const instrument = source.instruments[0].id;
    const note = (midi: number, start: number, end: number) => ({
      instrument,
      start,
      end,
      hasOnset: true,
      value: { note: midi },
    });
    const notes = [note(60, 16, 20), note(61, 16, 17.375), note(48, 18, 19), note(55, 18, 19)];
    const el = document.createElement('div');
    const handle = await window.viewProbe.definition.mount(el);
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    const draw = (now: number, score = notes) => {
      const ys: number[] = [];
      CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
        if (w === 8 && h === 6) ys.push(y);
        fill.call(this, x, y, w, h);
      };
      try {
        handle.frame({ ...source, now, notes: score });
      } finally {
        CanvasRenderingContext2D.prototype.fillRect = fill;
      }
      return ys;
    };
    const before = draw(17.3),
      ended = draw(17.4),
      removed = draw(17.4, [notes[0], ...notes.slice(2)]);
    handle.dispose();
    return { before, ended, removed };
  });
  expect(ticks.before).toHaveLength(4);
  expect(ticks.ended).toHaveLength(4);
  expect(ticks.removed).toHaveLength(3);
  expect(ticks.before[0]).toBe(ticks.ended[0]);
  expect(ticks.before[0]).toBe(ticks.removed[0]);
});
