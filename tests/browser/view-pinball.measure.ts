import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import {
  flipperAt,
  indexPinball,
  pinballLayout,
  pinballState,
} from '../../src/views/pinball/model';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/pinball`;
test('Pinball: Studio themes, exact reversibility, counts and frame cost', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'pinball');
  const choose = async (id: string, stage: 'a' | 'b') => {
    const a = page.locator('[data-region="stage-a"]');
    const opener = a.getByRole('button', { name: 'Views', exact: true });
    const compact = await opener.isVisible();
    if (compact) await opener.click();
    const shelf = compact ? a.locator('.shelf-popover') : page.locator('.wide-shelf');
    const tile = shelf.locator(
      `[data-view="${id}"] ${stage === 'a' ? '.view-choice' : '.view-to-b'}`,
    );
    await revealView(tile);
    await tile.click();
    await expect(page.locator(`[data-region="stage-${stage}"] .view-host`)).toHaveAttribute(
      'data-score-ready',
      'true',
    );
  };
  await choose('band', 'b');
  const at = async (now: number) => {
    await page.evaluate(async (now) => {
      window.odmStudio.pause();
      await window.odmStudio.seek(now);
    }, now);
    await page.waitForFunction((now) => window.viewProbe.frame?.now === now, now);
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
  };
  await at(10.4);
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const score = indexPinball(frame.notes),
    box = pinballLayout(frame),
    state = pinballState(score, box, 10.4);
  const mapping = {
    held: state.held,
    fragments: state.fragments,
    travelling: state.travelling,
    barOnsets: state.barNotes,
    reached: state.reached,
    next: state.next?.time,
    nextCount: state.multiball,
    heldParts: state.holds.map((h) => ({
      name: h.target.instrument.name,
      count: h.count,
      spans: h.notes.map((n) => [n.start, n.end]),
    })),
    nextParts: state.routes.map((r) => ({ name: r.target.instrument.name, count: r.count })),
    flipper: frame.instruments.find((i) => i.id === flipperAt(frame))?.name,
    stageA: { width: frame.width, height: frame.height },
  };
  expect(state.held).toBe(2);
  expect(state.reached).toBe(8);
  expect(state.barNotes).toBe(14);
  expect(state.multiball).toBe(2);
  const themes: Record<
    string,
    {
      deterministic: boolean;
      contrast: number;
      labels: number;
      minFont: number;
      overlaps: string[];
    }
  > = {};
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
    await at(10.4);
    await page.screenshot({ path: `${shots}/${theme}-1920x1080.png` });
    await page
      .locator('[data-region="stage-a"] canvas')
      .screenshot({ path: `${shots}/${theme}-stage-a.png` });
    const result = await page.evaluate(async () => {
      const source = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1, now: 10.4 };
      const el = document.createElement('div');
      const handle = await window.viewProbe.definition.mount(el);
      const lum = (hex: string) => {
        const c = [1, 3, 5]
          .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
      };
      const a = lum(source.theme.text),
        b = lum(source.theme.panel);
      const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const labels: { text: string; x: number; y: number; w: number; h: number }[] = [];
      const fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
        const w = this.measureText(text).width,
          h = Number.parseFloat(this.font);
        labels.push({
          text,
          x: x - (this.textAlign === 'center' ? w / 2 : this.textAlign === 'right' ? w : 0),
          y: y - h,
          w,
          h,
        });
        if (max === undefined) fill.call(this, text, x, y);
        else fill.call(this, text, x, y, max);
      };
      handle.frame(source);
      CanvasRenderingContext2D.prototype.fillText = fill;
      const picture = el.querySelector('canvas')!.toDataURL();
      handle.frame({ ...source, now: 19.8, width: 560, height: 675 });
      handle.frame({ ...source, now: 0.2, notes: [] });
      handle.frame(source);
      const deterministic = picture === el.querySelector('canvas')!.toDataURL();
      handle.dispose();
      const overlaps: string[] = [];
      labels.forEach((l, i) =>
        labels.slice(i + 1).forEach((r) => {
          if (l.x < r.x + r.w && l.x + l.w > r.x && l.y < r.y + r.h && l.y + l.h > r.y)
            overlaps.push(`${l.text} / ${r.text}`);
        }),
      );
      return {
        deterministic,
        contrast,
        labels: labels.length,
        minFont: Math.min(...labels.map((l) => l.h)),
        overlaps,
      };
    });
    expect(result.deterministic).toBe(true);
    expect(result.contrast).toBeGreaterThanOrEqual(4.5);
    expect(result.minFont).toBeGreaterThanOrEqual(11);
    expect(result.overlaps).toEqual([]);
    themes[theme] = result;
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await at(10.4);
  const cpu = await page.evaluate(async () => {
    const source = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1 };
    const el = document.createElement('div');
    const handle = await window.viewProbe.definition.mount(el);
    const run = (rebuilt: boolean) => {
      const times: number[] = [];
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
      cached: run(false),
      rebuilt: run(true),
      width: source.width,
      height: source.height,
      notes: source.notes.length,
      userAgent: navigator.userAgent,
    };
    handle.dispose();
    return result;
  });
  // Capture Pinball in the actual narrow Stage B, with Band on A.
  await choose('band', 'a');
  await choose('pinball', 'b');
  await at(10.4);
  await page
    .locator('[data-region="stage-b"]')
    .screenshot({ path: `${shots}/arcade-stage-b-487.png` });
  await page.setViewportSize({ width: 2560, height: 1440 });
  await at(10.4);
  const narrow = await page.evaluate(() => ({
    width: window.viewProbe.frame!.width,
    height: window.viewProbe.frame!.height,
  }));
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await at(10.4);
    await page
      .locator('[data-region="stage-b"]')
      .screenshot({ path: `${shots}/${theme}-stage-b.png` });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await choose('pinball', 'a');
  await choose('band', 'b');
  await at(10.4);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  for (const file of ['real-techno', 'micro-dense-64']) {
    await page.evaluate(
      async (source) => {
        await window.odmStudio.load(source);
      },
      await readFile(`corpus/programs/${file}.strudel`, 'utf8'),
    );
    await at(1.4);
    await expect(page.locator('[data-region="stage-a"] .view-host')).toHaveAttribute(
      'data-score-ready',
      'true',
    );
    for (const theme of file === 'real-techno'
      ? ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']
      : ['arcade']) {
      await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
      await at(1.4);
      await page.screenshot({ path: `${shots}/${file}-${theme}-1920x1080.png` });
    }
  }
  const results = { mapping, cpu, themes, narrow };
  console.log('Pinball measured:', JSON.stringify(results));
  await writeFile(`${shots}/measurements.json`, JSON.stringify(results, null, 2));
});
