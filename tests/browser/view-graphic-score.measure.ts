import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { graphicScore } from '../../src/views/graphic-score/model';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/graphic-score`;
test('Graphic score: whole-song poster, export, five themes and frame cost', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'graphic-score');
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await page.setViewportSize({ width: 2560, height: 1440 });
  const band = page
    .locator('[data-region="view-shelf"]')
    .getByRole('button', { name: 'The band on Stage B', exact: true });
  await revealView(band);
  await band.click();
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  const themes = [];
  for (const theme of ['arcade', 'sunset', 'phosphor', 'pocket', 'riso']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    await page.screenshot({ path: `${shots}/${theme}-1920x1080.png` });
    await page
      .locator('[data-region="stage-a"]')
      .screenshot({ path: `${shots}/${theme}-stage-a.png` });
    themes.push(
      await page.evaluate(() => ({
        theme: window.viewProbe.frame!.theme,
        instruments: window.viewProbe.frame!.instruments,
      })),
    );
  }
  const luminance = (hex: string) => {
    const rgb = hex
      .slice(1)
      .match(/../g)!
      .map((h) => parseInt(h, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const contrast = themes.map(({ theme }) => {
    const background = luminance(theme.ground);
    const ratios = [theme.text, theme.muted].map((c) => {
      const ink = luminance(c);
      return (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05);
    });
    return { theme: theme.name, minimum: Math.min(...ratios) };
  });
  expect(contrast.every((c) => c.minimum >= 4.5)).toBe(true);
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  const score = graphicScore(frame);
  const mapping = {
    panels: score.panels,
    counts: score.counts,
    notes: score.notes.length,
    segments: score.marks.length,
    moving: score.parts.filter((p) => p.moving.length || p.heldCutoff !== undefined),
    parts: score.parts.length,
    contrast,
  };
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const before = await page
    .locator('[data-region="stage-a"] canvas')
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const pending = page.waitForEvent('download');
  await page
    .locator('[data-region="stage-a"]')
    .getByRole('button', { name: 'Download', exact: true })
    .click();
  await (await pending).saveAs(`${shots}/graphic-score-poster.png`);
  expect(
    await page
      .locator('[data-region="stage-a"] canvas')
      .evaluate((c: HTMLCanvasElement) => c.toDataURL()),
  ).toBe(before);
  const measured = await page.evaluate(async (themes) => {
    const source = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1, now: 10.4 };
    const el = document.createElement('div');
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    handle.frame(source);
    const run = (rebuilt: boolean) => {
      const costs: number[] = [];
      for (let i = 0; i < 330; i++) {
        const frame = {
          ...source,
          now: 10.4 + i / 1000,
          notes: rebuilt ? source.notes.slice() : source.notes,
        };
        const start = performance.now();
        handle.frame(frame);
        if (i >= 30) costs.push(performance.now() - start);
      }
      costs.sort((a, b) => a - b);
      return {
        frames: costs.length,
        median: (costs[149] + costs[150]) / 2,
        p95: costs[285],
        max: costs[299],
      };
    };
    const cached = run(false),
      rebuilt = run(true);
    handle.frame(source);
    let staticCalls = 0,
      blits = 0,
      strokes = 0;
    const fillText = CanvasRenderingContext2D.prototype.fillText,
      drawImage = CanvasRenderingContext2D.prototype.drawImage,
      stroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.fillText = function (...args: Parameters<typeof fillText>) {
      staticCalls++;
      fillText.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.drawImage = new Proxy(drawImage, {
      apply(target, receiver, args) {
        blits++;
        return Reflect.apply(target, receiver, args);
      },
    });
    CanvasRenderingContext2D.prototype.stroke = new Proxy(stroke, {
      apply(target, receiver, args) {
        strokes++;
        return Reflect.apply(target, receiver, args);
      },
    });
    handle.frame(source);
    for (let i = 0; i < 100; i++) handle.frame({ ...source, now: 2 + i / 5 });
    CanvasRenderingContext2D.prototype.fillText = fillText;
    CanvasRenderingContext2D.prototype.drawImage = drawImage;
    CanvasRenderingContext2D.prototype.stroke = stroke;
    const deterministic = [];
    for (const palette of themes) {
      const f = { ...source, ...palette };
      handle.frame(f);
      const a = el.querySelector('canvas')!.toDataURL();
      handle.frame({ ...f, now: 24, width: 560, height: 675 });
      handle.frame({ ...f, now: 3 });
      handle.frame(f);
      const b = el.querySelector('canvas')!.toDataURL();
      const fresh = document.createElement('div'),
        other = await window.viewProbe.definition.mount(fresh);
      other.frame(f);
      deterministic.push({
        theme: f.theme.name,
        reversed: a === b,
        fresh: a === fresh.querySelector('canvas')!.toDataURL(),
      });
      other.dispose();
    }
    const carryCheck = { count: 0, visible: true };
    CanvasRenderingContext2D.prototype.stroke = new Proxy(stroke, {
      apply(target, receiver: CanvasRenderingContext2D, args) {
        const dash = receiver.getLineDash();
        if (dash.length && receiver.globalAlpha === 1) {
          carryCheck.count++;
          carryCheck.visible &&= dash[1] > receiver.lineWidth;
        }
        return Reflect.apply(target, receiver, args);
      },
    });
    handle.frame({
      ...source,
      notes: source.notes.map((n) => ({ ...n, value: { ...n.value, gain: 2 } })),
    });
    CanvasRenderingContext2D.prototype.stroke = stroke;
    handle.dispose();
    el.remove();
    return {
      carryCheck,
      cached,
      rebuilt,
      cache: { staticCalls, blits, strokes },
      deterministic,
      width: 1300,
      height: 760,
      dpr: 1,
      userAgent: navigator.userAgent,
    };
  }, themes);
  expect(measured.carryCheck.count).toBe(score.counts.carried);
  expect(measured.carryCheck.visible).toBe(true);
  expect(measured.cache.staticCalls).toBe(0);
  expect(measured.cache.blits).toBe(101);
  expect(measured.cache.strokes).toBe(101);
  expect(measured.deterministic.every((d) => d.reversed && d.fresh)).toBe(true);
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify({ ...mapping, ...measured }, null, 2),
  );
  console.log('Graphic score measurements:', JSON.stringify({ ...mapping, ...measured }));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await page.setViewportSize({ width: 2560, height: 1440 });
  const choice = page
    .locator('[data-region="view-shelf"]')
    .getByRole('button', { name: 'Graphic score on Stage B', exact: true });
  await revealView(choice);
  await choice.click();
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  await page.locator('[data-region="stage-b"]').screenshot({ path: `${shots}/stage-b-560.png` });
  await revealView(band);
  await band.click();
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(1.4);
    },
    await readFile('corpus/programs/real-techno.strudel', 'utf8'),
  );
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.sections.length === 0 &&
      window.viewProbe.frame.now === 1.4 &&
      window.viewProbe.frame.notes.length > 0,
  );
  await expect(page.locator('[data-region="stage-a"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await page.screenshot({ path: `${shots}/real-techno-1920x1080.png` });
});
