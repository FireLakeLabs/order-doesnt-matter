import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { resolveTheme, viewTheme, instrumentColour, themeNames } from '../../src/studio/themes';
import { indexStacker, notePatches, stackAt } from '../../src/views/stacker/model';
import { drawingLayout } from '../../src/views/stacker/drawing';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/stacker`;

test('Stacker: real-page evidence and reported frame cost', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'stacker');
  await page.evaluate(async () => {
    history.replaceState(null, '', '/?inspect&a=stacker&b=quilt&theme=arcade');
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.waitForFunction(
    () =>
      Math.abs(
        (window.viewProbe.frame?.width ?? Infinity) -
          (document.querySelector('[data-region="stage-a"] .view-host')?.clientWidth ?? 0),
      ) < 1,
  );
  await page.evaluate(() => document.fonts.ready);
  const expand = async (group: string) => {
    const toggle = page.locator(
      `[data-region="view-shelf"] [data-group="${group}"] .view-group-toggle`,
    );
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  };
  const other = page
    .locator('[data-region="view-shelf"]')
    .getByRole('button', { name: 'Quilt on Stage B', exact: true });
  await expand('song');
  await other.click();
  await expect(page.locator('[data-region="stage-b"] canvas')).toHaveCount(1);
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await expect(page.locator('[data-region="score"]')).toHaveAttribute('data-score-ready', 'true');
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ animations: 'disabled', path: `${shots}/${theme}-studio.png` });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.waitForFunction(() => window.viewProbe.frame?.theme.name === 'arcade');
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const score = indexStacker(frame);
  const state = stackAt(score, 10.4, 12);
  const mapping = {
    stackHeight: state.stack.length,
    clears: state.clears.map((p) => [p.bar + 1, p.match! + 1]),
    totalClears: score.pieces.filter((p) => p.match !== null).map((p) => [p.bar + 1, p.match! + 1]),
    fallingBar: state.current!.bar + 1,
    fallingNotes: state.current!.notes.length,
    fallingPatches: score.order.flatMap((id) => notePatches(state.current!, id, 600)).length,
    sizes: [
      [1300, 760],
      [frame.width, frame.height],
      [559, 675],
    ].map(([width, height]) => ({
      width,
      height,
      cell: drawingLayout(score, 10.4, width, height).cell,
      visible: drawingLayout(score, 10.4, width, height).state.visible.length,
      buried: drawingLayout(score, 10.4, width, height).state.buried,
      stackPixels:
        drawingLayout(score, 10.4, width, height).bottom -
        drawingLayout(score, 10.4, width, height).stackTop,
    })),
  };
  // Profile a separate mount with the real whole-song frame, never a simulated score.
  const measured = await page.evaluate(
    async (themes) => {
      const source = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1, now: 10.4 };
      const el = document.createElement('div');
      document.body.append(el);
      const handle = await window.viewProbe.definition.mount(el);
      const texts: string[] = [];
      const fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
        texts.push(text);
        if (max === undefined) fill.call(this, text, x, y);
        else fill.call(this, text, x, y, max);
      };
      const keys = [10, 10.4, 10.95].map((now) => {
        texts.length = 0;
        handle.frame({ ...source, now });
        const start = texts.indexOf('PIECE ROWS') + 1;
        const end = texts.findIndex((text) => text.includes('STACKED'));
        return texts.slice(start, end);
      });
      const captions = [1.4, 21.08].map((now) => {
        texts.length = 0;
        handle.frame({ ...source, now });
        return texts.find((text) => text.startsWith('BAR '));
      });
      texts.length = 0;
      handle.frame(source);
      CanvasRenderingContext2D.prototype.fillText = fill;
      const run = (kind: 'cached' | 'seam' | 'rebuilt') => {
        const times: number[] = [];
        for (let i = 0; i < 330; i++) {
          const frame = {
            ...source,
            now: kind === 'seam' ? 10.4 + (i % 2) : 10.4 + i / 1000,
            notes: kind === 'rebuilt' ? source.notes.slice() : source.notes,
          };
          const start = performance.now();
          handle.frame(frame);
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
        cached: run('cached'),
        seam: run('seam'),
        rebuilt: run('rebuilt'),
        notes: source.notes.length,
        width: source.width,
        height: source.height,
        texts: texts.slice(),
        keys,
        captions,
        userAgent: navigator.userAgent,
      };
      // Every theme reverses exactly after later time, a resize and a backwards seek.
      const deterministic: Record<string, boolean> = {};
      const contrasts: Record<string, number> = {};
      const clearReversal: Record<string, boolean> = {};
      const luminance = (hex: string) => {
        const rgb = [1, 3, 5].map((offset) => {
          const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      for (const { theme, colours } of themes) {
        const name = theme.name;
        const a = luminance(theme.text),
          b = luminance(theme.ground);
        contrasts[name] = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const frame = {
          ...source,
          theme,
          instruments: source.instruments.map((i) => ({ ...i, colour: colours[i.index] })),
        };
        handle.frame(frame);
        const picture = el.querySelector('canvas')!.toDataURL();
        handle.frame({ ...frame, now: 22, width: 560 });
        handle.frame({ ...frame, now: 38.4, width: 560 });
        handle.frame({ ...frame, now: 1.2 });
        handle.frame(frame);
        deterministic[name] = picture === el.querySelector('canvas')!.toDataURL();
        const clear = { ...frame, now: 21.16 };
        handle.frame(clear);
        const clearPicture = el.querySelector('canvas')!.toDataURL();
        handle.frame({ ...frame, now: 21.31, width: 560 });
        handle.frame({ ...frame, now: 1.4 });
        handle.frame(clear);
        clearReversal[name] = clearPicture === el.querySelector('canvas')!.toDataURL();
      }
      handle.dispose();
      el.remove();
      return { ...result, deterministic, clearReversal, contrasts };
    },
    themeNames.map((name) => ({
      theme: viewTheme(resolveTheme(name)),
      colours: frame.instruments.map((i) => instrumentColour(name, i.index)),
    })),
  );

  expect(measured.captions).toEqual(['BAR 2 · 40% ↓', 'BAR 22 · 8% ↓']);
  expect(measured.keys[0].length).toBeGreaterThan(0);
  expect(measured.keys[1]).toEqual(measured.keys[0]);
  expect(measured.keys[2]).toEqual(measured.keys[0]);
  expect(Object.values(measured.deterministic).every(Boolean)).toBe(true);
  expect(Object.values(measured.clearReversal).every(Boolean)).toBe(true);
  expect(Math.min(...Object.values(measured.contrasts))).toBeGreaterThanOrEqual(4.5);
  console.log('Stacker CPU frame cost and mapping:', JSON.stringify({ ...measured, ...mapping }));
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify({ ...measured, ...mapping }, null, 2),
  );

  await page.setViewportSize({ width: 2560, height: 1440 });
  // Use the actual host's Stage B, whose desktop column is 560 pixels wide.
  const choice = page
    .locator('[data-region="view-shelf"]')
    .getByRole('button', { name: 'Stacker on Stage B', exact: true });
  await expand('arcade');
  await choice.click();
  const b = page.locator('[data-region="stage-b"]');
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await expect(b.locator('canvas')).toHaveCount(1);
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  await b.screenshot({ path: `${shots}/stage-b-560.png` });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ animations: 'disabled', path: `${shots}/playing-2560x1440.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();

  await page.evaluate(async () => {
    await window.odmStudio.seek(21.16);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 21.16);
  await expect(page.locator('[data-region="score"]')).toHaveAttribute('data-score-ready', 'true');
  await page.screenshot({ animations: 'disabled', path: `${shots}/exact-clear-2560x1440.png` });
  await expand('song');
  await other.click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await page.screenshot({ animations: 'disabled', path: `${shots}/mid-clear-1920x1080.png` });
  for (const now of [21.04, 21.3]) {
    await page.evaluate(async (now) => {
      await window.odmStudio.seek(now);
    }, now);
    await page.waitForFunction((now) => window.viewProbe.frame?.now === now, now);
    await page.screenshot({
      animations: 'disabled',
      path: `${shots}/clear-${String(now)}-1920x1080.png`,
    });
  }
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
        window.viewProbe.frame?.sections.length === 0 &&
        window.viewProbe.frame.notes.length > 0 &&
        window.viewProbe.frame.now === 1.4,
    );
    await expect(page.locator('[data-region="stage-a"] .view-host')).toHaveAttribute(
      'data-score-ready',
      'true',
    );
    await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
      'data-score-ready',
      'true',
    );
    await expect(page.locator('[data-region="score"]')).toHaveAttribute('data-score-ready', 'true');
    await page.screenshot({ animations: 'disabled', path: `${shots}/${file}-1920x1080.png` });
  }
});
