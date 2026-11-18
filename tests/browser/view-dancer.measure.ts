import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { indexDancer, poseAt } from '../../src/views/dancer/model';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/dancer`;
const themes = ['arcade', 'sunset', 'phosphor', 'riso', 'pocket'];
test('Dancer: Studio themes, pure seeking, real-score mapping and CPU submission', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  const ready = async () => {
    await expect(page.locator('[data-region="score"]')).toHaveAttribute('data-score-ready', 'true');
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('.view-host')).every(
        (host) => host.getAttribute('data-score-ready') === 'true',
      ),
    );
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('.view-status')).every(
        (status) => status.textContent === '',
      ),
    );
  };
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'dancer');
  // Keep another live view in B for every Stage A Studio capture.
  const a = page.locator('[data-region="stage-a"]');
  await a.getByRole('button', { name: 'Views', exact: true }).click();
  const band = a.getByRole('button', { name: 'The band on Stage B', exact: true });
  await revealView(band);
  await band.click();
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 10.4 &&
      window.viewProbe.frame.from === 4 &&
      window.viewProbe.frame.to === 20,
  );
  await ready();
  await expect(page.locator('[data-region="stage-b"] canvas')).toHaveCount(1);
  const evidence = [];
  for (const name of themes) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, name);
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    await page.screenshot({ path: `${shots}/${name}-studio-1920x1080.png` });
    await a.locator('canvas').screenshot({ path: `${shots}/${name}-stage-a.png` });
    const result = await page.evaluate(async () => {
      const frame = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1, now: 10.4 };
      const el = document.createElement('div');
      document.body.append(el);
      const handle = await window.viewProbe.definition.mount(el);
      const labels: {
        text: string;
        foreground: string;
        background: number[];
        contrast: number;
        x: number;
        y: number;
        width: number;
        height: number;
      }[] = [];
      const luminance = (rgb: number[]) =>
        rgb
          .map((n) => {
            const c = n / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
      const fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
        if (this.canvas === el.querySelector('canvas')) {
          const background = [
            ...this.getImageData(Math.round(x), Math.round(y - 3), 1, 1).data,
          ].slice(0, 3);
          const colour = String(this.fillStyle),
            foreground = colour.match(/\w\w/g)!.map((v) => parseInt(v, 16));
          const a = luminance(foreground),
            b = luminance(background),
            metrics = this.measureText(text);
          labels.push({
            text,
            foreground: colour,
            background,
            contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
            x: x - (this.textAlign === 'center' ? metrics.width / 2 : 0),
            y: y - metrics.actualBoundingBoxAscent,
            width: metrics.width,
            height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
          });
        }
        if (max === undefined) fill.call(this, text, x, y);
        else fill.call(this, text, x, y, max);
      };
      try {
        handle.frame(frame);
      } finally {
        CanvasRenderingContext2D.prototype.fillText = fill;
      }
      const picture = el.querySelector('canvas')!.toDataURL();
      handle.frame({ ...frame, now: 22, width: 560, height: 469 });
      handle.frame({ ...frame, now: 1.2 });
      handle.frame(frame);
      const restored = el.querySelector('canvas')!.toDataURL();
      const fresh = document.createElement('div');
      document.body.append(fresh);
      const freshHandle = await window.viewProbe.definition.mount(fresh);
      freshHandle.frame(frame);
      const identicalFresh = fresh.querySelector('canvas')!.toDataURL() === picture;
      freshHandle.dispose();
      fresh.remove();
      handle.dispose();
      el.remove();
      return {
        theme: frame.theme.name,
        deterministic: picture === restored,
        identicalFresh,
        labels,
        minContrast: Math.min(...labels.map((l) => l.contrast)),
      };
    });
    expect(result.deterministic).toBe(true);
    expect(result.identicalFresh).toBe(true);
    expect(result.minContrast).toBeGreaterThanOrEqual(4.5);
    for (const label of result.labels) {
      expect(label.x).toBeGreaterThanOrEqual(0);
      expect(label.x + label.width).toBeLessThanOrEqual(1300);
    }
    evidence.push(result);
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.waitForFunction(() => window.viewProbe.frame?.theme.name === 'arcade');
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  const score = indexDancer(frame.notes),
    state = poseAt(score, 10.4);
  expect(state.layers).toHaveLength(3);
  expect(state.counts).toEqual({ feet: 0, head: 0, hands: 1, hips: 1, arms: 1, torso: 0 });
  expect(
    frame.instruments.find(
      (i) => i.id === state.layers.find((l) => l.roles.includes('hips'))?.note.instrument,
    )?.name,
  ).toBe('subBass');
  const mapping = {
    sourceRecords: frame.notes.length,
    scoredNotes: score.notes.length,
    counts: state.counts,
    pose: state.pose,
    sounding: state.sounding,
    floorMarks: state.layers.length,
    merged: state.layers.length - state.tiles.size,
    layers: state.layers.map((l) => ({
      ...l,
      name: frame.instruments.find((i) => i.id === l.note.instrument)?.name,
    })),
  };
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const measured = await page.evaluate(async () => {
    const source = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1, now: 10.4 };
    const el = document.createElement('div');
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
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
      width: 1300,
      height: 760,
      dpr: 1,
      userAgent: navigator.userAgent,
    };
    handle.dispose();
    el.remove();
    return result;
  });
  // A clearly different real score: faster, shorter bass notes and two hand rhythms.
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(1.4);
    },
    await readFile('corpus/programs/real-techno.strudel', 'utf8'),
  );
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 1.4 &&
      window.viewProbe.frame.sections.length === 0 &&
      window.viewProbe.frame.notes.length > 0,
  );
  await page.waitForFunction(
    () => window.viewProbe.frame?.from === 0 && window.viewProbe.frame.to === 12,
  );
  await ready();
  const technoFrame = await page.evaluate(() => window.viewProbe.frame!);
  const techno = poseAt(indexDancer(technoFrame.notes), 1.4);
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  await page.screenshot({ path: `${shots}/techno-studio-1920x1080.png` });
  // Polyphonic cutoff regression: bass plus three pad voices must keep a mean target.
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(12.4);
    },
    await readFile('corpus/programs/piece-moss-radio.strudel', 'utf8'),
  );
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 12.4 &&
      window.viewProbe.frame.from === 8 &&
      window.viewProbe.frame.to === 24 &&
      window.viewProbe.frame.notes.length > 0,
  );
  await ready();
  const mossFrame = await page.evaluate(() => window.viewProbe.frame!);
  const mossState = poseAt(indexDancer(mossFrame.notes), 12.4);
  expect(mossState.counts.arms).toBe(4);
  expect(mossState.pose.arms).toBeLessThan(0.7);
  expect(mossState.pose.arms).toBeGreaterThan(0.3);
  const moss = {
    counts: mossState.counts,
    pose: mossState.pose,
    notes: mossState.layers.length,
    armTargets: mossState.layers.filter((l) => l.armTarget !== undefined).map((l) => l.armTarget),
  };
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  await page.screenshot({ path: `${shots}/moss-radio-studio-1920x1080.png` });
  await writeFile(`${shots}/moss-frame.json`, JSON.stringify(mossFrame, null, 2));
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(10.4);
    },
    await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
  );
  await page.waitForFunction(
    () => window.viewProbe.frame?.now === 10.4 && window.viewProbe.frame.sections.length > 0,
  );
  await page.waitForFunction(
    () => window.viewProbe.frame?.from === 4 && window.viewProbe.frame.to === 20,
  );
  await ready();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-studio-1920x1080.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.4);
  });
  await page.setViewportSize({ width: 2560, height: 1440 });
  const dancerB = page
    .locator('[data-region="view-shelf"]')
    .getByRole('button', { name: 'Dancer on Stage B', exact: true });
  await revealView(dancerB);
  await dancerB.click();
  const b = page.locator('[data-region="stage-b"]');
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await page.waitForFunction(
    () =>
      (window.viewProbe.frame?.width ?? Infinity) < 600 &&
      window.viewProbe.frame?.from === 4 &&
      window.viewProbe.frame.to === 20,
  );
  await ready();
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  await b.screenshot({ path: `${shots}/stage-b-560.png` });
  const narrow = await b.locator('.view-host').boundingBox();
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify(
      {
        measured,
        mapping,
        techno: { counts: techno.counts, notes: techno.layers.length },
        moss,
        narrow,
        themes: evidence,
      },
      null,
      2,
    ),
  );
  console.log(
    'Dancer CPU, mapping, reversibility and contrast:',
    JSON.stringify({
      measured,
      mapping,
      techno: { counts: techno.counts, notes: techno.layers.length },
      moss,
      narrow,
      themes: evidence.map(({ theme, deterministic, identicalFresh, minContrast }) => ({
        theme,
        deterministic,
        identicalFresh,
        minContrast,
      })),
    }),
  );
});
