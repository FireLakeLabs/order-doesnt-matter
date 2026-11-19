import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import {
  gardenLayout,
  gardenMoment,
  indexGarden,
  leafClusters,
} from '../../src/views/garden/model';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/garden`;
test('Garden: real Studio, five themes, cached CPU and exact time reversal', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  const ready = async () => {
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('.view-host')).every(
        (el) => el.getAttribute('data-score-ready') === 'true',
      ),
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
  };
  const chooseB = async (id: string) => {
    const stage = page.locator('[data-region="stage-b"]');
    const wide = (page.viewportSize()?.width ?? 0) >= 2200;
    if (!wide) await stage.getByRole('button', { name: 'Views', exact: true }).click();
    const choice = wide
      ? page.locator(`[data-region="view-shelf"] [data-view="${id}"] .view-to-b`)
      : stage.locator(`.shelf-popover [data-view="${id}"] .view-to-b`);
    await revealView(choice);
    await choice.click();
    await ready();
  };
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'garden');
  await chooseB('quilt');
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await ready();
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const score = indexGarden(frame);
  const mapping = [1300, frame.width, 560].map((width) => {
    const box = gardenLayout(score, width, width === 560 ? 469 : 760);
    const clusters = leafClusters(score, box);
    return {
      width,
      ...gardenMoment(score, clusters, 10.4),
      parts: score.plants.map((p) => ({
        name: frame.instruments.find((i) => i.id === p.id)?.name,
        leaves: p.leaves.length,
        grown: p.leaves.filter((l) => l.note.start <= 10.4).length,
      })),
      clusters: clusters
        .filter((c) => c.leaves.length > 1)
        .map((c) => ({
          part: frame.instruments.find((i) => i.id === c.plant.id)?.name,
          from: c.start,
          to: c.end,
          pitch: c.pitch,
          total: c.leaves.length,
          grown: c.leaves.filter((l) => l.note.start <= 10.4).length,
        })),
    };
  });
  const measurements = [];
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await ready();
    await page.screenshot({ path: `${shots}/dubstep-${theme}-1920x1080.png` });
    await page
      .locator('[data-region="stage-a"] canvas')
      .screenshot({ path: `${shots}/dubstep-${theme}-stage-a.png` });
    const measured = await page.evaluate(async () => {
      const source = { ...window.viewProbe.frame!, now: 10.4, width: 1300, height: 760, dpr: 1 };
      const el = document.createElement('div');
      document.body.append(el);
      const handle = await window.viewProbe.definition.mount(el),
        canvas = el.querySelector('canvas')!;
      const run = (rebuilt: boolean) => {
        const times: number[] = [];
        const warmup = rebuilt ? 10 : 30,
          frames = rebuilt ? 40 : 330;
        for (let i = 0; i < frames; i++) {
          const f = {
            ...source,
            now: 10.4 + i / 1000,
            notes: rebuilt ? source.notes.slice() : source.notes,
          };
          const start = performance.now();
          handle.frame(f);
          if (i >= warmup) times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        return {
          frames: times.length,
          median: (times[times.length / 2 - 1] + times[times.length / 2]) / 2,
          p95: times[Math.floor(times.length * 0.95)],
        };
      };
      const cached = run(false),
        rebuilt = run(true);
      handle.frame(source);
      const picture = canvas.toDataURL();
      handle.frame({ ...source, now: 22, width: 560, height: 469 });
      handle.frame({ ...source, now: 0.1 });
      handle.frame(source);
      const reversible = picture === canvas.toDataURL();
      const freshEl = document.createElement('div');
      document.body.append(freshEl);
      const fresh = await window.viewProbe.definition.mount(freshEl);
      fresh.frame(source);
      const freshEqual = picture === freshEl.querySelector('canvas')!.toDataURL();
      fresh.dispose();
      freshEl.remove();
      const labels: { text: string; size: number; ink: string }[] = [];
      const fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
        labels.push({
          text,
          size: Number(/([\d.]+)px/.exec(this.font)?.[1]),
          ink: String(this.fillStyle),
        });
        if (max === undefined) fill.call(this, text, x, y);
        else fill.call(this, text, x, y, max);
      };
      try {
        handle.frame({ ...source, notes: source.notes.slice() });
      } finally {
        CanvasRenderingContext2D.prototype.fillText = fill;
      }
      const luminance = (hex: string) => {
        const rgb = hex
          .replace('#', '')
          .match(/../g)!
          .map((v) => parseInt(v, 16) / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const contrast = [source.theme.panel, source.theme.ground].map((bg) => {
        const a = luminance(source.theme.text),
          b = luminance(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      let matureSprites = 0;
      const blit = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (image, ...coords: number[]) {
        if (coords.length === 8) matureSprites++;
        Reflect.apply(blit, this, [image, ...coords]);
      };
      try {
        handle.frame(source);
      } finally {
        CanvasRenderingContext2D.prototype.drawImage = blit;
      }
      // A cache hit must never reconstruct any whole-song petal or season geometry.
      let curves = 0;
      const curve = CanvasRenderingContext2D.prototype.bezierCurveTo;
      CanvasRenderingContext2D.prototype.bezierCurveTo = function (...args) {
        curves++;
        curve.apply(this, args);
      };
      try {
        handle.frame({
          ...source,
          now: 10.5,
          rooms: [{ orbit: 1, members: ['a changing live window'] }],
        });
      } finally {
        CanvasRenderingContext2D.prototype.bezierCurveTo = curve;
      }
      handle.dispose();
      el.remove();
      return {
        theme: source.theme.name,
        cached,
        rebuilt,
        reversible,
        freshEqual,
        contrast,
        labels,
        liveCurves: curves,
        matureSprites,
        userAgent: navigator.userAgent,
      };
    });
    expect(measured.reversible).toBe(true);
    expect(measured.freshEqual).toBe(true);
    expect(Math.min(...measured.contrast)).toBeGreaterThanOrEqual(4.5);
    expect(measured.labels.every((l) => l.size >= 11)).toBe(true);
    expect(measured.matureSprites).toBe(
      leafClusters(score, gardenLayout(score, 1300, 760)).filter((c) => c.start <= 10.4).length,
    );
    expect(measured.liveCurves).toBeGreaterThan(0);
    expect(measured.liveCurves).toBeLessThanOrEqual(score.plants.length * 3);
    measurements.push(measured);
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.evaluate(async () => window.odmStudio.seek(10.4));
  await page.setViewportSize({ width: 2560, height: 1440 });
  await chooseB('garden');
  await page.locator('[data-region="stage-b"]').screenshot({ path: `${shots}/stage-b-560.png` });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await ready();
  await page.locator('[data-region="stage-b"]').screenshot({ path: `${shots}/stage-b-narrow.png` });
  await chooseB('quilt');
  const other = [];
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
    for (const theme of file === 'real-techno'
      ? ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']
      : ['arcade']) {
      await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
      await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
      await ready();
      await page.screenshot({ path: `${shots}/${file}-${theme}-1920x1080.png` });
    }
    const f = await page.evaluate(() => window.viewProbe.frame!),
      g = indexGarden(f);
    other.push({
      file,
      ...gardenMoment(g, leafClusters(g, gardenLayout(g, f.width, f.height)), f.now),
    });
  }
  const result = { mapping, other, measurements };
  await writeFile(`${shots}/measurements.json`, JSON.stringify(result, null, 2));
  console.log(
    'Garden evidence:',
    JSON.stringify({
      mapping: mapping.map(({ clusters, ...m }) => ({ ...m, clusters: clusters.length })),
      other,
      measurements: measurements.map(({ labels, ...m }) => ({ ...m, labels: labels.length })),
    }),
  );
});
