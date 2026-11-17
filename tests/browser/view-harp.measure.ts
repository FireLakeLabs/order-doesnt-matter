import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import type { ViewFrame } from '../../src/views/types';
import {
  analyse,
  layout,
  partsAt,
  pitchLabel,
  sectionAt,
  usesSection,
} from '../../src/views/harp/model';
function describe(frame: ViewFrame) {
  const score = analyse(frame.notes),
    section = sectionAt(frame);
  const sounding = score.strings.flatMap((s) =>
    partsAt(s.voices, frame).flatMap((p) => p.voices.map((v) => v.midi!)),
  );
  return {
    geometry: layout(frame.width, frame.height, score.strings.length, score.drums.length),
    pitchCount: score.pitchCount,
    stringCount: score.strings.length,
    grouped: score.grouped,
    pitches: score.strings.map((s) => s.label),
    sounding: [...new Set(sounding)].sort((a, b) => a - b).map(pitchLabel),
    activeVoices: sounding.length,
    bright: score.strings.filter((s) => usesSection(s.voices, section)).map((s) => s.label),
    drumCount: score.drums.length,
    activeDrums: score.drums
      .filter((d) => partsAt(d.voices, frame).length)
      .map((d) => frame.instruments.find((i) => i.id === d.instrument)?.name ?? d.instrument),
  };
}

declare global {
  interface Window {
    harpTime: number;
    harpOriginal: () => number;
  }
}
const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/harp`;
async function presented(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
}
test('harp: real arrangement, five themes, both stages and CPU cost', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'harp');
  await page.evaluate(async () => {
    await window.odmStudio.seek(17.3);
    history.replaceState(null, '', '/?inspect&a=harp&b=');
    window.harpTime = 17.3;
    window.harpOriginal = window.odmStudio.getPlayhead.bind(window.odmStudio);
    window.odmStudio.getPlayhead = () => window.harpTime;
  });
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 17.3 &&
      window.viewProbe.frame.from === 0 &&
      window.viewProbe.frame.to === 28,
  );
  await mkdir(shots, { recursive: true });
  const canvas = page.locator('[data-region="stage-a"] canvas');
  const sizes: {
    name: string;
    width: number;
    height: number;
    data: ReturnType<typeof describe>;
  }[] = [];
  const recordSize = async (name: string, target = canvas) => {
    const size = await target.evaluate((c) => {
      const r = c.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    const frame = await page.evaluate(() => window.viewProbe.frame!);
    sizes.push({ name, ...size, data: describe({ ...frame, ...size }) });
  };
  const snapshot = async (name: string) => {
    await presented(page);
    await expect(page.locator('[data-region="score"]')).toHaveAttribute('data-score-ready', 'true');
    await page.screenshot({ path: `${shots}/${name}.png` });
    await canvas.screenshot({ path: `${shots}/${name}-stage.png` });
    await recordSize(name);
  };
  await page.setViewportSize({ width: 2560, height: 1440 });
  await snapshot('bar18-arcade-2560x1440');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await snapshot('bar18-arcade-1920x1080');
  const original = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.getByRole('button', { name: 'Fill window with Stage A', exact: true }).click();
  await snapshot('bar18-arcade-1920x1080-filled');
  await page.getByRole('button', { name: 'Restore Stage A', exact: true }).click();
  await presented(page);
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.4);
    window.harpTime = 10.4;
  });
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 10.4 &&
      window.viewProbe.frame.from === 0 &&
      window.viewProbe.frame.to === 28,
  );
  await snapshot('bar11-arcade-1920x1080');
  await page.evaluate(async () => {
    await window.odmStudio.seek(17.3);
    window.harpTime = 17.3;
  });
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 17.3 &&
      window.viewProbe.frame.from === 0 &&
      window.viewProbe.frame.to === 28,
  );
  await presented(page);
  expect(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(original);
  for (const theme of ['riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await snapshot(`bar18-${theme}-1920x1080`);
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await presented(page);
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const { pictures, ...costs } = await page.evaluate(async (frame: ViewFrame) => {
    const el = document.createElement('div');
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    const scenarios = [
      { name: 'arrangement', notes: frame.notes, instruments: frame.instruments },
      ...[1, 20].map((count) => ({
        name: `500-notes-${count}-parts`,
        instruments: Array.from({ length: count }, (_, i) => ({
          ...frame.instruments[i % frame.instruments.length],
          id: String(i),
          index: i,
        })),
        notes: Array.from({ length: 500 }, (_, i) => ({
          instrument: String(i % count),
          start: 17,
          end: 18,
          hasOnset: true,
          value: { note: 36 + (i % 48) },
        })),
      })),
    ];
    const dense = scenarios[2];
    scenarios.push({
      ...dense,
      name: '500-staggered-20-parts',
      notes: dense.notes.map((note, i) => ({ ...note, start: 17 + i / 500, end: 18 + i / 500 })),
    });
    scenarios.push({
      ...dense,
      name: '500-unpitched-20-parts',
      notes: dense.notes.map((note) => ({ ...note, value: { s: 'bd', n: 0 } })),
    });
    const result = [];
    for (const scenario of scenarios) {
      const samples: number[] = [];
      let cold = 0;
      for (let i = 0; i < 310; i++) {
        await new Promise(requestAnimationFrame);
        const start = performance.now();
        handle.frame({
          ...frame,
          ...scenario,
          now: 17.3 + i / 10000,
          width: 1300,
          height: 760,
          dpr: 1,
        });
        const elapsed = performance.now() - start;
        if (i === 0) cold = elapsed;
        if (i >= 10) samples.push(elapsed);
      }
      samples.sort((a, b) => a - b);
      result.push({
        name: scenario.name,
        cold,
        frames: samples.length,
        median: (samples[149] + samples[150]) / 2,
        p95: samples[285],
        max: samples[299],
      });
    }
    handle.frame({ ...frame, now: 17.3, width: 1300, height: 760, dpr: 1 });
    const pictures = [el.querySelector('canvas')!.toDataURL()];
    for (const [width, height] of [
      [1300, 760],
      [560, 471],
    ]) {
      handle.frame({ ...frame, ...scenarios[3], now: 17.999, width, height, dpr: 1 });
      pictures.push(el.querySelector('canvas')!.toDataURL());
    }
    handle.frame({ ...frame, ...scenarios[4], now: 17.3, width: 560, height: 471, dpr: 1 });
    pictures.push(el.querySelector('canvas')!.toDataURL());
    handle.frame({
      ...frame,
      notes: [0, 1].map((i) => ({
        instrument: frame.instruments[i].id,
        start: 17,
        end: 18,
        hasOnset: true,
        value: { note: 60, gain: 0.6 },
      })),
      now: 17.3,
      width: 560,
      height: 471,
      dpr: 1,
    });
    pictures.push(el.querySelector('canvas')!.toDataURL());
    handle.dispose();
    el.remove();
    return {
      pictures,
      scenarios: result,
      width: 1300,
      height: 760,
      dpr: 1,
      userAgent: navigator.userAgent,
    };
  }, frame);
  for (const [i, picture] of pictures.entries())
    await writeFile(
      `${shots}/${['real-1300x760', 'dense-500-staggered-1300x760', 'dense-500-staggered-560x471', 'drums-only-20-560x471', 'two-part-braid-560x471'][i]}.png`,
      Buffer.from(picture.split(',')[1], 'base64'),
    );
  sizes.push({
    name: 'canonical-stage-a',
    width: 1300,
    height: 760,
    data: describe({ ...frame, width: 1300, height: 760 }),
  });
  console.log('harp CPU frame submission:', JSON.stringify(costs));
  await writeFile(`${shots}/frame-cost.json`, JSON.stringify(costs, null, 2));
  const stageB = page.locator('[data-region="stage-b"]');
  await stageB.getByRole('button', { name: 'Views', exact: true }).click();
  const choice = stageB.getByRole('button', { name: 'Harp on Stage B', exact: true });
  await revealView(choice);
  await choice.click();
  const stageStyle = await page.addStyleTag({
    content:
      '[data-region="stage-b"] {position:fixed;right:0;top:108px;width:560px;height:555px;z-index:50;border:0}',
  });
  await expect(stageB.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await presented(page);
  await expect(stageB.locator('canvas')).toHaveJSProperty('clientWidth', 560);
  await stageB.screenshot({ path: `${shots}/bar18-stage-b-560.png` });
  await recordSize('stage-b-560', stageB.locator('canvas'));
  await stageStyle.evaluate((style) => {
    style.parentNode?.removeChild(style);
  });
  await page.evaluate(async () => {
    window.odmStudio.getPlayhead = window.harpOriginal;
    await window.odmStudio.seek(17.3);
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => window.odmStudio.app.state.playing && window.viewProbe.frame?.playing,
  );
  await snapshot('bar18-playing');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await writeFile(`${shots}/sizes.json`, JSON.stringify(sizes, null, 2));
  console.log('harp sizes:', JSON.stringify(sizes));
  expect(errors).toEqual([]);
});
