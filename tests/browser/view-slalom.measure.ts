import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { indexSlalom, slalomState } from '../../src/views/slalom/model';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/slalom`;
test('Slalom: real Studio mapping, five themes, reversibility and frame cost', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'slalom');
  await page.evaluate(async () => {
    await window.odmStudio.seek(17.4);
  });
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 17.4 &&
      window.viewProbe.frame.from <= 17 &&
      window.viewProbe.frame.to >= 20 &&
      window.viewProbe.frame.notes.some((n) => n.hasOnset && n.start === 17.25),
  );
  // Put a second actual view on Stage B via its shelf.
  const b = page.locator('[data-region="stage-b"]');
  await b.getByRole('button', { name: 'Views', exact: true }).click();
  const band = b.locator('.shelf-popover [data-view="band"] .view-to-b');
  await revealView(band);
  await band.click();
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await page.evaluate(() => document.fonts.ready);
  const frames = [];
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    await page.screenshot({ path: `${shots}/${theme}-1920x1080.png` });
    frames.push(await page.evaluate(() => window.viewProbe.frame!));
  }
  const frame = frames[0],
    score = indexSlalom(frame),
    state = slalomState(score, frame);
  expect(state.passed.map((g) => g.label)).toEqual(['G4', 'E♭4']);
  expect(state.next?.label).toBe('D4');
  const mapping = {
    melody: frame.instruments.find((i) => i.id === score.melody)?.name,
    terrain: frame.instruments.find((i) => i.id === score.terrain)?.name,
    passed: state.passed.map((g) => ({ pitch: g.label, start: g.start })),
    next: state.next?.label,
    visible: {
      gates: state.gates.length,
      terrain: state.terrain.length,
      sides: state.sides.length,
      bundles: state.bundles.length,
    },
    active: score.notes
      .filter((n) => n.start <= frame.now && n.end > frame.now)
      .map((n) => ({
        part: frame.instruments.find((i) => i.id === n.instrument)?.name,
        value: n.value,
        start: n.start,
        end: n.end,
      })),
  };
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const measured = await page.evaluate(async (frames) => {
    const el = document.createElement('div');
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    const canvas = () => el.querySelector('canvas')!;
    const deterministic = [];
    for (const f of frames)
      for (const lookAhead of [1, 4, 8]) {
        const source = { ...f, lookAhead, width: 1300, height: 760, dpr: 1 };
        handle.frame(source);
        const first = canvas().toDataURL();
        handle.frame({ ...source, now: 22.8, width: 559, height: 471 });
        handle.frame({ ...source, now: 16.9 });
        handle.frame(source);
        const restored = canvas().toDataURL();
        const other = document.createElement('div');
        const fresh = await window.viewProbe.definition.mount(other);
        fresh.frame(source);
        deterministic.push({
          theme: f.theme.name,
          lookAhead,
          backwardsResize: first === restored,
          fresh: first === other.querySelector('canvas')!.toDataURL(),
        });
        fresh.dispose();
        other.remove();
      }
    const source = { ...frames[0], width: 1300, height: 760, dpr: 1 };
    const run = (rebuilt: boolean) => {
      const costs = [];
      for (let i = 0; i < 330; i++) {
        const f = {
          ...source,
          now: 17.4 + i / 1000,
          notes: rebuilt ? source.notes.slice() : source.notes,
        };
        const start = performance.now();
        handle.frame(f);
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
    // Every text call uses opaque text/panel tokens. Record actual colours and sizes.
    const labels: { text: string; size: string; ink: string }[] = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
      labels.push({ text, size: this.font, ink: String(this.fillStyle) });
      if (max === undefined) original.call(this, text, x, y);
      else original.call(this, text, x, y, max);
    };
    try {
      handle.frame(source);
    } finally {
      CanvasRenderingContext2D.prototype.fillText = original;
    }
    const contrast = frames.map((f) => {
      const lum = (hex: string) => {
        const rgb = hex
          .match(/\w\w/g)!
          .map((s) => parseInt(s, 16) / 255)
          .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const a = lum(f.theme.text.slice(1)),
        b = lum(f.theme.panel.slice(1));
      return { theme: f.theme.name, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
    handle.dispose();
    el.remove();
    return {
      cached,
      rebuilt,
      deterministic,
      contrast,
      labels,
      notes: source.notes.length,
      width: 1300,
      height: 760,
      userAgent: navigator.userAgent,
    };
  }, frames);
  expect(measured.deterministic.every((r) => r.backwardsResize && r.fresh)).toBe(true);
  expect(measured.contrast.every((r) => r.ratio >= 4.5)).toBe(true);
  await writeFile(`${shots}/measurements.json`, JSON.stringify({ ...measured, mapping }, null, 2));
  console.log('Slalom mapping and CPU submission:', JSON.stringify({ ...measured, mapping }));
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await b.getByRole('button', { name: 'Views', exact: true }).click();
  const tile = b.locator('.shelf-popover [data-view="slalom"] .view-to-b');
  await revealView(tile);
  await tile.click();
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    await b.screenshot({ path: `${shots}/${theme}-stage-b-narrow.png` });
  }
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.waitForFunction(
    () =>
      Math.abs(
        (window.viewProbe.frame?.width ?? 0) -
          (document.querySelector('[data-region="stage-b"] .view-host')?.clientWidth ?? -1),
      ) < 1,
  );
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    await b.screenshot({ path: `${shots}/${theme}-stage-b-560.png` });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 17.4,
  );
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await b.getByRole('button', { name: 'Views', exact: true }).click();
  await revealView(band);
  await band.click();
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
      window.viewProbe.frame.from <= 1.4 &&
      window.viewProbe.frame.to >= 2 &&
      window.viewProbe.frame.notes.length > 0,
  );
  await expect(page.locator('[data-region="stage-a"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await expect(b.locator('.view-status')).toHaveText('');
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  const technoFrame = await page.evaluate(() => window.viewProbe.frame!);
  const technoScore = indexSlalom(technoFrame),
    technoState = slalomState(technoScore, technoFrame);
  await writeFile(
    `${shots}/techno-mapping.json`,
    JSON.stringify(
      {
        gates: technoState.gates.length,
        terrain: technoState.terrain.length,
        sides: technoState.sides.length,
        next: technoState.next?.label,
        passed: technoState.passed.map((g) => g.label),
        melody: technoFrame.instruments.find((i) => i.id === technoScore.melody)?.name,
      },
      null,
      2,
    ),
  );
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    await page.screenshot({ path: `${shots}/real-techno-${theme}-1920x1080.png` });
  }
});
