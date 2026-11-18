import { expect, test } from '@playwright/test';
import { viewSmoke } from './view-smoke';
import { prepare } from './view-evidence';
import { scoreFrame } from '../views/score-fixture';
import { indexTubes, racks } from '../../src/views/tubes/model';
import { tubeLayout } from '../../src/views/tubes/geometry';
import { vesselBody } from '../../src/views/tubes/vessels';

viewSmoke(test, 'tubes');

test('tubes: range labels and readouts survive onset bubbles in every family and theme', async ({
  page,
}) => {
  await prepare(page, 'tubes');
  const frame = scoreFrame();
  frame.cps = 1;
  frame.instruments[0].settings = ['lpf', 'room', 'gain', 'pan', 'note', 'custom'].map((name) => ({
    name,
    label: name,
    kind: 'values',
  }));
  frame.notes = [0, 1, 2].map((start) => ({
    instrument: '0',
    start,
    end: start + 1,
    hasOnset: true,
    value: {
      cutoff: start % 2,
      room: start % 2,
      gain: start % 2,
      pan: start % 2,
      note: 48 + (start % 2) * 24,
      custom: start % 2,
    },
  }));
  const boxes = tubeLayout(frame, racks({ ...frame, now: 1.2 }, indexTubes(frame.notes))).tubes.map(
    vesselBody,
  );
  const regions = boxes.flatMap((b) => [
    { x: b.x, y: b.top + 12, height: 11 },
    { x: b.x, y: b.bottom - 8, height: 11 },
    { x: b.x, y: b.bottom + 34, height: 16 },
  ]);
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
    const result = await page.evaluate(
      async ({ frame, regions }) => {
        await document.fonts.ready;
        const el = document.createElement('div');
        const handle = await window.viewProbe.definition.mount(el);
        const canvas = el.querySelector('canvas')!;
        const c = canvas.getContext('2d')!;
        const fillText = c.fillText.bind(c);
        let labels: {
          x: number;
          y: number;
          width: number;
          height: number;
          pixels: Uint8ClampedArray;
        }[] = [];
        // Capture each label as soon as it is painted. No later liquid, bubble or
        // vessel decoration may change those pixels by the end of the frame.
        c.fillText = (text, x, y, maxWidth) => {
          fillText(text, x, y, maxWidth);
          const region = regions.find((r) => r.x === x && r.y === y);
          if (!region) return;
          const width = Math.ceil(Math.min(maxWidth ?? Infinity, c.measureText(text).width)) + 4;
          const rect = {
            x: Math.floor(x - width / 2),
            y: Math.floor(y - region.height + 3),
            width,
            height: region.height,
          };
          labels.push({ ...rect, pixels: c.getImageData(rect.x, rect.y, width, rect.height).data });
        };
        const obscured: number[] = [];
        const theme = window.viewProbe.frame!.theme;
        const draw = (now: number) => handle.frame({ ...frame, theme, now });
        // Cover the rise and fall, pour and slosh, onset and bubble lifetime, then
        // revisit an earlier moment to exercise arbitrary seek order.
        for (const now of [1, 1.02, 1.06, 1.12, 1.2, 1.399, 1.4, 2.02, 2.12, 2.2, 1.2]) {
          labels = [];
          draw(now);
          if (labels.length !== regions.length) throw Error('Missing range label or value readout');
          for (const label of labels) {
            const final = c.getImageData(label.x, label.y, label.width, label.height).data;
            if (final.some((v, i) => v !== label.pixels[i])) obscured.push(now);
          }
        }
        draw(1.2);
        const before = canvas.toDataURL();
        draw(2.2);
        draw(1.2);
        const reversible = before === canvas.toDataURL();
        handle.dispose();
        const fresh = await window.viewProbe.definition.mount(el);
        fresh.frame({ ...frame, theme, now: 1.2 });
        const remount = before === el.querySelector('canvas')!.toDataURL();
        fresh.dispose();
        return { obscured, reversible, remount };
      },
      { frame, regions },
    );
    expect(result, theme).toEqual({ obscured: [], reversible: true, remount: true });
  }
});
