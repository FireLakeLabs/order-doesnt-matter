import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { noteProgress } from '../../src/views/shared/timing';
import { analyse, crowded, fontSize, layout, lyrics } from '../../src/views/karaoke/model';
import type { ViewFrame } from '../../src/views/types';
// Local evidence only. CI runs the shared smoke.
test('karaoke: lyrics, five themes, crowded hats and CPU frame cost', async ({ page }) => {
  const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/karaoke`;
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'karaoke');
  const clock = await page.evaluateHandle(() => window.odmStudio.getPlayhead);
  await page.evaluate(() => {
    window.odmStudio.getPlayhead = () => 10.4;
    history.replaceState(null, '', '/?inspect&a=karaoke&b=');
  });
  await page.waitForFunction(
    () => window.viewProbe.frame?.now === 10.4 && window.viewProbe.frame.to >= 13,
  );
  const presented = () =>
    page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
  await page.setViewportSize({ width: 2560, height: 1440 });
  const costs: Record<string, unknown> = {};
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await presented();
    await page.screenshot({ path: `${shots}/${theme}-2560x1440.png` });
    costs[theme] = await page.evaluate(async () => {
      const frame = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1 },
        el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:9999';
      document.body.append(el);
      const handle = await window.viewProbe.definition.mount(el),
        samples: number[] = [];
      for (let i = 0; i < 310; i++) {
        await new Promise(requestAnimationFrame);
        const start = performance.now();
        handle.frame({ ...frame, now: 10.4 + (i * frame.cps) / 60 });
        if (i >= 10) samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      handle.dispose();
      el.remove();
      return {
        frames: 300,
        medianMs: (samples[149] + samples[150]) / 2,
        p95Ms: samples[285],
        maxMs: samples[299],
        width: 1300,
        height: 760,
        dpr: 1,
      };
    });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.getByRole('button', { name: 'Karaoke on Stage B', exact: true }).click();
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await presented();
  const stageBCanvas = page.locator('[data-region="stage-b"] canvas');
  const stageB = await stageBCanvas.evaluate((canvas) => ({
    width: parseFloat((canvas as HTMLCanvasElement).style.width),
    height: parseFloat((canvas as HTMLCanvasElement).style.height),
  }));
  await page.screenshot({ path: `${shots}/studio-stage-b-2560x1440.png` });
  await stageBCanvas.screenshot({ path: `${shots}/stage-b-in-host.png` });
  await page.getByRole('button', { name: 'Clear Stage B', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await presented();
  await page.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  const saved = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${shots}/frame.json`, JSON.stringify(saved, null, 2));
  const song = lyrics(saved, analyse(saved.notes));
  const words = song.rows.map((r) => ({
    instrument: r.instrument.name,
    words: r.words.map((w) => ({
      text: w.text,
      start: w.note.start,
      end: w.note.end,
      gain: w.gain,
      progress: noteProgress(w.note, saved.now),
      spans: w.spans.length,
    })),
    next: r.next.map((w) => w.text),
  }));
  const sizes = [
    { label: 'Stage A', width: 1300, height: 760 },
    { label: '1920 host', width: saved.width, height: saved.height },
    { label: 'Stage B', width: 560, height: 760 },
    { label: 'Stage B host', ...stageB },
  ].map((size) => {
    const g = layout(size, song.rows.length);
    return {
      ...size,
      wordAtGain1: fontSize(g, 1),
      mockupWordPx: 26,
      requiredWordPx: (26 * size.width) / 960,
      nameSize: g.nameSize,
      rowHeight: g.rowHeight,
      rows: song.rows.map((r) => ({
        name: r.instrument.name,
        crowded: crowded(r.words, song.bar, g, (s, font) => s.length * font * 0.6),
      })),
    };
  });
  const standalone = await page.evaluateHandle(async (saved) => {
    const el = document.createElement('div');
    el.id = 'karaoke-evidence';
    el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:9999';
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    handle.frame({ ...saved, width: 1300, height: 760, dpr: 1 });
    return { el, handle };
  }, saved);
  await page
    .locator('#karaoke-evidence canvas')
    .screenshot({ path: `${shots}/arcade-1300x760.png` });
  await standalone.evaluate(({ el, handle }, saved) => {
    el.style.width = '560px';
    handle.frame({ ...saved, width: 560, height: 760, dpr: 1 });
  }, saved);
  await page
    .locator('#karaoke-evidence canvas')
    .screenshot({ path: `${shots}/stage-b-560x760.png` });
  const drawings = await standalone.evaluate(
    ({ el, handle }, { saved, sizes }) => {
      const result = [];
      for (const size of sizes) {
        el.style.width = `${size.width}px`;
        el.style.height = `${size.height}px`;
        const canvas = el.querySelector('canvas')!,
          c = canvas.getContext('2d')!;
        const calls: { text: string; font: string }[] = [],
          fill = c.fillText;
        c.fillText = (...args: Parameters<CanvasRenderingContext2D['fillText']>) => {
          calls.push({ text: args[0], font: c.font });
          fill.apply(c, args);
        };
        handle.frame({ ...saved, width: size.width, height: size.height, dpr: 1 });
        c.fillText = fill;
        const pixels = c.getImageData(0, 0, canvas.width, canvas.height).data;
        let empty = 0,
          largest = 0;
        for (let y = 0; y < canvas.height; y++) {
          let occupied = 0;
          for (let x = 0; x < canvas.width; x++) {
            const p = (y * canvas.width + x) * 4;
            if (
              Math.abs(pixels[p] - pixels[0]) +
                Math.abs(pixels[p + 1] - pixels[1]) +
                Math.abs(pixels[p + 2] - pixels[2]) >
              24
            )
              occupied++;
          }
          empty = occupied >= 6 ? 0 : empty + 1;
          largest = Math.max(largest, empty);
        }
        result.push({
          label: size.label,
          width: size.width,
          height: size.height,
          maximumEmptyBandPx: largest,
          hatDots: calls.some((c) => c.text === '8' || c.text === '8 dots'),
          bassWords: calls
            .filter((c) => /^D#(1|2)$/.test(c.text))
            .map((c) => ({ text: c.text, font: c.font })),
        });
      }
      el.style.width = '1300px';
      el.style.height = '760px';
      return result;
    },
    { saved, sizes },
  );

  for (const [name, count, density, width] of [
    ['single', 1, 1, 1300],
    ['twenty', 20, 8, 1300],
    ['dense-500', 1, 500, 1300],
    ['twenty-stage-b', 20, 40, 560],
  ] as const) {
    await standalone.evaluate(
      ({ el, handle }, { saved, count, density, width }) => {
        const frame: ViewFrame = {
          ...saved,
          width,
          height: 760,
          dpr: 1,
          instruments: Array.from({ length: count }, (_, i) => ({
            ...saved.instruments[i % saved.instruments.length],
            id: String(i),
            index: i,
            name: `part ${i + 1}`,
          })),
          notes: Array.from({ length: count }, (_, i) =>
            Array.from({ length: 3 * density }, (_, j) => ({
              instrument: String(i),
              start: 9 + j / density,
              end: 9 + (j + 1) / density,
              hasOnset: true,
              value: { s: 'hh', gain: 0.5 },
            })),
          ).flat(),
        };
        el.style.width = `${width}px`;
        handle.frame(frame);
      },
      { saved, count, density, width },
    );
    await page.locator('#karaoke-evidence canvas').screenshot({ path: `${shots}/${name}.png` });
  }
  await standalone.evaluate(({ el, handle }, saved) => {
    el.style.width = '1300px';
    handle.frame({
      ...saved,
      width: 1300,
      height: 760,
      dpr: 1,
      from: 4,
      to: 11,
      notes: saved.notes.filter((n) => n.start < 11),
    });
  }, saved);
  await page.locator('#karaoke-evidence canvas').screenshot({ path: `${shots}/unasked-next.png` });
  const deterministic = await standalone.evaluate(({ el, handle }, saved) => {
    const frame = { ...saved, width: 1300, height: 760, dpr: 1 };
    handle.frame(frame);
    const first = el.querySelector('canvas')!.toDataURL();
    handle.frame({ ...frame, now: 4.2 });
    handle.frame({ ...frame, now: 17.1 });
    handle.frame(frame);
    return first === el.querySelector('canvas')!.toDataURL();
  }, saved);
  expect(deterministic).toBe(true);
  const hat = song.rows.find((r) => r.instrument.name === 'hh · drop')!;
  await standalone.evaluate(({ handle }, saved) => {
    handle.frame({ ...saved, width: 1300, height: 760, dpr: 1, now: 10.375 });
  }, saved);
  await page
    .locator('#karaoke-evidence canvas')
    .screenshot({ path: `${shots}/hat-landing-10.375.png` });
  await standalone.evaluate(({ handle }, saved) => {
    handle.frame({ ...saved, width: 1300, height: 760, dpr: 1, now: 10.4375 });
  }, saved);
  await page
    .locator('#karaoke-evidence canvas')
    .screenshot({ path: `${shots}/hat-mid-hop-10.4375.png` });
  await standalone.evaluate(({ el, handle }) => {
    handle.dispose();
    el.remove();
  });
  await clock.evaluate((clock) => {
    window.odmStudio.getPlayhead = clock;
  });
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.4);
    await window.odmStudio.play();
  });
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  await page.evaluate(() => window.odmStudio.pause());
  expect(errors).toEqual([]);
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify(
      { costs, words, sizes, drawings, hatWords: hat.words.length, deterministic, errors },
      null,
      2,
    ),
  );
  console.log('Karaoke measurements:', JSON.stringify({ costs, words, sizes, drawings }));
});
