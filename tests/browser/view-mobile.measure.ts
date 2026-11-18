import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { scoreReady } from './helpers';
import {
  indexMobile,
  mobileArms,
  mobileLayout,
  areaUnit,
  tiltName,
} from '../../src/views/mobile/model';
import { themes } from '../../src/studio/themes';
import type { ViewFrame } from '../../src/views/types';

const mapping = (frame: ViewFrame) => {
  const score = indexMobile(frame.notes),
    base = mobileArms(frame, score);
  const box = mobileLayout(frame.width, frame.height, base.length);
  const arms = mobileArms(frame, score, [], box.slots);
  return {
    width: frame.width,
    height: frame.height,
    slots: box.slots,
    areaUnit: areaUnit(arms, box),
    arms: arms.map((a) => ({
      name: frame.instruments.find((p) => p.id === a.id)?.name,
      weights: a.notes.length,
      drawn: a.weights.length,
      mass: a.mass,
      moment: a.moment,
      tilt: tiltName(a.tilt),
      radians: a.tilt,
      shape: a.shape,
    })),
  };
};
function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
test('Mobile: Studio evidence, all-theme pixel reversibility, crowd counts and frame submission', async ({
  page,
}) => {
  const dir = `${process.env.ODM_VIEW_MEASURE_DIR}/mobile`;
  await mkdir(dir, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'mobile');
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 10.4 &&
      window.viewProbe.frame.lookAhead === 1 &&
      window.viewProbe.frame.from === 4,
  );
  await scoreReady(page);
  // Put a different live view on Stage B while Mobile stays on Stage A.
  const b = page.locator('[data-region="stage-b"]');
  await b.getByRole('button', { name: 'Views', exact: true }).click();
  const other = b.locator('.shelf-popover [data-view="ring"] .view-to-b');
  await revealView(other);
  await other.click();
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  const frames: ViewFrame[] = [],
    pixels: {
      theme: string;
      reversible: boolean;
      fresh: boolean;
      labels: { text: string; ink: string; size: number }[];
    }[] = [];
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${dir}/${theme}-1920x1080.png` });
    await page
      .locator('[data-region="stage-a"] canvas')
      .screenshot({ path: `${dir}/${theme}-stage-a.png` });
    const frame = await page.evaluate(() => window.viewProbe.frame!);
    frames.push(frame);
    pixels.push(
      await page.evaluate(async (frame) => {
        const el = document.createElement('div');
        document.body.append(el);
        const handle = await window.viewProbe.definition.mount(el);
        const source = { ...frame, now: 10.4, width: 1300, height: 760, dpr: 1 };
        const context = el.querySelector('canvas')!.getContext('2d')!;
        const labels: { text: string; ink: string; size: number }[] = [];
        const fill = context.fillText;
        context.fillText = function (text, x, y, max) {
          labels.push({ text, ink: String(this.fillStyle), size: parseFloat(this.font) });
          if (max === undefined) fill.call(this, text, x, y);
          else fill.call(this, text, x, y, max);
        };
        handle.frame(source);
        context.fillText = fill;
        const original = el.querySelector('canvas')!.toDataURL();
        handle.frame({ ...source, now: 17.3, width: 560, height: 475 });
        handle.frame({ ...source, now: 6.2 });
        handle.frame(source);
        const reversible = original === el.querySelector('canvas')!.toDataURL();
        handle.dispose();
        const fresh = await window.viewProbe.definition.mount(el);
        fresh.frame(source);
        const same = original === el.querySelector('canvas')!.toDataURL();
        fresh.dispose();
        el.remove();
        return { theme: frame.theme.name, reversible, fresh: same, labels };
      }, frame),
    );
  }
  expect(pixels.every((p) => p.reversible && p.fresh)).toBe(true);
  for (const p of pixels) {
    expect(p.labels.length).toBeGreaterThan(10);
    expect(p.labels.every((l) => l.ink.toLowerCase() === themes[p.theme].text.toLowerCase())).toBe(
      true,
    );
    expect(p.labels.every((l) => l.size >= 11)).toBe(true);
  }
  const contrasts = Object.values(themes).map((t) => ({
    theme: t.name,
    textOnGround:
      (Math.max(luminance(t.text), luminance(t.ground)) + 0.05) /
      (Math.min(luminance(t.text), luminance(t.ground)) + 0.05),
  }));
  expect(contrasts.every((c) => c.textOnGround >= 4.5)).toBe(true);
  const saved = frames[0];
  await writeFile(`${dir}/frame.json`, JSON.stringify(saved, null, 2));
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  // Profile exact real frames at 1300×760; no audio or raster-completion claim.
  const measured = await page.evaluate(async (frame) => {
    const el = document.createElement('div');
    document.body.append(el);
    const listeners = window.viewProbe.listeners;
    const handle = await window.viewProbe.definition.mount(el);
    const source = { ...frame, width: 1300, height: 760, dpr: 1 };
    const run = (rebuild: boolean, lookAhead = source.lookAhead) => {
      const times: number[] = [];
      for (let i = 0; i < 330; i++) {
        const f = {
          ...source,
          lookAhead,
          now: 10.4 + i / 1000,
          notes: rebuild ? source.notes.slice() : source.notes,
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
    const costs = { cached: run(false), rebuilt: run(true), fourCycles: run(false, 4) };
    handle.dispose();
    el.remove();
    return {
      ...costs,
      listenersBefore: listeners,
      listenersAfter: window.viewProbe.listeners,
      userAgent: navigator.userAgent,
    };
  }, saved);
  expect(measured.listenersAfter).toBe(measured.listenersBefore);
  await page.evaluate(() => window.odmStudio.play());
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${dir}/playing-1920x1080.png` });
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.setViewportSize({ width: 2560, height: 1440 });
  const narrow = page
    .locator('.wide-shelf')
    .getByRole('button', { name: 'Mobile on Stage B', exact: true, includeHidden: true });
  await revealView(narrow);
  await narrow.click();
  await expect(b.locator('canvas')).toHaveCount(1);
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  const stageB = await b.locator('canvas').boundingBox();
  if (!stageB) throw Error('Stage B canvas missing');
  await b.screenshot({ path: `${dir}/stage-b-560.png` });
  const layouts = [
    mapping(saved),
    mapping({ ...saved, width: stageB.width, height: stageB.height }),
  ];
  // Unpitched fast repetitions contrast with the two held bass crystals.
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      window.viewProbe.frame = undefined;
      await window.odmStudio.seek(1.4);
    },
    await readFile('corpus/programs/real-techno.strudel', 'utf8'),
  );
  await page.waitForFunction(
    () => window.viewProbe.frame?.now === 1.4 && window.viewProbe.frame.sections.length === 0,
  );
  await scoreReady(page);
  await page.screenshot({ path: `${dir}/techno-2560x1440.png` });
  const techno = mapping(await page.evaluate(() => window.viewProbe.frame!));
  expect(techno.arms.map((a) => a.weights)).toEqual([4, 4, 2, 8]);
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      window.viewProbe.frame = undefined;
      await window.odmStudio.seek(1.4);
    },
    await readFile('corpus/programs/micro-dense-64.strudel', 'utf8'),
  );
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 1.4 &&
      window.viewProbe.frame.notes.length >= 256 &&
      window.viewProbe.frame.instruments.length === 1,
  );
  await scoreReady(page);
  await page.screenshot({ path: `${dir}/dense-2560x1440.png` });
  const dense = mapping(await page.evaluate(() => window.viewProbe.frame!));
  expect(dense.arms.map((a) => a.weights)).toEqual([256]);
  const result = { measured, pixels, contrasts, layouts, techno, dense, stageB };
  console.log('Mobile measurements:', JSON.stringify(result));
  await writeFile(`${dir}/measurements.json`, JSON.stringify(result, null, 2));
});
