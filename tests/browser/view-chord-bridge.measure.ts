import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { analyse, stateAt } from '../../src/views/chord-bridge/model';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/chord-bridge`;
for (const [file, now] of [
  ['real-dubstep-arranged', 17.4],
  ['real-techno', 1.4],
] as const) {
  test(`Chord bridge: ${file} in Studio, all themes and narrow Stage B`, async ({ page }) => {
    await mkdir(shots, { recursive: true });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepare(page, 'chord-bridge', file);
    await page.evaluate(async (now) => {
      window.odmStudio.pause();
      await window.odmStudio.seek(now);
    }, now);
    await page.waitForFunction((now) => {
      const frame = window.viewProbe.frame;
      return (
        frame?.now === now &&
        frame.from <= Math.max(0, Math.floor(now) - 1) &&
        frame.to >= Math.max(0, Math.floor(now) - 1) + 4
      );
    }, now);
    await page.setViewportSize({ width: 2560, height: 1440 });
    const band = page
      .locator('[data-region="view-shelf"]')
      .getByRole('button', { name: 'The band on Stage B', exact: true });
    await revealView(band);
    await band.click();
    await expect(page.locator('[data-region="stage-b"] canvas')).toHaveCount(1);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const results: unknown[] = [];
    for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
      await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
      await page.waitForFunction(
        (theme) =>
          window.viewProbe.frame?.theme.name === theme &&
          Math.abs(
            window.viewProbe.frame.width -
              (document.querySelector('[data-region="stage-a"] .view-host')?.clientWidth ?? 0),
          ) < 1,
        theme,
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      });
      await page.screenshot({ path: `${shots}/${file}-${theme}-1920x1080.png` });
      const measured = await page.evaluate(async () => {
        const source = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1 };
        const el = document.createElement('div');
        document.body.append(el);
        const handle = await window.viewProbe.definition.mount(el);
        const capture = (frame: typeof source) => {
          const texts: {
            text: string;
            x: number;
            y: number;
            width: number;
            size: number;
            ink: { x: number; y: number; w: number; h: number };
          }[] = [];
          const blocks: { x: number; y: number; w: number; h: number }[] = [];
          const fill = CanvasRenderingContext2D.prototype.fillText;
          const rect = CanvasRenderingContext2D.prototype.fillRect;
          CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
            const m = this.measureText(text);
            texts.push({
              text,
              x,
              y,
              width: m.width,
              size: parseFloat(this.font),
              ink: {
                x: x - m.actualBoundingBoxLeft,
                y: y - m.actualBoundingBoxAscent,
                w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
                h: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
              },
            });
            if (max === undefined) fill.call(this, text, x, y);
            else fill.call(this, text, x, y, max);
          };
          CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
            if (h === 28 && w >= 52 && w <= 78) blocks.push({ x, y, w, h });
            rect.call(this, x, y, w, h);
          };
          try {
            handle.frame(frame);
          } finally {
            CanvasRenderingContext2D.prototype.fillText = fill;
            CanvasRenderingContext2D.prototype.fillRect = rect;
          }
          return { texts, blocks };
        };
        const { texts, blocks } = capture(source);
        const narrow = capture({ ...source, width: 560, height: 470 });
        handle.frame(source);
        const picture = el.querySelector('canvas')!.toDataURL();
        handle.frame({ ...source, now: 25.7, width: 560, height: 470 });
        handle.frame({ ...source, now: 2.1 });
        handle.frame(source);
        const deterministic = picture === el.querySelector('canvas')!.toDataURL();
        // Fresh mount is also identical after the backwards seek and resize.
        const fresh = document.createElement('div');
        const freshHandle = await window.viewProbe.definition.mount(fresh);
        freshHandle.frame(source);
        const freshEqual = picture === fresh.querySelector('canvas')!.toDataURL();
        freshHandle.dispose();
        const run = (rebuilt: boolean) => {
          const costs: number[] = [];
          for (let i = 0; i < 330; i++) {
            const frame = {
              ...source,
              now: source.now + i / 1000,
              notes: rebuilt ? source.notes.slice() : source.notes,
            };
            const start = performance.now();
            handle.frame(frame);
            if (i >= 30) costs.push(performance.now() - start);
          }
          costs.sort((a, b) => a - b);
          return { median: (costs[149] + costs[150]) / 2, p95: costs[285], frames: costs.length };
        };
        const luminance = (hex: string) => {
          const rgb = hex
            .slice(1)
            .match(/../g)!
            .map((v) => parseInt(v, 16) / 255)
            .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const foreground = luminance(source.theme.text);
        const contrast = [source.theme.ground, source.theme.panel].map((bg) => {
          const background = luminance(bg);
          return (
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
          );
        });
        const result = {
          theme: source.theme.name,
          deterministic,
          freshEqual,
          contrast,
          texts,
          blocks,
          narrow,
          cached: run(false),
          rebuilt: run(true),
          notes: source.notes.length,
          width: 1300,
          height: 760,
          userAgent: navigator.userAgent,
        };
        handle.dispose();
        el.remove();
        return result;
      });
      expect(measured.deterministic).toBe(true);
      expect(measured.freshEqual).toBe(true);
      expect(Math.min(...measured.contrast)).toBeGreaterThan(4.5);
      expect(measured.texts.every((t) => t.size >= 11)).toBe(true);
      if (file === 'real-techno')
        expect(measured.texts.some((t) => t.text.includes('4 edge'))).toBe(true);
      for (const drawing of [measured, measured.narrow]) {
        const overlap = (
          a: { x: number; y: number; w: number; h: number },
          b: { x: number; y: number; w: number; h: number },
        ) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        for (const [i, text] of drawing.texts.entries()) {
          expect(
            drawing.texts.slice(i + 1).filter((other) => overlap(text.ink, other.ink)),
            `${theme}: ${text.text} crosses text`,
          ).toEqual([]);
          for (const block of drawing.blocks) {
            const inside =
              text.ink.x >= block.x &&
              text.ink.x + text.ink.w <= block.x + block.w &&
              text.ink.y >= block.y &&
              text.ink.y + text.ink.h <= block.y + block.h;
            expect(
              overlap(text.ink, block) && !inside,
              `${theme}: ${text.text} crosses another block`,
            ).toBe(false);
          }
        }
      }
      if (file === 'real-dubstep-arranged') {
        for (const name of ['A♭2', 'E♭3', 'C4'])
          expect(measured.texts.some((t) => t.text === name)).toBe(true);
      }
      results.push(measured);
    }
    const frame = await page.evaluate(() => window.viewProbe.frame!);
    const bridge = analyse(frame.notes),
      state = stateAt(bridge, frame);
    const mapping = {
      chord: frame.instruments.find((i) => i.id === bridge.chord)?.name,
      melody: frame.instruments.find((i) => i.id === bridge.melody)?.name,
      piers: state.piers.map((p) => ({ start: p.start, pitches: p.tones.map((t) => t.midi) })),
      melodyNotes: state.melody.length,
      otherNotes: state.others.length,
    };
    await writeFile(
      `${shots}/${file}-measurements.json`,
      JSON.stringify({ results, mapping }, null, 2),
    );
    await writeFile(`${shots}/${file}-frame.json`, JSON.stringify(frame, null, 2));
    if (file === 'real-dubstep-arranged') {
      expect(mapping.piers.map((p) => p.start)).toEqual([16, 17, 18, 19]);
      expect(mapping.piers[1].pitches).toEqual([44, 51, 60]);
    }
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(
      (now) => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > now,
      now,
    );
    await page.screenshot({ path: `${shots}/${file}-playing.png` });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.evaluate(async (now) => window.odmStudio.seek(now), now);
    await page.setViewportSize({ width: 2560, height: 1440 });
    const narrow = page
      .locator('[data-region="view-shelf"]')
      .getByRole('button', { name: 'Chord bridge on Stage B', exact: true });
    await revealView(narrow);
    await narrow.click();
    await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
      'data-score-ready',
      'true',
    );
    await page.waitForFunction(() => (window.viewProbe.frame?.width ?? 0) < 600);
    for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
      await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
      await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      });
      await page
        .locator('[data-region="stage-b"]')
        .screenshot({ path: `${shots}/${file}-${theme}-stage-b-560.png` });
    }
  });
}

test('Chord bridge: dense real corpus remains counted', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'chord-bridge');
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(0.4);
    },
    await readFile('corpus/programs/micro-dense-64.strudel', 'utf8'),
  );
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 0.4 &&
      window.viewProbe.frame.sections.length === 0 &&
      window.viewProbe.frame.notes.length >= 1024,
  );
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  expect(stateAt(analyse(frame.notes), frame).others).toHaveLength(1024);
  const texts = await page.evaluate(async () => {
    const texts: string[] = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    const el = document.createElement('div');
    const handle = await window.viewProbe.definition.mount(el);
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
      texts.push(text);
      if (max === undefined) fill.call(this, text, x, y);
      else fill.call(this, text, x, y, max);
    };
    try {
      handle.frame(window.viewProbe.frame!);
    } finally {
      CanvasRenderingContext2D.prototype.fillText = fill;
      handle.dispose();
    }
    return texts;
  });
  expect(texts).toContain('1024 in window');
  expect(texts).toContain('1 / 1024');
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/dense-1920x1080.png` });
});
