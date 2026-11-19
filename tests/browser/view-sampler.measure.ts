import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/sampler`;
const themes = ['arcade', 'sunset', 'phosphor', 'riso', 'pocket'];

test('Sampler: decoded sources, all themes, reversibility, narrow stage and CPU cost', async ({
  page,
  context,
}) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'sampler');
  // Use the real default collections/files, rather than prepare's smoke WAV.
  await context.unroute('https://raw.githubusercontent.com/**');
  await context.unroute('**/view-evidence/burst.wav');
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await page.evaluate(() => document.fonts.ready);
  // Both visible stages in the Studio, with another view on B.
  const stageBViews = page
    .locator('[data-region="stage-b"]')
    .getByRole('button', { name: 'Views', exact: true });
  await stageBViews.click();
  const other = page
    .locator('[data-region="stage-b"] .shelf-popover')
    .getByRole('button', { name: 'Scope on Stage B', exact: true });
  await revealView(other);
  await other.click();
  await page.screenshot({ path: `${shots}/before-loading-1920x1080.png` });
  expect(await page.evaluate(() => window.viewProbe.frame!.samples!.get('bd', 0).status)).toBe(
    'loading',
  );
  // Warm all actual files by playback preparation, then return to the exact check moment.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.odmStudio.app.engine?.playing &&
      window.viewProbe.frame!.samples!.get('bd', 0).status === 'buffer',
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  // A seek directly to the drop has never triggered the earlier vocal. Warm it
  // through playback, never by asking the lookup to load anything.
  await page.evaluate(async () => {
    await window.odmStudio.seek(7.75);
    await window.odmStudio.play();
  });
  await page.waitForFunction(
    () => window.viewProbe.frame!.samples!.get('speech', 2).status === 'buffer',
  );
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  const frozen = await page.evaluateHandle(() => ({ ...window.viewProbe.frame!, now: 10.4 }));
  const measured = [];
  for (const name of themes) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, name);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${shots}/${name}-1920x1080.png` });
    await page
      .locator('[data-region="stage-a"] canvas')
      .screenshot({ path: `${shots}/${name}-stage-a.png` });
    measured.push(
      await page.evaluate(async (source) => {
        const frame = {
          ...source,
          theme: window.viewProbe.frame!.theme,
          instruments: window.viewProbe.frame!.instruments,
          width: 1300,
          height: 760,
          dpr: 1,
        };
        const el = document.createElement('div');
        document.body.append(el);
        const handle = await window.viewProbe.definition.mount(el);
        const texts: { text: string; x: number; y: number; width: number; font: string }[] = [];
        const fill = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
          texts.push({ text, x, y, width: this.measureText(text).width, font: this.font });
          if (max === undefined) fill.call(this, text, x, y);
          else fill.call(this, text, x, y, max);
        };
        handle.frame(frame);
        CanvasRenderingContext2D.prototype.fillText = fill;
        const canvas = el.querySelector('canvas')!;
        const picture = canvas.toDataURL();
        handle.frame({ ...frame, now: 22, width: 560, height: 675 });
        handle.frame({ ...frame, now: 1.25 });
        handle.frame(frame);
        const reversible = picture === canvas.toDataURL();
        const times: number[] = [];
        for (let i = 0; i < 330; i++) {
          const start = performance.now();
          handle.frame({ ...frame, now: 10.4 + i / 1000 });
          if (i >= 30) times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        const luminance = (colour: string) => {
          const rgb = colour
            .slice(1)
            .match(/../g)!
            .map((c) => parseInt(c, 16) / 255)
            .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const contrast = [frame.theme.ground, frame.theme.panel].map((background) => {
          const a = luminance(frame.theme.text),
            b = luminance(background);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
        const sounds = ['bd', 'sd', 'hh', 'oh', 'ade', 'speech'];
        const sources = sounds.map((sound) => {
          const index = sound === 'speech' ? 2 : 0,
            buffer = frame.samples!.get(sound, index);
          if (buffer.status !== 'buffer') return { sound, status: buffer.status };
          const notes = frame.notes.filter(
            (n) =>
              n.value.s === sound &&
              n.hasOnset &&
              n.start <= frame.now &&
              frame.instruments.some((p) => p.id === n.instrument && p.inSection && !p.muted),
          );
          const fractions = notes
            .map((n) => ({
              onset: n.start,
              fraction:
                (((frame.now - n.start) / frame.cps) * Math.abs(Number(n.value.speed ?? 1))) /
                (buffer.duration * (Number(n.value.end ?? 1) - Number(n.value.begin ?? 0))),
            }))
            .filter((c) => c.fraction < 1);
          return {
            sound,
            status: buffer.status,
            duration: buffer.duration,
            file: buffer.fileName,
            url: buffer.url,
            fractions,
          };
        });
        handle.dispose();
        el.remove();
        return {
          theme: frame.theme.name,
          reversible,
          median: (times[149] + times[150]) / 2,
          p95: times[285],
          contrast,
          texts,
          sources,
          notes: frame.notes.length,
        };
      }, frozen),
    );
  }
  await writeFile(`${shots}/measurements.json`, JSON.stringify(measured, null, 2));
  console.log(
    'SAMPLER REVERSIBILITY',
    measured.map((m) => ({ theme: m.theme, reversible: m.reversible })),
  );
  expect(measured.every((m) => m.reversible)).toBe(true);
  expect(measured.every((m) => Math.min(...m.contrast) >= 4.5)).toBe(true);
  expect(measured[0].sources.every((s) => s.status === 'buffer')).toBe(true);
  await writeFile(`${shots}/measurements.json`, JSON.stringify(measured, null, 2));
  console.log(
    'SAMPLER MEASURED',
    JSON.stringify(
      measured.map((m) => ({
        theme: m.theme,
        reversible: m.reversible,
        median: m.median,
        p95: m.p95,
        contrast: m.contrast,
        sources: m.sources,
        notes: m.notes,
      })),
    ),
  );
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.setViewportSize({ width: 2560, height: 1440 });
  const choice = page
    .locator('[data-region="view-shelf"]')
    .getByRole('button', { name: 'Sampler on Stage B', exact: true });
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
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-2560x1440.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  // A different real piece: four parts, three sample addresses and one synth.
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(10.4);
    },
    await readFile('corpus/programs/real-techno.strudel', 'utf8'),
  );
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () =>
      !!window.viewProbe.frame?.playing &&
      window.viewProbe.frame.samples!.get('cp', 0).status === 'buffer',
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await page.screenshot({ path: `${shots}/techno-2560x1440.png` });
  const techno = await page.evaluate(() => {
    const frame = window.viewProbe.frame!;
    return {
      instruments: frame.instruments.length,
      notes: frame.notes.length,
      sources: ['bd', 'hh', 'cp', 'sawtooth'].map((s) => {
        const source = frame.samples!.get(s, 0);
        return {
          sound: s,
          status: source.status,
          file: source.status === 'buffer' ? source.fileName : null,
        };
      }),
    };
  });
  await writeFile(`${shots}/techno.json`, JSON.stringify(techno, null, 2));

  // The corpus slice example deliberately has a placeholder URL. Supply a real
  // WAV fixture at that URL, decoded by the real playback cache, and disclose it.
  await context.route('https://your-url.com/', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(1.254);
    },
    await readFile('corpus/programs/real-custom-samples.strudel', 'utf8'),
  );
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => window.viewProbe.frame!.samples!.get('myvocal', 0).status === 'buffer',
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.evaluate(async () => {
    await window.odmStudio.seek(1.254);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 1.254);
  await page.screenshot({ path: `${shots}/slice-speed-fixture-2560x1440.png` });
  const slice = await page.evaluate(() => {
    const frame = window.viewProbe.frame!;
    const buffer = frame.samples!.get('myvocal', 0);
    const latest = frame.notes
      .filter((n) => n.hasOnset && n.start <= frame.now)
      .sort((a, b) => b.start - a.start)[0];
    return {
      now: frame.now,
      cps: frame.cps,
      value: latest.value,
      onset: latest.start,
      duration: buffer.status === 'buffer' ? buffer.duration : null,
      fraction:
        buffer.status === 'buffer'
          ? (((frame.now - latest.start) / frame.cps) * Number(latest.value.speed)) /
            (buffer.duration * (Number(latest.value.end) - Number(latest.value.begin)))
          : null,
    };
  });
  await writeFile(`${shots}/slice-speed.json`, JSON.stringify(slice, null, 2));
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(1.4);
    },
    await readFile('corpus/programs/micro-fragments-chop.strudel', 'utf8'),
  );
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 1.4 &&
      window.viewProbe.frame.notes.every((n) => n.value.s === 'sawtooth'),
  );
  await page.screenshot({ path: `${shots}/synth-only-fragments-2560x1440.png` });
  await page.evaluate(async () => {
    await window.odmStudio.load('note("c3 e3 g3")');
    await window.odmStudio.seek(0.4);
  });
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 0.4 &&
      window.viewProbe.frame.notes.every((n) => n.value.s === undefined),
  );
  await page.screenshot({ path: `${shots}/default-triangle-2560x1440.png` });
  await frozen.dispose();
});
