import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { decibels, frequency, scoredNotes, spectrumBands } from '../../src/views/afterglow/model';
import type { ViewFrame, ViewHandle } from '../../src/views/types';

declare global {
  interface Window {
    afterglowEvidence: {
      snapshots: { time: number; spectrum: number[] }[];
      frames: ViewFrame[];
      handle: ViewHandle;
    };
  }
}
const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/afterglow`;

test('Afterglow: observed history, score reversibility, real Studio captures and CPU submission', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'afterglow');
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
    await window.odmStudio.seek(10.4);
    await document.fonts.ready;
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  expect(await page.evaluate(() => window.viewProbe.frame!.audio === undefined)).toBe(true);
  await page.screenshot({ path: `${shots}/before-play-1920x1080.png` });
  // Instrument the real mounted handle, leaving Studio's audio delivery intact.
  await page.evaluate(async () => {
    const handle = window.viewProbe.handle!,
      original = handle.frame.bind(handle);
    window.afterglowEvidence = { snapshots: [], frames: [], handle };
    let cell = -1;
    handle.frame = (f) => {
      if (f.playing && f.audio && Math.floor(f.now * 64) !== cell) {
        cell = Math.floor(f.now * 64);
        window.afterglowEvidence.frames.push({
          ...f,
          audio: { wave: f.audio.wave.slice(), spectrum: f.audio.spectrum.slice() },
        });
        if (f.now >= 9 && f.now <= 10.5)
          window.afterglowEvidence.snapshots.push({
            time: f.now,
            spectrum: Array.from(f.audio.spectrum),
          });
      }
      original(f);
    };
    await window.odmStudio.seek(0);
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => (window.viewProbe.frame?.now ?? 0) >= 10);
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  await page.waitForFunction(() => (window.viewProbe.frame?.now ?? 0) >= 10.4);
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(
    () => window.viewProbe.frame?.now === 10.4 && !window.viewProbe.frame.playing,
  );
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  const audioSize = await page.evaluate(() => ({
    wave: window.viewProbe.frame!.audio!.wave.length,
    bins: window.viewProbe.frame!.audio!.spectrum.length,
  }));
  const delivered = await page.evaluate(async () => {
    const peaks = window.afterglowEvidence.frames
      .filter((f) => f.now >= 10 && f.now <= 10.4)
      .map((f) => {
        const wave = f.audio!.wave;
        return Math.max(...wave) - Math.min(...wave);
      });
    const context = new AudioContext(),
      analyser = context.createAnalyser();
    const defaults = { min: analyser.minDecibels, max: analyser.maxDecibels };
    await context.close();
    return { peakToPeak: Math.max(...peaks), defaults };
  });
  expect(delivered.peakToPeak).toBeGreaterThan(0.01);
  expect(delivered.defaults).toEqual({ min: -100, max: -30 });
  const mapped = scoredNotes(frame);
  const mapping = {
    now: frame.now,
    lookAhead: frame.lookAhead,
    from: frame.from,
    to: frame.to,
    spans: mapped.length,
    pitched: mapped.filter((n) => n.hz !== undefined).length,
    floor: mapped.filter((n) => n.hz === undefined).length,
    sounding: mapped
      .filter((n) => n.note.start <= frame.now && n.note.end > frame.now)
      .map((n) => ({
        name: frame.instruments.find((i) => i.id === n.note.instrument)?.name,
        hz: n.hz,
        start: n.note.start,
        end: n.note.end,
      })),
  };
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const themeMeasurements = [];
  for (const name of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, name);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${shots}/dubstep-${name}-1920x1080.png` });
    await page
      .locator('[data-region="stage-a"] canvas')
      .screenshot({ path: `${shots}/dubstep-${name}-stage-a.png` });
    themeMeasurements.push(
      await page.evaluate(async () => {
        const source = {
          ...window.viewProbe.frame!,
          now: 10.4,
          playing: false,
          audio: undefined,
          width: 1300,
          height: 760,
          dpr: 1,
        };
        const el = document.createElement('div'),
          handle = await window.viewProbe.definition.mount(el);
        const canvas = el.querySelector('canvas')!;
        // Exemption applies only to measurements: a no-audio mount tests *all*
        // scored ink and every not-heard pixel exactly, against a fresh mount too.
        handle.frame(source);
        const original = canvas.toDataURL();
        handle.frame({ ...source, now: 22, width: 560, height: 469 });
        handle.frame({ ...source, now: 1.4 });
        handle.frame(source);
        const reversible = original === canvas.toDataURL();
        const freshEl = document.createElement('div'),
          fresh = await window.viewProbe.definition.mount(freshEl);
        fresh.frame(source);
        const matchesFresh = original === freshEl.querySelector('canvas')!.toDataURL();
        fresh.dispose();
        const texts: {
          text: string;
          left: number;
          right: number;
          top: number;
          bottom: number;
          size: number;
        }[] = [];
        const fill = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
          const m = this.measureText(text);
          texts.push({
            text,
            left: x - m.actualBoundingBoxLeft,
            right: x + m.actualBoundingBoxRight,
            top: y - m.actualBoundingBoxAscent,
            bottom: y + m.actualBoundingBoxDescent,
            size: parseFloat(this.font),
          });
          if (max === undefined) fill.call(this, text, x, y);
          else fill.call(this, text, x, y, max);
        };
        const layouts = [];
        for (const [width, height] of [
          [1300, 760],
          [560, 675],
          [560, 469],
          [487, 469],
          [window.viewProbe.frame!.width, window.viewProbe.frame!.height],
        ]) {
          texts.length = 0;
          handle.frame({ ...source, width, height });
          layouts.push({ width, height, texts: texts.slice() });
        }
        CanvasRenderingContext2D.prototype.fillText = fill;
        // Replay *actual captured* input to populate the independent benchmark store.
        for (const f of window.afterglowEvidence.frames)
          handle.frame({ ...f, theme: source.theme, width: 1300, height: 760, dpr: 1 });
        // A seek back must not expose retained heat to the right of now.
        const seek = { ...source, now: 9.4 };
        handle.frame(seek);
        const futureEl = document.createElement('div');
        const future = await window.viewProbe.definition.mount(futureEl);
        future.frame(seek);
        const left = Math.ceil(58 + (1300 - 18 - 58) * 0.75) + 4;
        const currentPixels = canvas
          .getContext('2d')!
          .getImageData(left, 86, 1300 - 18 - left, 760 - 118 - 86).data;
        const freshPixels = futureEl
          .querySelector('canvas')!
          .getContext('2d')!
          .getImageData(left, 86, 1300 - 18 - left, 760 - 118 - 86).data;
        const futureScoreOnly = currentPixels.every((v, i) => v === freshPixels[i]);
        future.dispose();
        const times: number[] = [];
        for (let i = 0; i < 330; i++) {
          const start = performance.now();
          handle.frame({ ...source, now: 10.4 + i / 1000 });
          if (i >= 30) times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        handle.dispose();
        const lum = (hex: string) =>
          hex
            .slice(1)
            .match(/../g)!
            .map((v) => parseInt(v, 16) / 255)
            .reduce(
              (s, v, i) =>
                s +
                (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) *
                  [0.2126, 0.7152, 0.0722][i],
              0,
            );
        const a = lum(source.theme.text),
          b = lum(source.theme.ground);
        return {
          name: source.theme.name,
          reversible,
          matchesFresh,
          futureScoreOnly,
          median: (times[149] + times[150]) / 2,
          p95: times[285],
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          layouts,
        };
      }),
    );
  }
  for (const result of themeMeasurements) {
    expect(result.reversible).toBe(true);
    expect(result.matchesFresh).toBe(true);
    expect(result.futureScoreOnly).toBe(true);
    expect(result.contrast).toBeGreaterThan(4.5);
    for (const box of result.layouts) {
      expect(
        box.texts.filter(
          (t) =>
            t.size < 11 || t.left < 0 || t.right > box.width || t.top < 0 || t.bottom > box.height,
        ),
      ).toEqual([]);
      const overlaps = box.texts.flatMap((a, i) =>
        box.texts
          .slice(i + 1)
          .filter(
            (b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
          )
          .map((b) => [a.text, b.text]),
      );
      expect(overlaps, `${result.name} ${box.width}x${box.height}`).toEqual([]);
    }
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.evaluate(() => window.odmStudio.seek(9.4));
  await page.waitForFunction(() => window.viewProbe.frame?.now === 9.4);
  await page.screenshot({ path: `${shots}/seek-back-1920x1080.png` });
  // Revisited history must be explicitly labelled; future measured columns stay hidden.
  const history = await page.evaluate(() => {
    const texts: string[] = [],
      fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
      texts.push(text);
      if (max === undefined) fill.call(this, text, x, y);
      else fill.call(this, text, x, y, max);
    };
    window.afterglowEvidence.handle.frame(window.viewProbe.frame!);
    CanvasRenderingContext2D.prototype.fillText = fill;
    return texts;
  });
  expect(history).toContain('EARLIER PASS · heard then');
  expect(history).toContain('Heat = measured · outlines = scored');
  expect(history.some((t) => /^MEASURED · [1-9]/.test(t))).toBe(true);
  const unheard = await page.evaluate(() => {
    const texts: string[] = [],
      fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
      texts.push(text);
      if (max === undefined) fill.call(this, text, x, y);
      else fill.call(this, text, x, y, max);
    };
    // No past measurement can exist before cycle zero. Earlier-pass labelling
    // belongs to visible measured columns, not merely a lower playhead value.
    window.afterglowEvidence.handle.frame({ ...window.viewProbe.frame!, now: 0 });
    CanvasRenderingContext2D.prototype.fillText = fill;
    window.afterglowEvidence.handle.frame(window.viewProbe.frame!);
    return texts;
  });
  expect(unheard).toContain('NOT HEARD · hatch');
  expect(unheard).not.toContain('EARLIER PASS · heard then');
  await choose('a', 'quilt');
  await choose('b', 'afterglow');
  await page.waitForFunction(() => window.viewProbe.frame!.width < 600);
  await page.locator('[data-region="stage-b"]').screenshot({ path: `${shots}/stage-b-narrow.png` });
  const narrow = await page.evaluate(() => ({
    width: window.viewProbe.frame!.width,
    height: window.viewProbe.frame!.height,
  }));
  await choose('b', 'quilt');
  await choose('a', 'afterglow');
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
  await page.screenshot({ path: `${shots}/techno-paused-1920x1080.png` });
  const technoNotes = scoredNotes(
    await page.evaluate(() => ({ ...window.viewProbe.frame!, audio: undefined })),
  );
  const techno = {
    now: 1.4,
    spans: technoNotes.length,
    pitched: technoNotes.filter((n) => n.hz !== undefined).length,
    floor: technoNotes.filter((n) => n.hz === undefined).length,
  };
  const snapshots = await page.evaluate(() => window.afterglowEvidence.snapshots);
  const resolution = audioSize.wave / 0.1 / (audioSize.bins * 2);
  const near = snapshots.filter((s) => s.time >= 10 && s.time <= 10.4);
  const strongest = near.map((s) => {
    const peak = Math.max(...s.spectrum),
      bin = s.spectrum.indexOf(peak);
    return { time: s.time, hz: bin * resolution, dBFS: decibels(peak) };
  });
  const bandPeaks = spectrumBands({
    wave: new Float32Array(audioSize.wave),
    spectrum: Uint8Array.from(near.at(-1)!.spectrum),
  });
  const measurement = {
    mapping,
    techno,
    delivered,
    narrow,
    themeMeasurements,
    strongest,
    bandPeaks: Array.from(bandPeaks),
    wobbleOutlineHz: frequency(39),
    source:
      'real dubstep program; synthesizers unchanged; sample assets are the shared local burst fixture. Mixed output only, no per-instrument attribution.',
    capturedSnapshots: snapshots.length,
  };
  console.log(
    'Afterglow measurements:',
    JSON.stringify({
      ...measurement,
      themeMeasurements: themeMeasurements.map((m) => ({
        name: m.name,
        median: m.median,
        p95: m.p95,
        contrast: m.contrast,
        reversible: m.reversible,
      })),
    }),
  );
  await writeFile(`${shots}/measurements.json`, JSON.stringify(measurement, null, 2));
});
