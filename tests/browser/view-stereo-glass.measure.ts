import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import {
  DENSITY_SIZE,
  measureGlass,
  scoredRim,
  glassLayout,
} from '../../src/views/stereo-glass/model';
import type { ViewFrame } from '../../src/views/types';

declare global {
  interface Window {
    glassCapture?: ViewFrame;
    glassHold?: boolean;
    glassTarget?: number;
  }
}
const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/stereo-glass`;
test('Stereo glass: measured span, all themes, reversible rim and CPU evidence', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'stereo-glass');
  // Freeze a COPY of the actual presented PCM and score frame, not the reused tap.
  await page.evaluate(() => {
    const handle = window.viewProbe.handle!,
      draw = handle.frame.bind(handle);
    handle.frame = (f) => {
      if (
        window.glassTarget !== undefined &&
        f.now >= window.glassTarget &&
        f.playing &&
        f.audio?.complete &&
        !window.glassCapture
      ) {
        window.glassCapture = {
          ...f,
          audio: {
            ...f.audio,
            left: f.audio.left!.slice(),
            right: f.audio.right!.slice(),
            wave: f.audio.wave.slice(),
            spectrum: f.audio.spectrum.slice(),
          },
        };
      }
      const saved = window.glassCapture;
      draw(
        window.glassHold && saved
          ? {
              ...saved,
              theme: f.theme,
              instruments: f.instruments,
              width: f.width,
              height: f.height,
              dpr: f.dpr,
            }
          : f,
      );
    };
  });
  // Keep another view in B in the real Studio, also at the 1920px layout.
  await page
    .locator('[data-region="stage-b"]')
    .getByRole('button', { name: 'Views', exact: true })
    .click();
  const choice = page
    .locator('[data-region="stage-b"] .shelf-popover')
    .getByRole('button', { name: 'The band on Stage B', exact: true });
  await revealView(choice);
  await choice.click();
  await page.evaluate(async () => {
    await window.odmStudio.seek(8);
    window.glassTarget = 10.4;
    window.glassHold = true;
    await window.odmStudio.play();
  });
  await page.waitForFunction(() => !!window.glassCapture);
  const raw = await page.evaluate(() => {
    const f = window.glassCapture!,
      a = f.audio!;
    return {
      ...f,
      audio: {
        ...a,
        left: Array.from(a.left!),
        right: Array.from(a.right!),
        wave: Array.from(a.wave),
        spectrum: Array.from(a.spectrum),
      },
    };
  });
  const frame: ViewFrame = {
    ...raw,
    audio: {
      ...raw.audio,
      left: Float32Array.from(raw.audio.left),
      right: Float32Array.from(raw.audio.right),
      wave: Float32Array.from(raw.audio.wave),
      spectrum: Uint8Array.from(raw.audio.spectrum),
    },
  };
  const measured = measureGlass(frame)!;
  expect(measured.samples).toBeGreaterThan(0);
  const ticks = scoredRim(frame),
    box = glassLayout(frame.width, frame.height, frame.instruments.length);
  const occupiedColumns = [...measured.bins.entries()]
    .filter(([, n]) => n > 0)
    .map(([i]) => i % DENSITY_SIZE);
  const densityWidth = Math.max(...occupiedColumns) - Math.min(...occupiedColumns);
  const mapping = {
    now: frame.now,
    scoreWindow: [frame.from, frame.to],
    parts: frame.instruments.length,
    ticks: ticks.length,
    defaultParts: ticks.filter((t) => t.source === 'default').length,
    scoreSpans: ticks.reduce((n, t) => n + t.count, 0),
    litOnsets: ticks.reduce((n, t) => n + t.onsets, 0),
    heldSpans: ticks.reduce((n, t) => n + t.held, 0),
    samples: measured.samples,
    durationMs: measured.durationMs,
    correlation: measured.correlation,
    widthDeltaSide: measured.width,
    widthPixels: measured.width * box.radius * 0.9,
    densityCentreWidthPixels: (densityWidth * 2 * box.radius) / (DENSITY_SIZE - 1),
    softFootprintWidthPixels: ((densityWidth + 3.2) * 2 * box.radius) / (DENSITY_SIZE - 1),
    lagMs: measured.lagMs,
    clipped: measured.clipped,
  };
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  const reversibility = [];
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    if (theme !== 'arcade') {
      await page.evaluate(async () => {
        window.odmStudio.stop();
        window.glassCapture = undefined;
        await window.odmStudio.seek(8);
        await window.odmStudio.play();
      });
      await page.waitForFunction(() => !!window.glassCapture);
    }
    await page.waitForFunction((t) => window.viewProbe.frame?.theme.name === t, theme);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${shots}/${theme}-1920x1080.png` });
    const result = await page.evaluate(async () => {
      const f = {
        ...window.glassCapture!,
        theme: window.viewProbe.frame!.theme,
        instruments: window.viewProbe.frame!.instruments,
        width: 1300,
        height: 760,
        dpr: 1,
      };
      const el = document.createElement('div'),
        handle = await window.viewProbe.definition.mount(el);
      const picture = () => el.querySelector('canvas')!.toDataURL();
      const results = [];
      // Exact reversibility applies to scored rim / no measurement only. The live
      // glass has no repeat-time PCM; its supplied span is intentionally not replayed.
      for (const playing of [false, true]) {
        const source = { ...f, playing, audio: undefined };
        handle.frame(source);
        const before = picture();
        handle.frame({ ...f, now: 22, width: 560, height: 471, dpr: 2 });
        handle.frame({ ...source, now: 3 });
        handle.frame(source);
        results.push(before === picture());
      }
      const luminance = (hex: string) => {
        const rgb = hex
          .match(/[a-f\d]{2}/gi)!
          .map((v) => parseInt(v, 16) / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const ground = luminance(f.theme.ground),
        ink = luminance(f.theme.text);
      const contrast = (Math.max(ground, ink) + 0.05) / (Math.min(ground, ink) + 0.05);
      const labels: { text: string; x: number; y: number; width: number; size: number }[] = [];
      const ctx = el.querySelector('canvas')!.getContext('2d')!;
      const fill = ctx.fillText.bind(ctx);
      ctx.fillText = (text, x, y) => {
        labels.push({
          text,
          x:
            ctx.textAlign === 'right'
              ? x - ctx.measureText(text).width
              : ctx.textAlign === 'center'
                ? x - ctx.measureText(text).width / 2
                : x,
          y,
          width: ctx.measureText(text).width,
          size: parseFloat(ctx.font),
        });
        fill(text, x, y);
      };
      const audits = [];
      for (const [width, height] of [
        [1300, 760],
        [1131, 468],
        [559, 675],
        [559, 468],
      ]) {
        labels.length = 0;
        handle.frame({ ...f, width, height, playing: false, audio: undefined });
        const collisions = labels.flatMap((a, i) =>
          labels
            .slice(i + 1)
            .filter((b) => Math.abs(a.y - b.y) < 12 && a.x < b.x + b.width && b.x < a.x + a.width)
            .map((b) => [a.text, b.text]),
        );
        audits.push({
          width,
          height,
          collisions,
          minFont: Math.min(...labels.map((l) => l.size)),
          outOfBounds: labels.filter((l) => l.x < 0 || l.x + l.width > width).map((l) => l.text),
        });
      }
      handle.dispose();
      el.remove();
      return { theme: f.theme.name, paused: results[0], rim: results[1], contrast, audits };
    });
    expect(result.paused).toBe(true);
    expect(result.rim).toBe(true);
    expect(result.contrast).toBeGreaterThan(4.5);
    for (const audit of result.audits) {
      expect(audit.collisions).toEqual([]);
      expect(audit.outOfBounds).toEqual([]);
      expect(audit.minFont).toBeGreaterThanOrEqual(11);
    }
    reversibility.push(result);
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  const costs = await page.evaluate(async () => {
    const source = { ...window.glassCapture!, width: 1300, height: 760, dpr: 1 };
    const el = document.createElement('div'),
      handle = await window.viewProbe.definition.mount(el);
    const times = [];
    for (let i = 0; i < 330; i++) {
      const start = performance.now();
      handle.frame({ ...source, now: source.now + i / 1000 });
      if (i >= 30) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    handle.dispose();
    el.remove();
    return {
      frames: times.length,
      median: (times[149] + times[150]) / 2,
      p95: times[285],
      max: times[299],
      width: 1300,
      height: 760,
      userAgent: navigator.userAgent,
    };
  });
  await page.evaluate(() => {
    window.glassHold = false;
    window.odmStudio.pause();
  });
  await page.waitForFunction(() => !window.viewProbe.frame?.playing);
  await page.screenshot({ path: `${shots}/paused-no-measurement.png` });
  await page.setViewportSize({ width: 2560, height: 1440 });
  const bChoice = page
    .locator('[data-region="view-shelf"]')
    .getByRole('button', { name: 'Stereo glass on Stage B', exact: true });
  await revealView(bChoice);
  await bChoice.click();
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  await page.locator('[data-region="stage-b"]').screenshot({ path: `${shots}/stage-b-560.png` });
  // Different real piece; same local sample substitution used by shared evidence.
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(1.4);
      await window.odmStudio.play();
    },
    await readFile('corpus/programs/real-techno.strudel', 'utf8'),
  );
  await page.waitForFunction(() => !!window.viewProbe.frame?.audio?.complete);
  await page.screenshot({ path: `${shots}/real-techno-playing.png` });
  await page.evaluate(() => window.odmStudio.stop());
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify(
      {
        mapping,
        costs,
        reversibility,
        sampleAssets:
          'Local burst.wav substituted for remote sample bank; synths and score are real.',
      },
      null,
      2,
    ),
  );
  console.log('STEREO GLASS MEASURED', JSON.stringify({ mapping, costs, reversibility }));
});

test('Stereo glass: hard-left and hard-right measured fixture', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'stereo-glass');
  await page.evaluate(async () => {
    await window.odmStudio.load('setcps(1); s("bd").pan("<0 1 0.5>").gain(0.5)');
    const handle = window.viewProbe.handle!,
      draw = handle.frame.bind(handle);
    handle.frame = (f) => {
      if (
        f.playing &&
        f.audio?.complete &&
        Math.floor(f.now) === window.glassTarget &&
        f.now % 1 > 0.06 &&
        f.now % 1 < 0.095 &&
        !window.glassCapture
      ) {
        window.glassCapture = {
          ...f,
          audio: {
            ...f.audio,
            left: f.audio.left!.slice(),
            right: f.audio.right!.slice(),
            wave: f.audio.wave.slice(),
          },
        };
      }
      draw(
        window.glassHold && window.glassCapture
          ? { ...window.glassCapture, width: f.width, height: f.height }
          : f,
      );
    };
    window.glassTarget = 0;
    window.glassHold = true;
    await window.odmStudio.play();
  });
  const facts = [];
  for (const [cycle, name] of [
    [0, 'left'],
    [1, 'right'],
  ] as const) {
    await page.waitForFunction(
      (c) => !!window.glassCapture && Math.floor(window.glassCapture.now) === c,
      cycle,
    );
    facts.push(
      await page.evaluate(() => {
        const f = window.glassCapture!,
          a = f.audio!;
        let xy = 0,
          x2 = 0,
          y2 = 0,
          left = 0,
          right = 0;
        for (let i = 0; i < a.left!.length; i++) {
          const l = a.left![i],
            r = a.right![i],
            x = (r - l) / 2,
            y = (l + r) / 2;
          xy += x * y;
          x2 += x * x;
          y2 += y * y;
          left += l * l;
          right += r * r;
        }
        return { cycle: Math.floor(f.now), xy, x2, y2, left, right };
      }),
    );
    await page.screenshot({ path: `${shots}/hard-${name}.png` });
    await page.evaluate(() => {
      window.glassHold = false;
      window.glassTarget = 1;
      window.glassCapture = undefined;
    });
    if (cycle === 0)
      await page.evaluate(() => {
        window.glassHold = true;
      });
  }
  expect(facts[0].xy).toBeLessThan(0);
  expect(facts[1].xy).toBeGreaterThan(0);
  expect(facts[0].right).toBeLessThan(facts[0].left * 0.0001);
  expect(facts[1].left).toBeLessThan(facts[1].right * 0.0001);
  await page.evaluate(() => window.odmStudio.stop());
  await writeFile(`${shots}/hard-pan.json`, JSON.stringify(facts, null, 2));
});
