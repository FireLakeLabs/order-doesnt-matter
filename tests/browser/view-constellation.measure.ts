import { revealView } from './shelf';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { ViewDefinition, ViewFrame, ViewHandle } from '../../src/views/types';
import type {} from '../../src/studio/main';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/constellation`;
declare global {
  interface Window {
    constellationProbe: {
      latest?: ViewFrame;
      definition: ViewDefinition;
      original: ViewDefinition['mount'];
      display?: ViewHandle;
      host?: HTMLDivElement;
    };
  }
}
async function frames(page: Page, count = 3) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
  }, count);
}
async function select(page: Page, name: string) {
  const previous = await page.locator('[data-region="stage-a"] canvas').elementHandle();
  await page
    .locator('[data-region="stage-a"]')
    .getByRole('button', { name: 'Views', exact: true })
    .click();
  const choice = page
    .locator('[data-region="stage-a"] .shelf-popover')
    .getByRole('button', { name, exact: true, includeHidden: true });
  await revealView(choice);
  await choice.click();
  await expect(page.locator('[data-region="stage-a"] .shelf-popover')).toHaveCount(0);
  if (previous) {
    await page.waitForFunction((canvas) => !canvas.isConnected, previous);
    await previous.dispose();
  }
  await expect(page.locator('[data-region="stage-a"] canvas')).toHaveCount(1);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-region="stage-a"] .view-host')
        ?.getAttribute('data-score-ready') === 'true',
    undefined,
    { timeout: 0 },
  );
  if (name === 'Constellation on Stage A')
    await page.waitForFunction(() => (window.constellationProbe.latest?.notes.length ?? 0) > 0);
}
async function load(page: Page, path: string) {
  await page.evaluate(
    async (source) => window.odmStudio.load(source),
    await readFile(path, 'utf8'),
  );
  await frames(page);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-region="stage-a"] .view-host')
        ?.getAttribute('data-score-ready') === 'true',
    undefined,
    { timeout: 0 },
  );
  await page.waitForFunction(() => window.constellationProbe.latest?.notes.length);
  await frames(page);
}
async function show(page: Page, now: number, width = 1300, height = 760) {
  await page.evaluate(
    ({ now, width, height }) => {
      const probe = window.constellationProbe;
      const source = probe.latest!;
      Object.assign(probe.host!.style, { width: `${width}px`, height: `${height}px` });
      probe.display!.frame({
        ...source,
        instruments: source.instruments.map((instrument) => ({
          ...instrument,
          inSection: (() => {
            const state = window.odmStudio.app.state;
            const last = state.sections.at(-1);
            const length = last ? last.start + last.cycles : 0;
            if (!length) return true;
            const phase = ((now % length) + length) % length;
            const section = state.sections.find(
              (s) => phase >= s.start && phase < s.start + s.cycles,
            );
            return (
              !!section &&
              state.rows.some(
                (row) =>
                  row.id === instrument.id &&
                  row.uses.some((use) => use.path.some((node) => node.id === section.id)),
              )
            );
          })(),
          sounding: source.notes.some(
            (note) =>
              note.instrument === instrument.id &&
              note.hasOnset &&
              note.start <= now &&
              note.end > now,
          ),
        })),
        width,
        height,
        dpr: 1,
        now,
      });
    },
    { now, width, height },
  );
}

test('Constellation: real arrangement, cache cost, five themes, lifecycle, no-section and dense systems', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await context.route('https://raw.githubusercontent.com/**', async (route) => {
    const map: Record<string, unknown> = {
      _base: `${new URL(route.request().url()).origin}/constellation-sounds/`,
    };
    for (const name of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      map[name] = ['burst.wav', 'burst.wav', 'burst.wav'];
    await route.fulfill({ json: map });
  });
  await context.route('**/constellation-sounds/burst.wav', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?a=constellation&theme=arcade&b=&inspect');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  await expect(page.locator('[data-region="stage-a"] canvas')).toHaveCount(1);
  await page.evaluate(async () => {
    const resource = performance
      .getEntriesByType('resource')
      .find((entry) => /\/constellation\.view-[^/]+\.js/.test(entry.name));
    if (!resource) throw Error('Constellation chunk was not loaded by the stage');
    const module = (await import(resource.name)) as { default: ViewDefinition };
    const definition = module.default;
    const original = definition.mount;
    window.constellationProbe = { definition, original };
    definition.mount = async (element) => {
      window.constellationProbe.latest = undefined;
      const handle = await original(element);
      return {
        frame(frame) {
          window.constellationProbe.latest = frame;
          handle.frame(frame);
        },
        dispose() {
          handle.dispose();
        },
      };
    };
  });
  // Remount through the shell to capture host frames for the comparison and profiling stage.
  await select(page, 'Test card on Stage A');
  await select(page, 'Constellation on Stage A');
  await load(page, 'corpus/programs/real-dubstep-arranged.strudel');
  expect(
    await page.evaluate(() => ({
      instruments: window.constellationProbe.latest!.instruments.length,
      sections: window.constellationProbe.latest!.sections.length,
      duration: window.constellationProbe.latest!.to - window.constellationProbe.latest!.from,
    })),
  ).toEqual({ instruments: 13, sections: 5, duration: 28 });
  const canvas = page.locator('[data-region="stage-a"] canvas');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => window.odmStudio.app.state.playing && window.odmStudio.getPlayhead() > 0.2,
  );
  const before = await canvas.screenshot();
  await frames(page, 5);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  // Capture the real running page at the first drop through the controller's seek API.
  await page.evaluate(async () => {
    window.odmStudio.stop();
    await window.odmStudio.seek(10.4);
    await window.odmStudio.play();
  });
  await page.waitForFunction(() => window.odmStudio.getPlayhead() >= 10.4);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await frames(page);
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/arcade-studio-1920x1080.png` });
  const stopped = await canvas.screenshot();
  await frames(page, 5);
  expect((await canvas.screenshot()).equals(stopped)).toBe(true);

  // Exercise actual stage swap ownership, collecting garbage before listener counts.
  await select(page, 'Test card on Stage A');
  await select(page, 'Constellation on Stage A');
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const listeners = (await cdp.send('Memory.getDOMCounters')).jsEventListeners;
  await select(page, 'Test card on Stage A');
  await select(page, 'Constellation on Stage A');
  await cdp.send('HeapProfiler.collectGarbage');
  expect((await cdp.send('Memory.getDOMCounters')).jsEventListeners).toBeLessThanOrEqual(listeners);

  // Same real score, drawn in an exactly 1300x760 stage for visual comparison and CPU timing.
  expect(await page.evaluate(() => window.constellationProbe.latest!.notes.length)).toBeGreaterThan(
    0,
  );
  await page.evaluate(async () => {
    const probe = window.constellationProbe;
    const host = document.createElement('div');
    host.id = 'constellation-comparison';
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      width: '1300px',
      height: '760px',
      zIndex: '9999',
    });
    document.body.append(host);
    probe.host = host;
    probe.display = await probe.original(host);
  });
  const comparison = page.locator('#constellation-comparison');
  // The overlay is temporarily removed from hit testing so actual theme controls remain usable.
  await comparison.evaluate((host: HTMLElement) => {
    host.style.pointerEvents = 'none';
  });
  const themeCosts: Record<string, { median: number; p95: number; frames: number }> = {};
  for (const theme of ['arcade', 'phosphor', 'pocket', 'riso', 'sunset']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click({ force: true });
    await page.waitForFunction(
      (theme) => window.constellationProbe.latest?.theme.name === theme,
      theme,
    );
    await page.evaluate(() => document.fonts.ready);
    await show(page, 10.4);
    await comparison.screenshot({ path: `${shots}/${theme}-1300x760.png` });
    themeCosts[theme] = await page.evaluate(() => {
      const probe = window.constellationProbe;
      const source = { ...probe.latest!, width: 1300, height: 760, dpr: 1, now: 10.4 };
      const samples: number[] = [];
      for (let i = 0; i < 360; i++) {
        const start = performance.now();
        for (let j = 0; j < 1; j++)
          probe.display!.frame({ ...source, now: 10.4 + (i * 10 + j) / 10000 });
        if (i >= 30) samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      return {
        median: samples[Math.floor(samples.length / 2)],
        p95: samples[Math.floor(samples.length * 0.95)],
        frames: samples.length,
      };
    });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click({ force: true });
  await page.waitForFunction(() => window.constellationProbe.latest?.theme.name === 'arcade');
  await show(page, 10.4, 560, 760);
  await comparison.screenshot({ path: `${shots}/arcade-560x760.png` });
  await show(page, 10.4, 1920, 1080);
  await comparison.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  await page.evaluate(async () => window.odmStudio.seek(1));
  await page.waitForFunction(
    () =>
      window.constellationProbe.latest?.now === 1 &&
      window.constellationProbe.latest.notes.some((note) => note.start <= 1 && note.end > 1),
  );
  await frames(page);
  await show(page, 1);
  await comparison.screenshot({ path: `${shots}/arcade-intro.png` });
  await page.evaluate(async () => window.odmStudio.seek(10.4));
  await page.waitForFunction(
    () =>
      window.constellationProbe.latest?.now === 10.4 &&
      window.constellationProbe.latest.notes.some((note) => note.start <= 10.4 && note.end > 10.4),
  );
  await frames(page);
  for (let i = 0; i < 3; i++) {
    const cps = await page.evaluate(() => window.constellationProbe.latest!.cps);
    await show(page, 10.4 + i * 0.05 * cps);
    await comparison.screenshot({ path: `${shots}/arcade-motion-${i}.png` });
  }
  await show(page, 10.4);
  const costs = await page.evaluate(() => {
    const probe = window.constellationProbe;
    const source = { ...probe.latest!, width: 1300, height: 760, dpr: 1, now: 10.4 };
    const run = (rebuild: boolean) => {
      const times: number[] = [];
      const batch = 1;
      for (let i = 0; i < 360; i++) {
        const frame = {
          ...source,
          now: 10.4 + i / 1000,
          notes: rebuild ? source.notes.slice() : source.notes,
        };
        const start = performance.now();
        for (let j = 0; j < batch; j++) {
          frame.now += 0.0001;
          probe.display!.frame(frame);
        }
        const elapsed = (performance.now() - start) / batch;
        if (i >= 30) times.push(elapsed);
      }
      times.sort((a, b) => a - b);
      return {
        frames: times.length * batch,
        median: times[Math.floor(times.length / 2)],
        p95: times[Math.floor(times.length * 0.95)],
      };
    };
    return { cached: run(false), rebuilt: run(true), notes: source.notes.length };
  });
  console.log('Constellation CPU frame cost:', JSON.stringify(costs));
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify({ ...costs, themeCosts, listeners, errors }, null, 2),
  );

  for (const [piece, name] of [
    ['real-techno', 'techno'],
    ['micro-dense-64', 'dense'],
  ]) {
    await load(page, `corpus/programs/${piece}.strudel`);
    expect(await page.evaluate(() => window.constellationProbe.latest!.sections)).toHaveLength(0);

    await show(page, 1.4);
    await comparison.screenshot({ path: `${shots}/${name}-1300x760.png` });
  }
  await page.evaluate(async () =>
    window.odmStudio.load(
      's("sine").lpf(sine.range(140,2600)).gain(0.7).pan(0.5).room(0.4).attack(0.1).release(0.5).shape(0.3).delay(0.2).speed(1).fast(2).every(4,x=>x.rev())',
    ),
  );
  await page.waitForFunction(
    () =>
      window.constellationProbe.latest?.instruments.length === 1 &&
      window.constellationProbe.latest.notes.length > 0,
  );
  await show(page, 0.4, 560, 760);
  await comparison.screenshot({ path: `${shots}/nine-settings-560x760.png` });
  await page.evaluate(() => {
    const probe = window.constellationProbe;
    const source = probe.latest!;
    const instruments = Array.from({ length: 20 }, (_, index) => ({
      ...source.instruments[0],
      id: String(index),
      name: `Voice ${index + 1}`,
      index,
      inSection: true,
    }));
    const notes = instruments.flatMap((instrument) =>
      source.notes.map((note) => ({ ...note, instrument: instrument.id })),
    );
    probe.display!.frame({
      ...source,
      instruments,
      notes,
      width: 560,
      height: 760,
      now: 0.4,
      rooms: [{ orbit: 1, members: instruments.map((i) => i.id) }],
    });
  });
  await comparison.screenshot({ path: `${shots}/twenty-560x760.png` });
  await page.evaluate(() => {
    const probe = window.constellationProbe;
    const source = probe.latest!;
    const instruments = Array.from({ length: 20 }, (_, index) => ({
      ...source.instruments[0],
      id: String(index),
      name: `Voice ${index + 1}`,
      index,
      inSection: true,
    }));
    const notes = instruments.flatMap((instrument) =>
      source.notes.map((note) => ({ ...note, instrument: instrument.id })),
    );
    const canvas = probe.host!.querySelector('canvas')!;
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 105 }));
    probe.display!.frame({
      ...source,
      instruments,
      notes,
      width: 560,
      height: 760,
      now: 0.4,
      rooms: [{ orbit: 1, members: instruments.map((i) => i.id) }],
    });
  });
  await comparison.screenshot({ path: `${shots}/twenty-expanded-560x760.png` });
  await page.evaluate(() => {
    const probe = window.constellationProbe;
    probe.display!.dispose();
    probe.host!.remove();
    probe.definition.mount = probe.original;
  });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('[data-region="stage-a"] .view-status')).toHaveText('');
  expect(errors).toEqual([]);
});
