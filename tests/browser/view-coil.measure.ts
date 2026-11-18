import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { prepare, viewEvidence } from './view-evidence';

viewEvidence(test, 'coil');

import { coilInteractions } from './view-coil.interactions';
coilInteractions(test);

declare global {
  interface Window {
    coilUploads: number;
  }
}

async function standalone(page: Page, long = false) {
  return page.evaluateHandle(async (long) => {
    await document.fonts.ready;
    const original = window.viewProbe.frame!;
    const frame = { ...original, playing: false, now: 10.4, width: 1300, height: 760, dpr: 1 };
    if (long) {
      frame.notes = Array.from({ length: 10 }, (_, i) =>
        original.notes.map((note) => ({
          ...note,
          start: note.start + i * 28,
          end: note.end + i * 28,
        })),
      )
        .flat()
        .filter((note) => note.start < 256);
      frame.from = 0;
      frame.to = 256;
      frame.sections = [{ name: '256-cycle study', from: 0, to: 256 }];
    }
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:9999';
    document.body.append(el);
    const before = window.viewProbe.listeners;
    const handle = await window.viewProbe.definition.mount(el);
    handle.frame(frame);
    el.querySelector('canvas')!.toDataURL();
    return { el, handle, frame, before };
  }, long);
}

test('coil: theme and resize update buffers in place, with level section brackets', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.bufferData;
    window.coilUploads = 0;
    WebGL2RenderingContext.prototype.bufferData = function (...args: unknown[]): void {
      window.coilUploads++;
      Reflect.apply(original, this, args);
    };
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'coil');
  await page.evaluate(() => window.odmStudio.pause());
  const probe = await standalone(page);
  const measured = await probe.evaluate(({ el, handle, frame }) => {
    const uploads = () => window.coilUploads;
    const before = uploads();
    const started = performance.now();
    el.style.width = '1920px';
    el.style.height = '1080px';
    handle.frame({ ...frame, width: 1920, height: 1080 });
    const resizeMs = performance.now() - started;
    const resized = uploads() - before;
    const themeStart = performance.now();
    handle.frame({
      ...frame,
      width: 1920,
      height: 1080,
      theme: { ...frame.theme, ground: '#f4f0e5', text: '#231f30', muted: '#777777', glow: false },
      instruments: frame.instruments.map((i) => ({ ...i, colour: '#3366aa' })),
    });
    const themeMs = performance.now() - themeStart;
    const themeUploads = uploads() - before - resized;
    const brackets = Array.from(
      el.querySelectorAll<HTMLElement>('.coil-section'),
      (e) => e.style.top,
    );
    return {
      resizeMs,
      themeMs,
      resizeAllocations: resized,
      themeAllocations: themeUploads,
      brackets,
    };
  });
  expect(measured.resizeAllocations).toBe(0);
  expect(measured.themeAllocations).toBe(0);
  expect(new Set(measured.brackets).size).toBe(1);
  await mkdir(`${process.env.ODM_VIEW_MEASURE_DIR}/coil`, { recursive: true });
  await writeFile(
    `${process.env.ODM_VIEW_MEASURE_DIR}/coil/restyle.json`,
    JSON.stringify(measured, null, 2),
  );
  await probe.evaluate(({ handle, el }) => {
    handle.dispose();
    el.remove();
  });
  await probe.dispose();
});

test('coil: drag orbits the coil, release holds, and disposal releases capture/listeners', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'coil');
  await page.evaluate(() => window.odmStudio.pause());
  const probe = await standalone(page);
  const picture = () => page.screenshot({ clip: { x: 0, y: 0, width: 1300, height: 760 } });
  const before = await picture();
  await page.mouse.move(650, 380);
  await page.mouse.down();
  await page.mouse.move(650, 480, { steps: 6 });
  await probe.evaluate(({ handle, frame }) => handle.frame(frame));
  const turned = await picture();
  expect(turned.equals(before)).toBe(false);
  await page.mouse.up();
  await probe.evaluate(async ({ handle, frame }) => {
    for (let i = 0; i < 70; i++) {
      handle.frame(frame);
      await new Promise(requestAnimationFrame);
    }
  });
  expect((await picture()).equals(turned)).toBe(true);
  await page.mouse.down();
  const lifetime = await probe.evaluate(({ el, handle, before }) => {
    const canvas = el.querySelector('canvas')!;
    const held = canvas.hasPointerCapture(1);
    handle.dispose();
    el.remove();
    return {
      before,
      after: window.viewProbe.listeners,
      held,
      capture: canvas.hasPointerCapture(1),
    };
  });
  await page.mouse.up();
  expect(lifetime.after).toBe(lifetime.before);
  expect(lifetime.held).toBe(true);
  expect(lifetime.capture).toBe(false);
  await probe.dispose();
});

test('coil: compressed 256-cycle overview survives a far seek and reverse seek', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'coil');
  await page.evaluate(() => window.odmStudio.pause());
  const probe = await standalone(page, true);
  await mkdir(`${process.env.ODM_VIEW_MEASURE_DIR}/coil`, { recursive: true });
  const before = await page.screenshot({
    path: `${process.env.ODM_VIEW_MEASURE_DIR}/coil/long-256.png`,
    clip: { x: 0, y: 0, width: 1300, height: 760 },
  });
  await probe.evaluate(({ handle, frame }) => {
    handle.frame({ ...frame, now: 200.4 });
    handle.frame(frame);
  });
  expect(
    (await page.screenshot({ clip: { x: 0, y: 0, width: 1300, height: 760 } })).equals(before),
  ).toBe(true);
  await probe.evaluate(({ el, handle }) => {
    handle.dispose();
    el.remove();
  });
  await probe.dispose();
});
