import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ViewDefinition, ViewFrame, ViewHandle } from '../../src/views/types';
import type {} from '../../src/studio/main';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/ring`;
declare global {
  interface Window {
    ringTest: {
      frame?: ViewFrame;
      handle?: ViewHandle;
      definition?: ViewDefinition;
      costs: number[];
      listeners: number;
    };
  }
}
async function frames(page: Page, count = 3) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
  }, count);
}
async function startAt(page: Page, cycle: number) {
  await page.evaluate(async (cycle) => {
    window.odmStudio.stop();
    await window.odmStudio.seek(cycle);
    await window.odmStudio.play();
  }, cycle);
}
async function select(page: Page, name: string) {
  const wide = page.locator('.wide-shelf');
  if (await wide.isVisible())
    await wide.getByRole('button', { name: `${name} on Stage A`, exact: true }).click();
  else {
    const stage = page.locator('[data-region="stage-a"]');
    await stage.getByRole('button', { name: 'Views', exact: true }).click();
    await stage
      .locator('.shelf-popover')
      .getByRole('button', { name: `${name} on Stage A`, exact: true })
      .click();
  }
}
async function prepare(page: Page, source: string) {
  await page.context().route('https://raw.githubusercontent.com/**', async (route) => {
    const map: Record<string, unknown> = {
      _base: `${new URL(route.request().url()).origin}/studio-sounds/`,
    };
    for (const name of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      map[name] = ['burst.wav', 'burst.wav', 'burst.wav'];
    await route.fulfill({ json: map });
  });
  await page
    .context()
    .route('**/studio-sounds/burst.wav', (route) =>
      route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
    );
  await page.addInitScript(() => {
    window.ringTest = { costs: [], listeners: 0 };
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, callback, options) {
      if (type.startsWith('webglcontext')) window.ringTest.listeners++;
      return add.call(this, type, callback, options);
    };
    EventTarget.prototype.removeEventListener = function (type, callback, options) {
      if (type.startsWith('webglcontext')) window.ringTest.listeners--;
      return remove.call(this, type, callback, options);
    };
  });
  // Instrument the actual built definition before the query-selected view mounts.
  await page.route('**/assets/ring.view-*.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const name = body.match(/export\{([\w$]+) as default\}/)?.[1];
    if (!name) throw Error('The built Ring module has no default definition');
    await route.fulfill({
      response,
      body:
        body +
        `
      const ringProbeDefinition = ${name};
      window.ringTest.definition = ringProbeDefinition;
      const ringProbeMount = ringProbeDefinition.mount;
      ringProbeDefinition.mount = async (element) => {
        const handle = await ringProbeMount(element);
        window.ringTest.handle = handle;
        return {
          frame(frame) {
            window.ringTest.frame = frame;
            const start = performance.now();
            handle.frame(frame);
            window.ringTest.costs.push(performance.now() - start);
          },
          dispose() { handle.dispose(); }
        };
      };
    `,
    });
  });
  await page.goto('/?inspect&a=test-card&b=&theme=arcade');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  expect(
    await page.evaluate(() =>
      performance.getEntriesByType('resource').some((entry) => /three\.module-/.test(entry.name)),
    ),
  ).toBe(false);
  const stage = page.locator('[data-region="stage-a"]');
  await stage.getByRole('button', { name: 'Views', exact: true }).click();
  await stage.locator('.shelf-popover [data-view="ring"] .view-choice').click();
  await page.evaluate(async (source) => {
    await window.odmStudio.load(source);
    window.ringTest.frame = undefined;
  }, source);
  await page.waitForFunction(() => !!window.ringTest.handle);
  await expect(page.locator('[data-ring]')).toHaveCount(1);
  await expect(page.locator('[data-region="stage-a"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await page.waitForFunction(
    () =>
      (window.ringTest.frame?.notes.length ?? 0) > 0 &&
      window.ringTest.frame?.instruments.length === window.odmStudio.app.state.rows.length,
  );
}

test('Ring: real arrangement, changing pixels, themes and disposable lifetime', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'));
  const canvas = page.locator('[data-ring]');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => window.odmStudio.app.state.playing && (window.ringTest.frame?.now ?? 0) > 0.25,
  );
  const before = await canvas.screenshot();
  await frames(page);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await frames(page);
  const stopped = await canvas.screenshot();
  await frames(page);
  expect((await canvas.screenshot()).equals(stopped)).toBe(true);
  const listeners = await page.evaluate(() => window.ringTest.listeners);
  for (let i = 0; i < 1; i++) {
    await select(page, 'Test card');
    await expect(canvas).toHaveCount(0);
    expect(await page.evaluate(() => window.ringTest.listeners)).toBe(0);
    await select(page, 'Ring');
    await expect(canvas).toHaveCount(1);
    expect(await page.evaluate(() => window.ringTest.listeners)).toBe(listeners);
  }
  for (const name of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click();
    await frames(page);
    await expect(page.locator('.view-status')).toHaveText('');
  }
  expect(errors).toEqual([]);
});

test('Ring: saturated sounding ink and clean ground beyond the halo', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'));
  await startAt(page, 10.4);
  await page.waitForFunction(
    () => (window.ringTest.frame?.now ?? 0) >= 10.4 && (window.ringTest.frame?.to ?? 0) >= 15,
  );
  await page.evaluate(() => {
    window.odmStudio.pause();
  });
  const result = await page.evaluate(async () => {
    const frame = { ...window.ringTest.frame!, now: 10.4, width: 1300, height: 760, dpr: 1 };
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:9999';
    document.body.append(el);
    const handle = await window.ringTest.definition!.mount(el);
    handle.frame(frame);
    const copy = document.createElement('canvas');
    copy.width = 1300;
    copy.height = 760;
    const context = copy.getContext('2d')!;
    context.drawImage(el.querySelector('canvas')!, 0, 0);
    const pixels = context.getImageData(0, 0, 1300, 760).data;
    const at = (x: number, y: number) => [
      ...pixels.slice((y * 1300 + x) * 4, (y * 1300 + x) * 4 + 3),
    ];
    const rgb = (hex: string) =>
      [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const ground = rgb(frame.theme.ground);
    let outsideError = 0;
    for (let y = 0; y < 760; y += 8)
      for (let x = 0; x < 1300; x += 8) {
        // The projected playing bands end within 321 px; allow another 12% of the 319.2 px radius.
        if (Math.hypot(x - 650, y - 380) <= 360) continue;
        outsideError = Math.max(
          outsideError,
          ...at(x, y).map((channel, i) => Math.abs(channel - ground[i])),
        );
      }
    const colours = [
      {
        actual: at(700, 145),
        expected: rgb(frame.instruments.find((i) => i.name === 'wobbleBass')!.colour),
      },
      {
        actual: at(700, 180),
        expected: rgb(frame.instruments.find((i) => i.name === 'subBass')!.colour),
      },
    ];
    handle.dispose();
    el.remove();
    return { outsideError, colours, halo: at(954, 380) };
  });
  expect(result.halo[1]).toBeGreaterThan(20);
  expect(result.halo[1]).toBeGreaterThan(result.halo[0] * 1.3);
  expect(result.outsideError).toBeLessThanOrEqual(1);
  for (const colour of result.colours)
    expect(
      Math.max(...colour.actual.map((channel, i) => Math.abs(channel - colour.expected[i]))),
    ).toBeLessThanOrEqual(2);
});

// Local measurements retain Ring’s detailed behaviour and visual evidence outside CI.
test('Ring visual evidence: five themes and motion', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'));
  const intro = await page.evaluateHandle(() => ({
    ...window.ringTest.frame!,
    now: 0.4,
    width: 1300,
    height: 760,
  }));
  await startAt(page, 10.4);
  await page.waitForFunction(
    () => (window.ringTest.frame?.now ?? 0) >= 10.4 && (window.ringTest.frame?.to ?? 0) >= 15,
  );
  await page.evaluate(() => {
    window.odmStudio.pause();
  });
  await frames(page);
  await mkdir(shots, { recursive: true });
  await writeFile(
    `${shots}/frame.json`,
    JSON.stringify(await page.evaluate(() => window.ringTest.frame), null, 2),
  );
  // Host frame has genuine section membership and score notes; control only the requested time/size.
  const saved = await page.evaluateHandle(() => ({
    ...window.ringTest.frame!,
    now: 10.4,
    width: 1300,
    height: 760,
  }));
  const standalone = await page.evaluateHandle(async () => {
    await document.fonts.ready;
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;inset:0;width:1300px;height:760px;z-index:9999;pointer-events:none';
    document.body.append(el);
    const handle = await window.ringTest.definition!.mount(el);
    return { el, handle };
  });
  await standalone.evaluate(({ handle }, frame) => {
    handle.frame(frame);
  }, intro);
  await page.screenshot({
    path: `${shots}/intro-1300x760.png`,
    clip: { x: 0, y: 0, width: 1300, height: 760 },
  });
  await intro.dispose();
  for (const name of ['arcade', 'phosphor', 'pocket', 'riso', 'sunset']) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click({ force: true });
    await frames(page);
    await standalone.evaluate(({ handle }, frame) => {
      handle.frame({
        ...frame,
        theme: window.ringTest.frame!.theme,
        instruments: window.ringTest.frame!.instruments,
      });
    }, saved);
    await page.screenshot({
      path: `${shots}/${name}-1300x760.png`,
      clip: { x: 0, y: 0, width: 1300, height: 760 },
    });
  }
  for (const [index, now] of [
    10.4,
    10.4 + (0.05 * 140) / 240,
    10.4 + (0.1 * 140) / 240,
  ].entries()) {
    await standalone.evaluate(
      ({ handle }, { frame, now }) => {
        handle.frame({ ...frame, now });
      },
      { frame: saved, now },
    );
    await page.screenshot({
      path: `${shots}/motion-${index}.png`,
      clip: { x: 0, y: 0, width: 1300, height: 760 },
    });
  }
  await standalone.evaluate(({ el, handle }, frame) => {
    el.style.width = '1920px';
    el.style.height = '1080px';
    handle.frame({ ...frame, width: 1920, height: 1080 });
  }, saved);
  await page.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  await standalone.evaluate(({ el, handle }) => {
    handle.dispose();
    el.remove();
  });
  await standalone.dispose();
  await saved.dispose();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await frames(page);
  await page.screenshot({ path: `${shots}/studio-1920x1080.png` });
});

test('Ring visual evidence: 300-frame CPU measurement', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'));
  await startAt(page, 10.4);
  await page.waitForFunction(
    () => (window.ringTest.frame?.now ?? 0) >= 10.4 && (window.ringTest.frame?.to ?? 0) >= 15,
  );
  await page.evaluate(() => {
    window.odmStudio.pause();
  });
  await frames(page);
  const saved = await page.evaluateHandle(() => ({
    ...window.ringTest.frame!,
    now: 10.4,
    width: 1300,
    height: 760,
    dpr: 1,
  }));
  await page.getByRole('button', { name: 'Clear Stage A', exact: true }).click();
  const standalone = await page.evaluateHandle(async () => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:9999';
    document.body.append(el);
    const handle = await window.ringTest.definition!.mount(el);
    return { el, handle };
  });
  const measured = await standalone.evaluate(async ({ handle }, frame) => {
    // Reselect Arcade for the measured glow path.
    const theme = { ...frame.theme };
    const costs: number[] = [];
    const seams: { cycle: number; cost: number }[] = [];
    let previousCycle = Math.floor(10.4);
    for (let i = 0; i < 310; i++) {
      await new Promise(requestAnimationFrame);
      const start = performance.now();
      const now = 10.4 + (i * frame.cps) / 60;
      handle.frame({ ...frame, theme, now });
      const cost = performance.now() - start;
      if (i >= 10) {
        costs.push(cost);
        if (Math.floor(now) !== previousCycle) seams.push({ cycle: Math.floor(now), cost });
      }
      previousCycle = Math.floor(now);
    }
    costs.sort((a, b) => a - b);
    return {
      frames: costs.length,
      median: (costs[149] + costs[150]) / 2,
      p95: costs[285],
      max: costs[299],
      seams,
      width: frame.width,
      height: frame.height,
      dpr: frame.dpr,
      userAgent: navigator.userAgent,
      renderer: (() => {
        const gl = document.querySelector<HTMLCanvasElement>('[data-ring]')?.getContext('webgl2');
        const extension = gl?.getExtension('WEBGL_debug_renderer_info');
        return extension
          ? String(gl?.getParameter(extension.UNMASKED_RENDERER_WEBGL))
          : 'unavailable';
      })(),
      playingBands: frame.instruments.filter((instrument) => instrument.inSection).length,
    };
  }, saved);
  await mkdir(shots, { recursive: true });
  console.log('Ring CPU frame cost:', JSON.stringify(measured));
  await writeFile(`${shots}/measurements.json`, JSON.stringify(measured, null, 2));
  expect(measured.playingBands).toBe(6);
  await standalone.evaluate(({ el, handle }) => {
    handle.dispose();
    el.remove();
  });
  await standalone.dispose();
  await saved.dispose();
});

for (const [name, file] of [
  ['techno', 'real-techno'],
  ['dense', 'micro-dense-64'],
]) {
  test(`Ring ${name}: real corpus score`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepare(page, await readFile(`corpus/programs/${file}.strudel`, 'utf8'));
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => (window.ringTest.frame?.now ?? 0) > 0.3);
    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: `${shots}/${name}-1920x1080.png` });
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await frames(page);
    await expect(page.locator('.view-status')).toHaveText('');
    expect(errors).toEqual([]);
  });
}
