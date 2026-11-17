import { revealView } from './shelf';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Page, test as Test } from '@playwright/test';
import type { ViewDefinition, ViewFrame, ViewHandle } from '../../src/views/types';
import type {} from '../../src/studio/main';

declare global {
  interface Window {
    viewProbe: {
      definition: ViewDefinition;
      handle?: ViewHandle;
      frame?: ViewFrame;
      listeners: number;
    };
  }
}
async function presented(page: Page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
}
export async function prepare(page: Page, id: string, file = 'real-dubstep-arranged') {
  await page.context().route('https://raw.githubusercontent.com/**', (route) => {
    const bank: Record<string, unknown> = {
      _base: 'https://raw.githubusercontent.com/view-evidence/',
    };
    for (const s of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      bank[s] = ['burst.wav', 'burst.wav', 'burst.wav'];
    return route.fulfill({ json: bank });
  });
  await page
    .context()
    .route('**/view-evidence/burst.wav', (route) =>
      route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
    );
  await page.addInitScript(() => {
    window.viewProbe = { definition: undefined as unknown as ViewDefinition, listeners: 0 };
    const add = EventTarget.prototype.addEventListener,
      remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, callback, options) {
      if (
        type.startsWith('webglcontext') ||
        type.startsWith('pointer') ||
        type === 'lostpointercapture'
      )
        window.viewProbe.listeners++;
      return add.call(this, type, callback, options);
    };
    EventTarget.prototype.removeEventListener = function (type, callback, options) {
      if (
        type.startsWith('webglcontext') ||
        type.startsWith('pointer') ||
        type === 'lostpointercapture'
      )
        window.viewProbe.listeners--;
      return remove.call(this, type, callback, options);
    };
  });
  await page.route(`**/assets/${id}.view-*.js`, async (route) => {
    const response = await route.fetch(),
      body = await response.text();
    const name = body.match(/export\{([\w$]+) as default\}/)?.[1];
    if (!name) throw Error('Built view has no default definition');
    await route.fulfill({
      response,
      body:
        body +
        `
      window.viewProbe.definition=${name};
      const probeMount=${name}.mount;
      ${name}.mount=async element=>{
        const handle=await probeMount(element);window.viewProbe.handle=handle;
        return {frame(frame){window.viewProbe.frame=frame;handle.frame(frame);},dispose(){handle.dispose();}};
      };`,
    });
  });
  await page.goto('/?inspect&a=test-card&b=&theme=arcade');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  expect(
    await page.evaluate(() =>
      performance.getEntriesByType('resource').some((e) => /three\.module-/.test(e.name)),
    ),
  ).toBe(false);
  // Stay in this session: a second navigation now correctly offers recovery
  // rather than silently replacing the first page's saved draft.
  const stage = page.locator('[data-region="stage-a"]');
  await stage.getByRole('button', { name: 'Views', exact: true }).click();
  const choice = stage.locator(`.shelf-popover [data-view="${id}"] .view-choice`);
  await revealView(choice);
  await choice.click();
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      window.viewProbe.frame = undefined;
    },
    await readFile(`corpus/programs/${file}.strudel`, 'utf8'),
  );
  await page.waitForFunction(() => !!window.viewProbe.frame?.notes.length);
  await expect(page.locator('[data-region="stage-a"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
}
async function at(page: Page, now: number) {
  await page.evaluate(async (now) => {
    window.odmStudio.stop();
    await window.odmStudio.seek(now);
    await window.odmStudio.play();
  }, now);
  await page.waitForFunction(
    (now) =>
      (window.viewProbe.frame?.now ?? 0) >= now && (window.viewProbe.frame?.to ?? 0) >= now + 6,
    now,
  );
  await page.evaluate(() => window.odmStudio.pause());
  await presented(page);
}

/** Local visual evidence and measurements only. CI calls the shared smoke. */
export function viewEvidence(test: typeof Test, id: string) {
  const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/${id}`;
  test(`${id}: five themes, motion, corpus and lifetime evidence`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepare(page, id);
    const intro = await page.evaluateHandle(() => ({
      ...window.viewProbe.frame!,
      now: 1.4,
      width: 1300,
      height: 760,
      dpr: 1,
    }));
    await at(page, 10.4);
    const saved = await page.evaluateHandle(() => ({
      ...window.viewProbe.frame!,
      now: 10.4,
      width: 1300,
      height: 760,
      dpr: 1,
      lookAhead: 6,
    }));
    await mkdir(shots, { recursive: true });
    await writeFile(`${shots}/frame.json`, JSON.stringify(await saved.jsonValue(), null, 2));
    // A second mount draws the real host frame at exact, reproducible times and sizes.
    const standalone = await page.evaluateHandle(async () => {
      await document.fonts.ready;
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:9999';
      document.body.append(el);
      const before = window.viewProbe.listeners;
      const handle = await window.viewProbe.definition.mount(el);
      return { el, handle, before };
    });
    await standalone.evaluate(({ handle }, frame) => handle.frame(frame), intro);
    await page.screenshot({
      path: `${shots}/intro-1300x760.png`,
      clip: { x: 0, y: 0, width: 1300, height: 760 },
    });
    for (const name of ['arcade', 'phosphor', 'pocket', 'riso', 'sunset']) {
      await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click({ force: true });
      await presented(page);
      await standalone.evaluate(
        ({ handle }, frame) =>
          handle.frame({
            ...frame,
            theme: window.viewProbe.frame!.theme,
            instruments: window.viewProbe.frame!.instruments,
          }),
        saved,
      );
      await page.screenshot({
        path: `${shots}/${name}-1300x760.png`,
        clip: { x: 0, y: 0, width: 1300, height: 760 },
      });
    }
    for (let i = 0; i < 3; i++) {
      await standalone.evaluate(
        ({ handle }, { frame, i }) =>
          handle.frame({ ...frame, now: 10.4 + (i * 0.05 * 140) / 240 }),
        { frame: await saved.jsonValue(), i },
      );
      await page.screenshot({
        path: `${shots}/motion-${String(i)}.png`,
        clip: { x: 0, y: 0, width: 1300, height: 760 },
      });
    }
    if (id === 'tunnel') {
      for (const [index, now] of [10.99, 11.05, 11.2].entries()) {
        await standalone.evaluate(({ handle }, { frame, now }) => handle.frame({ ...frame, now }), {
          frame: await saved.jsonValue(),
          now,
        });
        await page.screenshot({
          path: `${shots}/exit-${String(index)}.png`,
          clip: { x: 0, y: 0, width: 1300, height: 760 },
        });
      }
    }
    const resized = await standalone.evaluate(({ el, handle }, frame) => {
      el.style.width = '1920px';
      el.style.height = '1080px';
      handle.frame({ ...frame, width: 1920, height: 1080 });
      return el.querySelector('canvas')!.toDataURL();
    }, saved);
    await page.screenshot({ path: `${shots}/arcade-1920x1080.png` });
    // Compare renderer pixels exactly; DOM border antialiasing can vary between
    // composited layers and is unrelated to the cached band geometry.
    const fresh = await page.evaluateHandle(
      async (frame) => {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;inset:0;width:1920px;height:1080px;z-index:10000';
        document.body.append(el);
        const handle = await window.viewProbe.definition.mount(el);
        handle.frame({ ...frame, width: 1920, height: 1080 });
        return { el, handle, picture: el.querySelector('canvas')!.toDataURL() };
      },
      await saved.jsonValue(),
    );
    await page.screenshot({ path: `${shots}/fresh-1920x1080.png` });
    expect(await fresh.evaluate(({ picture }) => picture)).toBe(resized);
    await fresh.evaluate(({ el, handle }) => {
      handle.dispose();
      el.remove();
    });
    await fresh.dispose();
    await standalone.evaluate(({ el, handle }, frame) => {
      el.style.width = '1300px';
      el.style.height = '760px';
      handle.frame(frame);
    }, saved);
    const validSize = await page.screenshot({ clip: { x: 0, y: 0, width: 1300, height: 760 } });
    await standalone.evaluate(
      ({ handle }, frame) => handle.frame({ ...frame, width: 0, height: 0 }),
      saved,
    );
    expect(
      (await page.screenshot({ clip: { x: 0, y: 0, width: 1300, height: 760 } })).equals(validSize),
    ).toBe(true);
    // Simulate context loss only after visual evidence; remount is the visible recovery action.
    await standalone.evaluate(({ el }) =>
      el
        .querySelector('canvas')!
        .dispatchEvent(new Event('webglcontextlost', { cancelable: true })),
    );
    await expect(
      page.getByRole('alert').filter({ hasText: '3D drawing interrupted' }),
    ).toBeVisible();
    const lifetime = await standalone.evaluate(({ el, handle, before }) => {
      handle.dispose();
      el.remove();
      return { before, after: window.viewProbe.listeners };
    });
    expect(lifetime.after).toBe(lifetime.before);
    await standalone.dispose();
    await intro.dispose();
    await saved.dispose();
    expect(errors).toEqual([]);
    await page.screenshot({ path: `${shots}/studio-1920x1080.png` });
  });
  test(`${id}: 300-frame CPU submission measurement`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepare(page, id);
    await at(page, 10.4);
    const measured = await page.evaluate(async () => {
      const frame = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1, lookAhead: 6 };
      const el = document.createElement('div');
      document.body.append(el);
      const handle = await window.viewProbe.definition.mount(el);
      const costs: number[] = [],
        seams: { cycle: number; cost: number }[] = [];
      let cycle = 10;
      for (let i = 0; i < 310; i++) {
        await new Promise(requestAnimationFrame);
        const now = 10.4 + (i * frame.cps) / 60;
        const start = performance.now();
        handle.frame({ ...frame, now });
        const cost = performance.now() - start;
        if (i >= 10) {
          costs.push(cost);
          if (Math.floor(now) !== cycle) seams.push({ cycle: Math.floor(now), cost });
        }
        cycle = Math.floor(now);
      }
      costs.sort((a, b) => a - b);
      handle.dispose();
      el.remove();
      return {
        frames: costs.length,
        median: (costs[149] + costs[150]) / 2,
        p95: costs[285],
        max: costs[299],
        seams,
        width: 1300,
        height: 760,
        dpr: 1,
        userAgent: navigator.userAgent,
      };
    });
    await mkdir(shots, { recursive: true });
    await writeFile(`${shots}/measurements.json`, JSON.stringify(measured, null, 2));
    console.log(`${id} CPU submission:`, JSON.stringify(measured));
  });
  for (const [name, file] of [
    ['techno', 'real-techno'],
    ['dense', 'micro-dense-64'],
  ])
    test(`${id}: ${name} corpus`, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await prepare(page, id, file);
      await at(page, 0.4);
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: `${shots}/${name}-1920x1080.png` });
    });
}
