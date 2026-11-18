import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { indexMarbles, machineLayout, machineState } from '../../src/views/marble-run/model';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/marble-run`;
test('Marble run: real Studio mapping, themes, reversible pixels and CPU submission', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'marble-run');
  await page.setViewportSize({ width: 2560, height: 1440 });
  const chooseB = page
    .locator('[data-region="view-shelf"]')
    .locator('[data-view="loom"] .view-to-b');
  await revealView(chooseB);
  await chooseB.click();
  await page
    .getByRole('group', { name: 'Window', exact: true })
    .getByRole('button', { name: '2', exact: true })
    .click();
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 10.4 &&
      window.viewProbe.frame.lookAhead === 2 &&
      window.viewProbe.frame.from === 4 &&
      window.viewProbe.frame.to === 18,
  );
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await expect(page.locator('[data-region="stage-b"] .view-status')).toHaveText('');
  const themes = ['arcade', 'sunset', 'phosphor', 'riso', 'pocket'];
  const themeFrames = [];
  for (const theme of themes) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    themeFrames.push(await page.evaluate(() => window.viewProbe.frame!));
    await page.screenshot({ path: `${shots}/${theme}-1920x1080.png` });
  }
  const frame = themeFrames[0];
  const score = indexMarbles(frame.notes);
  const mapping = machineLayout(frame, score).map((machine) => {
    const state = machineState(machine, score, frame);
    return {
      name: frame.instruments.find((i) => i.id === machine.id)!.name,
      targets: machine.targets,
      flying: state.flying,
      landed: state.rolling,
      carried: state.carried,
      merged: state.merged,
    };
  });
  expect(mapping.reduce((n, m) => n + m.flying, 0)).toBe(30);
  expect(mapping.reduce((n, m) => n + m.landed, 0)).toBe(3);
  expect(mapping.reduce((n, m) => n + m.carried, 0)).toBe(0);
  const next = frame.notes
    .filter((n) => n.hasOnset && n.start > 10.4 && n.start <= 10.5)
    .map((n) => ({
      name: frame.instruments.find((i) => i.id === n.instrument)!.name,
      cycle: n.start,
      seconds: (n.start - 10.4) / frame.cps,
    }));
  const crossing = {
    ...frame,
    width: 1131,
    height: 469,
    dpr: 1,
    notes: [
      {
        instrument: frame.instruments[0].id,
        start: 10.72,
        end: 11.72,
        hasOnset: true,
        value: { gain: 1 },
      },
    ],
  };
  const pixelCases = [
    crossing,
    {
      ...crossing,
      notes: [true, false, false].map((hasOnset) => ({
        instrument: frame.instruments[0].id,
        start: 10,
        end: 11,
        hasOnset,
        value: { gain: 1 },
      })),
    },
  ];
  const pixels = [];
  for (const pixelFrame of pixelCases) {
    const indexed = indexMarbles(pixelFrame.notes);
    const mark = machineState(
      machineLayout(pixelFrame, indexed)[0],
      indexed,
      pixelFrame,
    ).marks.find((m) => !m.carried)!;
    const pixel = await page.evaluate(
      async ({ frame, x, y }) => {
        const el = document.createElement('div');
        document.body.append(el);
        const handle = await window.viewProbe.definition.mount(el);
        handle.frame(frame);
        const pixel = [
          ...el
            .querySelector('canvas')!
            .getContext('2d')!
            .getImageData(Math.floor(x), Math.floor(y), 1, 1).data,
        ];
        handle.dispose();
        el.remove();
        return pixel;
      },
      { frame: pixelFrame, x: mark.x, y: mark.y },
    );
    const expectedPixel = frame.instruments[0].colour
      .match(/[a-f\d]{2}/gi)!
      .map((v) => parseInt(v, 16));
    expect(pixel).toEqual([...expectedPixel, 255]);
    pixels.push(pixel);
  }
  const scenarios = themeFrames.flatMap((source) => [
    { ...source, scenario: 'real' },
    {
      ...source,
      scenario: 'octaves',
      notes: [12, 24, 27, 36, 39, 48, 51, 60, 72, 84].map((note) => ({
        instrument: source.instruments[0].id,
        start: 10,
        end: 11,
        hasOnset: true,
        value: { note, gain: 0.75 },
      })),
    },
  ]);
  const barCases = scenarios.flatMap((source, index) =>
    [
      [1300, 760],
      [560, 675],
      [source.width, source.height],
    ].map(([width, height]) => ({
      index,
      width,
      height,
      bars: machineLayout({ ...source, width, height }, indexMarbles(source.notes))
        .flatMap((m) => m.targets)
        .filter((t) => t.kind === 'bar')
        .map((t) => ({
          left: t.x - 1,
          right: t.x + t.length + 1,
          top: t.y - 1,
          bottom: t.y + t.thickness + 4,
        })),
    })),
  );
  const measured = await page.evaluate(
    async ({ sources, barCases }) => {
      const el = document.createElement('div');
      document.body.append(el);
      const handle = await window.viewProbe.definition.mount(el);
      const results = [];
      for (const [sourceIndex, source] of sources.entries()) {
        const frame = { ...source, width: 1300, height: 760, dpr: 1 };
        handle.frame(frame);
        const picture = el.querySelector('canvas')!.toDataURL();
        handle.frame({ ...frame, now: 2, width: 560, height: 675 });
        handle.frame({ ...frame, now: 22 });
        handle.frame(frame);
        const reversible = picture === el.querySelector('canvas')!.toDataURL();
        const c = (hex: string) =>
          hex
            .match(/[a-f\d]{2}/gi)!
            .map((v) => {
              const s = parseInt(v, 16) / 255;
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            })
            .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
        const contrast =
          (Math.max(c(frame.theme.text), c(frame.theme.ground)) + 0.05) /
          (Math.min(c(frame.theme.text), c(frame.theme.ground)) + 0.05);
        const labelsBySize = [];
        for (const [width, height] of [
          [1300, 760],
          [560, 675],
          [source.width, source.height],
        ]) {
          const labels: {
            text: string;
            x: number;
            y: number;
            right: number;
            bottom: number;
            size: number;
            plate: { left: number; right: number; top: number; bottom: number };
          }[] = [];
          const original = CanvasRenderingContext2D.prototype.fillText;
          CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
            const metrics = this.measureText(text);
            labels.push({
              text,
              x: x - metrics.actualBoundingBoxLeft,
              y: y - metrics.actualBoundingBoxAscent,
              right: x + metrics.actualBoundingBoxRight,
              bottom: y + metrics.actualBoundingBoxDescent,
              size: parseFloat(this.font),
              plate: { left: x - 2, right: x + metrics.width + 2, top: y - 11, bottom: y + 3 },
            });
            if (maxWidth === undefined) original.call(this, text, x, y);
            else original.call(this, text, x, y, maxWidth);
          };
          try {
            handle.frame({ ...frame, width, height });
          } finally {
            CanvasRenderingContext2D.prototype.fillText = original;
          }
          const overlaps = labels.flatMap((a, i) =>
            labels
              .slice(i + 1)
              .filter((b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom)
              .map((b) => [a.text, b.text]),
          );
          const bars = barCases.find(
            (c) => c.index === sourceIndex && c.width === width && c.height === height,
          )!.bars;
          const drawingOverlaps = labels.flatMap((l) =>
            bars
              .filter(
                (b) =>
                  l.plate.left < b.right &&
                  b.left < l.plate.right &&
                  l.plate.top < b.bottom &&
                  b.top < l.plate.bottom,
              )
              .map(() => l.text),
          );
          labelsBySize.push({
            width,
            height,
            labels: labels.length,
            minSize: Math.min(...labels.map((l) => l.size)),
            overlaps,
            drawingOverlaps,
          });
        }
        results.push({
          scenario: source.scenario,
          theme: frame.theme.name,
          reversible,
          labelContrast: contrast,
          labelsBySize,
        });
      }
      const source = { ...sources[0], width: 1300, height: 760, dpr: 1 };
      const profile = (rebuilt: boolean) => {
        const times = [];
        for (let i = 0; i < 330; i++) {
          const f = {
            ...source,
            now: 10.4 + i / 1000,
            notes: rebuilt ? source.notes.slice() : source.notes,
          };
          const start = performance.now();
          handle.frame(f);
          if (i >= 30) times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        return {
          frames: times.length,
          median: (times[149] + times[150]) / 2,
          p95: times[285],
          max: times[299],
        };
      };
      const result = {
        themes: results,
        cached: profile(false),
        rebuilt: profile(true),
        notes: source.notes.length,
        width: 1300,
        height: 760,
        userAgent: navigator.userAgent,
      };
      handle.dispose();
      el.remove();
      return result;
    },
    { sources: scenarios, barCases },
  );
  for (const result of measured.themes) {
    expect(result.reversible).toBe(true);
    expect(result.labelContrast).toBeGreaterThanOrEqual(4.5);
    for (const size of result.labelsBySize) {
      expect(size.minSize).toBeGreaterThanOrEqual(11);
      expect(size.overlaps).toEqual([]);
      expect(size.drawingOverlaps).toEqual([]);
    }
  }
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify(
      {
        ...measured,
        scoredNotes: [...score.values()].reduce((n, p) => n + p.events.length, 0),
        mapping,
        next,
        pixels,
      },
      null,
      2,
    ),
  );
  console.log('Marble run measurements:', JSON.stringify({ ...measured, mapping, next }));
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.setViewportSize({ width: 2560, height: 1440 });
  const choice = page
    .locator('[data-region="view-shelf"]')
    .locator('[data-view="marble-run"] .view-to-b');
  await revealView(choice);
  await choice.click();
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  await page.waitForFunction(
    () =>
      !!window.viewProbe.frame &&
      window.viewProbe.frame.width < 600 &&
      window.viewProbe.frame.from === 4 &&
      window.viewProbe.frame.to === 18 &&
      window.viewProbe.frame.now === 10.4,
  );
  await page.locator('[data-region="stage-b"]').screenshot({ path: `${shots}/stage-b-560.png` });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-2560x1440.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await revealView(chooseB);
  await chooseB.click();
  for (const file of ['real-techno', 'micro-dense-64']) {
    await page.evaluate(
      async (source) => {
        await window.odmStudio.load(source);
        await window.odmStudio.seek(1.4);
      },
      await readFile(`corpus/programs/${file}.strudel`, 'utf8'),
    );
    await page.waitForFunction(
      () =>
        window.viewProbe.frame?.now === 1.4 &&
        window.viewProbe.frame.sections.length === 0 &&
        window.viewProbe.frame.notes.length > 0,
    );
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForFunction(() => window.odmStudio.app.canPlay);
    await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
      'data-score-ready',
      'true',
    );
    await expect(page.locator('[data-region="stage-b"] .view-status')).toHaveText('');
    for (const theme of file === 'real-techno' ? themes : ['arcade']) {
      await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
      await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      });
      await page.screenshot({ path: `${shots}/${file}-${theme}-1920x1080.png` });
    }
  }
});
