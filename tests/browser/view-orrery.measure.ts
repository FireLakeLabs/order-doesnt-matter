import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { indexOrrery, periodText } from '../../src/views/orrery/model';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/orrery`;
test('Orrery: real Studio mapping, five themes, exact reversibility and CPU cost', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'orrery');
  const choose = async (stage: 'a' | 'b', id: string) => {
    const region = page.locator(`[data-region="stage-${stage}"]`);
    await region.getByRole('button', { name: 'Views', exact: true }).click();
    const choice = region.locator(
      `.shelf-popover [data-view="${id}"] ${stage === 'a' ? '.view-choice' : '.view-to-b'}`,
    );
    await revealView(choice);
    await choice.click();
    await expect(region.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  };
  await choose('b', 'quilt');
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await page.evaluate(() => document.fonts.ready);
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  const score = indexOrrery(frame);
  const mapping = score.orbits.map((o) => ({
    name: frame.instruments.find((i) => i.id === o.id)?.name,
    period: periodText(o.period),
    observed: o.observed,
    perLap: o.marks.reduce((sum, m) => sum + m.count, 0),
    reason: o.reason,
  }));
  expect([frame.from, frame.to]).toEqual([0, 28]);
  expect(mapping.map((o) => o.period)).toEqual([
    '4',
    '4',
    '1/4',
    '1/8',
    '1',
    'unknown',
    '1',
    '1',
    '1/8',
    '1/2',
    '4',
    '4',
    '1',
  ]);
  expect(mapping.reduce((sum, o) => sum + o.observed, 0)).toBe(339);
  expect(periodText(score.common)).toBe('4');
  expect(score.complete).toBe(false);
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const themes = [];
  for (const name of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, name);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${shots}/dubstep-${name}-1920x1080.png` });
    await page
      .locator('[data-region="stage-a"] canvas')
      .screenshot({ path: `${shots}/dubstep-${name}-stage-a.png` });
    themes.push(
      await page.evaluate(async () => {
        const source = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1, now: 10.4 };
        const el = document.createElement('div');
        document.body.append(el);
        const handle = await window.viewProbe.definition.mount(el);
        const texts: {
          text: string;
          x: number;
          y: number;
          width: number;
          font: string;
          align: string;
          colour: string;
          left: number;
          right: number;
          top: number;
          bottom: number;
        }[] = [];
        const fill = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
          const metrics = this.measureText(text);
          texts.push({
            left: x - metrics.actualBoundingBoxLeft,
            right: x + metrics.actualBoundingBoxRight,
            top: y - metrics.actualBoundingBoxAscent,
            bottom: y + metrics.actualBoundingBoxDescent,
            text,
            x,
            y,
            width: this.measureText(text).width,
            font: this.font,
            align: this.textAlign,
            colour: String(this.fillStyle),
          });
          if (max === undefined) fill.call(this, text, x, y);
          else fill.call(this, text, x, y, max);
        };
        const labelLayouts = [];
        for (const [width, height] of [
          [1300, 760],
          [560, 675],
          [560, 469],
          [window.viewProbe.frame!.width, window.viewProbe.frame!.height],
        ]) {
          texts.length = 0;
          handle.frame({ ...source, width, height });
          labelLayouts.push({ width, height, texts: texts.slice() });
        }
        handle.frame(source);
        CanvasRenderingContext2D.prototype.fillText = fill;
        const canvas = el.querySelector('canvas')!;
        const picture = canvas.toDataURL();
        handle.frame({ ...source, now: 22, width: 560, height: 675 });
        handle.frame({ ...source, now: 1.4 });
        handle.frame(source);
        const deterministic = picture === canvas.toDataURL();
        const freshEl = document.createElement('div');
        const fresh = await window.viewProbe.definition.mount(freshEl);
        fresh.frame(source);
        const matchesFresh = picture === freshEl.querySelector('canvas')!.toDataURL();
        fresh.dispose();
        const times: number[] = [];
        for (let i = 0; i < 330; i++) {
          const start = performance.now();
          handle.frame({ ...source, now: 10.4 + i / 1000 });
          if (i >= 30) times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        const rebuilt: number[] = [];
        for (let i = 0; i < 40; i++) {
          const start = performance.now();
          handle.frame({ ...source, notes: source.notes.slice() });
          if (i >= 10) rebuilt.push(performance.now() - start);
        }
        rebuilt.sort((a, b) => a - b);
        handle.dispose();
        el.remove();
        const luminance = (hex: string) => {
          const values = hex
            .replace('#', '')
            .match(/../g)!
            .map((x) => parseInt(x, 16) / 255)
            .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
          return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
        };
        const contrast = (a: string, b: string) => {
          const x = luminance(a),
            y = luminance(b);
          return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
        };
        return {
          name: source.theme.name,
          deterministic,
          matchesFresh,
          texts: labelLayouts[0].texts,
          labelLayouts,
          contrastGround: contrast(source.theme.text, source.theme.ground),
          contrastPanel: contrast(source.theme.text, source.theme.panel),
          median: (times[149] + times[150]) / 2,
          p95: times[285],
          rebuiltMedian: rebuilt[15],
          rebuiltP95: rebuilt[28],
          frames: 300,
        };
      }),
    );
  }
  for (const result of themes) {
    expect(result.deterministic).toBe(true);
    expect(result.matchesFresh).toBe(true);
    expect(Math.min(result.contrastGround, result.contrastPanel)).toBeGreaterThan(4.5);
    for (const layout of result.labelLayouts) {
      expect(
        layout.texts.every(
          (t) =>
            parseFloat(t.font) >= 11 &&
            t.left >= 0 &&
            t.right <= layout.width &&
            t.top >= 0 &&
            t.bottom <= layout.height,
        ),
      ).toBe(true);
      const overlaps = layout.texts.flatMap((a, index) =>
        layout.texts
          .slice(index + 1)
          .filter(
            (b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
          )
          .map((b) => [a.text, b.text]),
      );
      expect(overlaps, `${result.name} at ${layout.width}×${layout.height}`).toEqual([]);
    }
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.evaluate(async () => {
    await window.odmStudio.seek(12);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 12);
  await page.screenshot({ path: `${shots}/alignment-bar-13.png` });
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  // The actual narrow Stage B at 1920, with Quilt kept on Stage A.
  await choose('a', 'quilt');
  await choose('b', 'orrery');
  await page.waitForFunction(
    () =>
      Math.abs(
        (window.viewProbe.frame?.width ?? Infinity) -
          (document.querySelector('[data-region="stage-b"] .view-host')?.clientWidth ?? 0),
      ) < 1,
  );
  await page.locator('[data-region="stage-b"]').screenshot({ path: `${shots}/stage-b-narrow.png` });
  const narrow = await page.evaluate(() => ({
    width: window.viewProbe.frame!.width,
    height: window.viewProbe.frame!.height,
  }));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await choose('b', 'quilt');
  await choose('a', 'orrery');
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(1.4);
    },
    await readFile('corpus/programs/real-techno.strudel', 'utf8'),
  );
  await page.waitForFunction(
    () => window.viewProbe.frame?.now === 1.4 && window.viewProbe.frame.sections.length === 0,
  );
  for (const name of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, name);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${shots}/techno-${name}-1920x1080.png` });
  }
  const techno = await page.evaluate(() => window.viewProbe.frame!);
  const technoMapping = indexOrrery(techno).orbits.map((o) => ({
    name: techno.instruments.find((i) => i.id === o.id)?.name,
    period: periodText(o.period),
    observed: o.observed,
  }));
  const measurements = {
    mapping,
    common: periodText(score.common),
    complete: score.complete,
    technoMapping,
    themes,
    narrow,
    width: 1300,
    height: 760,
  };
  await writeFile(`${shots}/measurements.json`, JSON.stringify(measurements, null, 2));
  console.log(
    'Orrery mapping and CPU:',
    JSON.stringify({
      ...measurements,
      themes: themes.map(({ texts, ...rest }) => ({ ...rest, labels: texts.length })),
    }),
  );
});
