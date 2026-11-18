import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { scoreReady } from './helpers';
import { indexTubes, racks } from '../../src/views/tubes/model';
import { tubeLayout } from '../../src/views/tubes/geometry';
import { tubeMotion } from '../../src/views/tubes/motion';
import { vesselBody } from '../../src/views/tubes/vessels';

test('Tubes: exact bar 11, five themes, Stage B, playback and frame cost', async ({ page }) => {
  const dir = `${process.env.ODM_VIEW_MEASURE_DIR}/tubes`;
  await mkdir(dir, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'tubes');
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 10.4 &&
      window.viewProbe.frame.lookAhead === 1 &&
      window.viewProbe.frame.from === 0 &&
      window.viewProbe.frame.to === 28,
  );
  await scoreReady(page);
  const saved = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${dir}/frame.json`, JSON.stringify(saved, null, 2));
  // Isolated pure-index timing runs in Node; browser submission is measured below.
  const firstIndexStart = performance.now();
  const indexed = indexTubes(saved.notes);
  const firstIndexMs = performance.now() - firstIndexStart;
  const indexCosts: number[] = [];
  for (let i = 0; i < 40; i++) {
    const start = performance.now();
    indexTubes(saved.notes);
    if (i >= 10) indexCosts.push(performance.now() - start);
  }
  indexCosts.sort((a, b) => a - b);
  const indexing = {
    runtime: process.version,
    notes: saved.notes.length,
    firstMs: firstIndexMs,
    medianMs: (indexCosts[14] + indexCosts[15]) / 2,
    p95Ms: indexCosts[28],
    samples: indexCosts.length,
  };
  const current = racks(saved, indexed);
  const bass = current.find((r) => r.instrument.name === 'wobbleBass')!;
  const cutoff = bass.tubes.find((t) => t.setting.name === 'lpf')!;
  const wobbleCutoff = {
    value: cutoff.sample?.value.cutoff,
    min: cutoff.range?.min,
    max: cutoff.range?.max,
    level: cutoff.level,
    moving: cutoff.moving,
    samples: indexed.get(bass.instrument.id)!.onsets.length,
  };
  const sizeAt = (width: number, height: number, label: string) => {
    const layout = tubeLayout({ width, height }, current);
    const tube = layout.tubes.find((t) => t.rack === bass && t.tube.setting.name === 'lpf')!;
    return {
      label,
      stage: { width, height },
      glass: { width: tube.width, height: tube.bottom - tube.top },
      rows: layout.rows,
      tubes: layout.tubes.length,

      mockupGlass: { width: 30, height: 282, stage: { width: 960, height: 600 } },
    };
  };
  const sizes: ReturnType<typeof sizeAt>[] = [];
  expect(wobbleCutoff.level).toBe(0.5);
  expect(wobbleCutoff.moving).toBe(false);
  // Exact host-score frames, independent of screenshot/transport timing.
  const evidenceFrame = { ...saved, width: 1300, height: 760, dpr: 1 };
  const stand = await page.evaluateHandle(async () => {
    await document.fonts.ready;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:9999';
    document.body.append(el);
    return { el, handle: await window.viewProbe.definition.mount(el) };
  });
  const capture = async (now: number, file: string) => {
    await stand.evaluate(({ handle }, frame) => handle.frame(frame), { ...evidenceFrame, now });
    await page.screenshot({
      path: `${dir}/${file}.png`,
      clip: { x: 0, y: 0, width: 1300, height: 760 },
    });
  };
  await capture(10.4, 'bar-11-40');
  const hats = current.find((r) => r.instrument.name === 'hh · drop')!;
  const hatPart = indexed.get(hats.instrument.id)!;
  const onset = hatPart.onsets.find((n) => n.start === 10.375)!;
  expect(onset).toBeDefined();
  const boxes = tubeLayout(evidenceFrame, racks(evidenceFrame, indexed)).tubes;
  const constant = vesselBody(
    boxes.find(
      (b) => b.rack.instrument.id === bass.instrument.id && b.tube.setting.name === 'lpf',
    )!,
  );
  const gainBox = vesselBody(
    boxes.find(
      (b) => b.rack.instrument.id === hats.instrument.id && b.tube.setting.name === 'gain',
    )!,
  );
  const pixels = (box: typeof constant) =>
    stand.evaluate(({ el }, box) => {
      const c = el.querySelector('canvas')!.getContext('2d')!;
      return Array.from(
        c.getImageData(
          Math.floor(box.x - box.width / 2 - 2),
          Math.floor(box.top - 2),
          Math.ceil(box.width + 4),
          Math.ceil(box.bottom - box.top + 4),
        ).data,
      ).join(',');
    }, box);
  const sequence = [];
  const constantPixels: string[] = [],
    movingPixels: string[] = [];
  for (const ms of [-20, 20, 60, 120, 300]) {
    const now = onset.start + (ms / 1000) * saved.cps;
    await capture(
      now,
      `hats-${ms < 0 ? 'minus' : 'plus'}-${String(Math.abs(ms)).padStart(3, '0')}ms`,
    );
    const hatTube = racks({ ...saved, now }, indexed)
      .find((r) => r.instrument.id === hats.instrument.id)!
      .tubes.find((t) => t.setting.name === 'gain')!;
    sequence.push({
      ms,
      now,
      target: hatTube.level,
      motion: tubeMotion(hatPart, hatTube, now, saved.cps),
    });
    constantPixels.push(await pixels(constant));
    movingPixels.push(await pixels(gainBox));
  }
  expect(new Set(constantPixels).size).toBe(1);
  expect(new Set(movingPixels).size).toBe(5);
  // Exact redraw after a reverse seek, including the in-flight pour.
  await capture(sequence[1].now, 'hats-reverse-plus-020ms');
  expect(await pixels(gainBox)).toBe(movingPixels[1]);
  // The melody is held here, so its delay/room vessels are lit beside the pad.
  await capture(17.3, 'bar-18-breakdown');
  // Equal adjacent values keep the body fixed while a later value makes the
  // setting nonconstant. Compare the vessel alone, excluding history/labels.
  const bubbleFrame = {
    ...evidenceFrame,
    instruments: [
      { ...hats.instrument, settings: [{ name: 'gain', label: 'Level', kind: 'values' as const }] },
    ],
    notes: [
      { instrument: hats.instrument.id, start: 0, end: 0.5, hasOnset: true, value: { gain: 0.5 } },
      {
        instrument: hats.instrument.id,
        start: 1,
        end: 1 + 0.01 * saved.cps,
        hasOnset: true,
        value: { gain: 0.5 },
      },
      { instrument: hats.instrument.id, start: 3, end: 4, hasOnset: true, value: { gain: 0.8 } },
    ],
  };
  const bubbleBox = vesselBody(
    tubeLayout(bubbleFrame, racks(bubbleFrame, indexTubes(bubbleFrame.notes))).tubes[0],
  );
  const bubbles = await stand.evaluate(
    ({ el, handle }, { frame, box }) => {
      const c = el.querySelector('canvas')!.getContext('2d')!;
      const sameAsNoOnset = (muted: boolean, seconds: number) => {
        const current = {
          ...frame,
          instruments: [{ ...frame.instruments[0], muted }],
          now: 1 + seconds * frame.cps,
        };
        const picture = () =>
          Array.from(
            c.getImageData(
              Math.ceil(box.x - box.width / 2),
              Math.ceil(box.top),
              Math.floor(box.width),
              Math.floor(box.bottom - box.top),
            ).data,
          ).join(',');
        handle.frame(current);
        const before = picture();
        handle.frame({
          ...current,
          notes: frame.notes.map((n) => (n.start === 1 ? { ...n, hasOnset: false } : n)),
        });
        return picture() === before;
      };
      return {
        afterNoteEnds: !sameAsNoOnset(false, 0.03),
        muted: !sameAsNoOnset(true, 0.03),
        settled: !sameAsNoOnset(false, 0.5),
      };
    },
    { frame: bubbleFrame, box: bubbleBox },
  );
  expect(bubbles).toEqual({ afterNoteEnds: true, muted: false, settled: false });
  await writeFile(
    `${dir}/pour.json`,
    JSON.stringify(
      {
        onset: onset.start,
        nextOnsetGapMs: 1000 * (0.125 / saved.cps),
        constant: 'wobbleBass lpf',
        constantPixelsIdentical: true,
        bubbles,
        sequence,
      },
      null,
      2,
    ),
  );
  await stand.evaluate(({ el, handle }) => {
    handle.dispose();
    el.remove();
  });
  await stand.dispose();
  for (const [width, height] of [
    [2560, 1440],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['arcade', 'riso', 'pocket', 'phosphor', 'sunset']) {
      await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
      await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        animations: 'disabled',
        path: `${dir}/${theme}-${String(width)}x${String(height)}.png`,
      });
      if (theme === 'arcade') {
        const size = await page.evaluate(() => ({
          width: window.viewProbe.frame!.width,
          height: window.viewProbe.frame!.height,
        }));
        sizes.push(
          sizeAt(size.width, size.height, `Stage A at ${String(width)}×${String(height)}`),
        );
      }
    }
  }
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  const b = page.locator('[data-region="stage-b"]');
  const choice = page.locator('.wide-shelf').getByRole('button', {
    name: 'Tubes on Stage B',
    exact: true,
    includeHidden: true,
  });
  await revealView(choice);
  await choice.click();
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await b.screenshot({ animations: 'disabled', path: `${dir}/stage-b.png` });
  const stageB = await b.locator('canvas').boundingBox();
  if (!stageB) throw Error('Stage B canvas is not visible');
  sizes.push(sizeAt(stageB.width, stageB.height, 'Stage B'));
  await page.evaluate(() => window.odmStudio.play());
  await page.waitForFunction(
    () => window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ animations: 'disabled', path: `${dir}/playing-2560x1440.png` });
  await page.evaluate(() => window.odmStudio.pause());

  const costs = await page.evaluate(async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    const frame = {
      ...window.viewProbe.frame!,
      now: 10.4,
      width: 1300,
      height: 760,
      dpr: 1,
      lookAhead: 1,
    };
    const firstFrameStart = performance.now();
    handle.frame(frame);
    const firstFrameMs = performance.now() - firstFrameStart;
    const result = [];
    for (let i = 0; i < 310; i++) {
      await new Promise(requestAnimationFrame);
      const start = performance.now();
      handle.frame({ ...frame, now: 10.4 + (i * frame.cps) / 60 });
      if (i >= 10) result.push(performance.now() - start);
    }
    // Seek order and a fresh mount must produce identical pixels.
    handle.frame(frame);
    const before = el.querySelector('canvas')!.toDataURL();
    handle.frame({ ...frame, now: 11.1 });
    handle.frame(frame);
    const reversible = before === el.querySelector('canvas')!.toDataURL();
    handle.dispose();
    const fresh = await window.viewProbe.definition.mount(el);
    fresh.frame(frame);
    const remount = before === el.querySelector('canvas')!.toDataURL();
    fresh.dispose();
    el.remove();
    result.sort((a, b) => a - b);
    return {
      firstFrameMs,
      frames: result.length,
      median: (result[149] + result[150]) / 2,
      p95: result[285],
      max: result[299],
      width: 1300,
      height: 760,
      dpr: 1,
      reversible,
      remount,
      userAgent: navigator.userAgent,
    };
  });
  expect(costs.reversible).toBe(true);
  expect(costs.remount).toBe(true);
  await writeFile(
    `${dir}/measurements.json`,
    JSON.stringify({ ...costs, stageB, indexing, wobbleCutoff, sizes }, null, 2),
  );
  console.log(
    'Tubes CPU frame submission:',
    JSON.stringify({ ...costs, stageB, indexing, wobbleCutoff, sizes }),
  );
});

test('Tubes: sweep label evidence in the Studio at the same moment', async ({ page }) => {
  const dir = `${process.env.ODM_VIEW_MEASURE_DIR}/tubes`;
  await mkdir(dir, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'tubes');
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(
    () => window.viewProbe.frame?.now === 10.4 && window.viewProbe.frame.to === 28,
  );
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
    });
    await page.screenshot({ path: `${dir}/${theme}-studio.png` });
  }
});
