import { expect, type Page, type test as Test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { cycleScore } from '../../src/views/shared/cycle-score';
import { helixPoint, coilPose } from '../../src/views/coil/model';
import { prepare } from './view-evidence';

/** Real arrangement, controlled host time; interaction itself uses browser pointers. */
export function coilInteractions(test: typeof Test) {
  test('coil: persistent orbit, passage zoom, inspection, flat bar, slide, stretch and reset', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 600 });
    await prepare(page, 'coil');
    await page.evaluate(() => window.odmStudio.pause());
    const probe = await page.evaluateHandle(async () => {
      const frame = {
        ...window.viewProbe.frame!,
        playing: false,
        now: 10.4,
        width: 960,
        height: 600,
        dpr: 1,
      };
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;z-index:9999;width:960px;height:600px';
      document.body.append(el);
      let propagatedEscapes = 0;
      const escaped = (event: KeyboardEvent) => {
        if (event.key === 'Escape') propagatedEscapes++;
      };
      window.addEventListener('keydown', escaped);
      const before = window.viewProbe.listeners;
      const handle = await window.viewProbe.definition.mount(el);
      handle.frame(frame);
      const added = window.viewProbe.listeners - before;
      return {
        el,
        handle,
        frame,
        before,
        added,
        escaped: () => propagatedEscapes,
        releaseKeyboard: () => {
          window.removeEventListener('keydown', escaped);
        },
      };
    });
    const dir = process.env.ODM_VIEW_MEASURE_DIR
      ? `${process.env.ODM_VIEW_MEASURE_DIR}/coil`
      : undefined;
    if (dir) await mkdir(dir, { recursive: true });
    const shot = async (name: string) => {
      if (!dir) return;
      await page.evaluate(async () => {
        for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      });
      return page.screenshot({ path: `${dir}/${name}.png` });
    };
    const unchangedHover = (selector: string, x: number, y: number) =>
      probe.evaluate(
        ({ el, handle, frame }, { selector, x, y }) => {
          handle.frame({ ...frame, playing: true, now: frame.now + 0.000001 });
          const canvas = el.querySelector<HTMLCanvasElement>(selector)!;
          const rect = canvas.getBoundingClientRect();
          const move = (offset: number) =>
            canvas.dispatchEvent(
              new PointerEvent('pointermove', {
                clientX: rect.left + x + offset,
                clientY: rect.top + y,
                pointerId: 1,
                bubbles: true,
              }),
            );
          move(0);
          const tooltip = el.querySelector<HTMLElement>('.coil-tooltip')!;
          const text = tooltip.textContent,
            left = tooltip.style.left;
          let draws = 0;
          const gl = WebGL2RenderingContext.prototype,
            original = gl.drawElements;
          gl.drawElements = function (...args: unknown[]) {
            draws++;
            return Reflect.apply(original, this, args);
          };
          try {
            for (let i = 1; i <= 20; i++) move(i * 0.001);
          } finally {
            gl.drawElements = original;
          }
          const result = {
            draws,
            sameNote: tooltip.textContent === text,
            moved: tooltip.style.left !== left,
          };
          handle.frame(frame);
          return result;
        },
        { selector, x, y },
      );
    const picture = () => page.screenshot();
    const initial = await picture();
    await shot('00-default-960x600');
    await page.mouse.move(450, 280);
    await page.mouse.down();
    await page.mouse.move(510, 330, { steps: 6 });
    await page.mouse.up();
    const turned = await picture();
    expect(turned.equals(initial)).toBe(false);
    await probe.evaluate(({ handle, frame }) => {
      for (let i = 0; i < 70; i++) handle.frame(frame);
    });
    expect((await picture()).equals(turned)).toBe(true);
    await shot('01-orbit-released');
    await page.mouse.move(510, 330);
    await page.mouse.down();
    await page.mouse.move(420, 250, { steps: 6 });
    await page.mouse.up();
    expect((await picture()).equals(turned)).toBe(false);
    await page.mouse.dblclick(20, 20);
    expect((await picture()).equals(initial)).toBe(true);
    const frame = await probe.evaluate(({ frame }) => frame);
    const bass = frame.notes.find(
      (n) =>
        n.start >= 10 &&
        n.start < 11 &&
        frame.instruments.find((i) => i.id === n.instrument)?.name === 'wobbleBass',
    )!;
    expect(bass).toBeTruthy();
    const band = cycleScore(frame, 10).find((b) => b.id === bass.instrument)!;
    const { distance } = coilPose(frame);
    const camera = new THREE.PerspectiveCamera(45, 960 / 600, 0.02, distance * 8);
    camera.position
      .set(Math.sin(0.65) * Math.cos(0.22), Math.sin(0.22), Math.cos(0.65) * Math.cos(0.22))
      .multiplyScalar(distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const body = new THREE.Matrix4().makeRotationX(Math.PI / 2 - frame.now * Math.PI * 2);
    const p = helixPoint((bass.start + Math.min(11, bass.end)) / 2, 0, 28, band.radius);
    const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(body).project(camera);
    const x = (v.x + 1) * 480,
      y = (1 - v.y) * 300;
    await page.mouse.move(x, y);
    const beforeZoom = await picture();
    await page.mouse.wheel(0, -730);
    // Wheel is delivered asynchronously by the compositor; wait on changed pixels.
    await expect.poll(async () => (await picture()).equals(beforeZoom)).toBe(false);
    await shot('02-zoom-bar11');
    const found = await findBass(page, Math.round(x), Math.round(y));
    expect(found).toBeTruthy();
    await page.mouse.move(found!.x, found!.y);
    const tooltip = page.locator('.coil-tooltip').last();
    await expect(tooltip).toContainText('wobbleBass · E♭2');
    await expect(tooltip).toContainText('cutoff: 1370');
    expect(await unchangedHover('canvas[data-coil]', found!.x, found!.y)).toEqual({
      draws: 0,
      sameNote: true,
      moved: true,
    });
    // Real movement away and back gives the compositor fresh pointer damage.
    await page.mouse.move(20, 20);
    await page.mouse.move(found!.x, found!.y);
    await shot('03-wobbleBass-tooltip');
    await page.mouse.click(found!.x, found!.y);
    await expect(page.locator('.coil-bar').last()).toBeVisible();
    await expect(page.locator('.coil-bar button').last()).toContainText('Bar 11');
    const rows = await probe.evaluate(({ el, frame }) => {
      const canvas = el.querySelector<HTMLCanvasElement>('.coil-bar canvas')!;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const sample = document.createElement('canvas').getContext('2d')!;
      const parts = frame.instruments.filter((i) =>
        frame.notes.some((n) => n.instrument === i.id && n.start < 11 && n.end > 10),
      );
      return parts.map((part) => {
        sample.fillStyle = part.colour;
        sample.fillRect(0, 0, 1, 1);
        const colour = sample.getImageData(0, 0, 1, 1).data;
        let ink = 0;
        for (let p = 0; p < pixels.length; p += 4)
          if (pixels[p] === colour[0] && pixels[p + 1] === colour[1] && pixels[p + 2] === colour[2])
            ink++;
        return { name: part.name, ink };
      });
    });
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row.ink, `${row.name} note ink`).toBeGreaterThan(1000);
    expect(await unchangedHover('.coil-bar canvas', 170, 45)).toEqual({
      draws: 0,
      sameNote: true,
      moved: true,
    });
    await page.mouse.move(20, 20);
    await shot('04-bar11-flat');
    await page.keyboard.press('Escape');
    await expect(page.locator('.coil-bar').last()).toBeHidden();
    expect(await probe.evaluate((p) => p.escaped())).toBe(0);
    await probe.evaluate(({ handle, frame }) =>
      handle.frame({
        ...frame,
        now: 38.4,
        from: 28,
        to: 56,
        notes: frame.notes.map((n) => ({ ...n, start: n.start + 28, end: n.end + 28 })),
      }),
    );
    await page.mouse.move(20, 20);
    await page.mouse.move(found!.x, found!.y);
    await expect(tooltip).toContainText('Position 11.1');
    await page.mouse.click(found!.x, found!.y);
    await expect(page.locator('.coil-bar button').last()).toContainText('Bar 11 · drop');
    await page.keyboard.press('Escape');
    await probe.evaluate(({ handle, frame }) => handle.frame(frame));
    // Camera and spacing changes must not allocate new GPU score buffers.
    await page.evaluate(() => {
      window.coilUploads = 0;
      const gl = WebGL2RenderingContext.prototype,
        original = gl.bufferData;
      gl.bufferData = function (...args: unknown[]) {
        window.coilUploads++;
        return Reflect.apply(original, this, args);
      };
    });

    const zoomed = await picture();
    await page.keyboard.down('Shift');
    await page.mouse.move(450, 300);
    await page.mouse.down();
    await page.evaluate(() => {
      window.coilUploads = 0;
    });
    await page.mouse.move(550, 300, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    expect(await page.evaluate(() => window.coilUploads)).toBe(0);
    expect((await picture()).equals(zoomed)).toBe(false);
    await page.mouse.move(450, 300);
    await page.mouse.down({ button: 'right' });
    await page.evaluate(() => {
      window.coilUploads = 0;
    });
    await page.mouse.move(350, 300, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    expect(await page.evaluate(() => window.coilUploads)).toBe(0);
    const spacing = page.locator('input[aria-label="Turn spacing"]').last();
    await spacing.focus();
    await spacing.press('End');
    await expect(spacing).toHaveValue('3');
    expect(await page.evaluate(() => window.coilUploads)).toBe(0);
    expect((await picture()).equals(zoomed)).toBe(false);
    await shot('05-stretch-slide');
    await page.mouse.dblclick(20, 20);
    expect((await picture()).equals(initial)).toBe(true);
    await shot('06-reset');
    if (dir) {
      const measured = await probe.evaluate(async ({ handle, frame, el }) => {
        const costs: number[] = [],
          cadence: number[] = [];
        let previous = performance.now();
        for (let i = 0; i < 180; i++) {
          await new Promise(requestAnimationFrame);
          const start = performance.now();
          handle.frame({ ...frame, playing: true, now: 10.4 + (i * frame.cps) / 60 });
          if (i >= 60) {
            cadence.push(start - previous);
            costs.push(performance.now() - start);
          }
          previous = start;
        }
        costs.sort((a, b) => a - b);
        cadence.sort((a, b) => a - b);
        const canvas = el.querySelector('canvas');
        const gl = canvas instanceof HTMLCanvasElement ? canvas.getContext('webgl2') : null;
        const info = gl?.getExtension('WEBGL_debug_renderer_info');
        return {
          renderer:
            gl && info ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string) : 'unavailable',
          scale: canvas?.dataset.renderScale,
          bloom: canvas?.dataset.bloom,
          frames: costs.length,
          cpuMedian: costs[60],
          cpuP95: costs[114],
          cadenceMedian: cadence[60],
          cadenceP95: cadence[114],
          userAgent: navigator.userAgent,
        };
      });
      console.log('Coil interaction frame timing', JSON.stringify(measured));
      await writeFile(`${dir}/interaction-timing.json`, JSON.stringify(measured, null, 2));
    }
    await page.mouse.move(450, 280);
    await page.mouse.down();
    const lifetime = await probe.evaluate(({ el, handle, before, added, releaseKeyboard }) => {
      const canvas = el.querySelector('canvas')!,
        held = canvas.hasPointerCapture(1);
      releaseKeyboard();
      const beforeDispose = window.viewProbe.listeners;
      handle.dispose();
      el.remove();
      return {
        added,
        removed: beforeDispose - window.viewProbe.listeners,
        held,
        capture: canvas.hasPointerCapture(1),
        before,
        after: window.viewProbe.listeners,
      };
    });
    await page.mouse.up();
    expect(lifetime.held).toBe(true);
    expect(lifetime.capture).toBe(false);
    // Long browser interactions can install unrelated page listeners; compare the
    // view's mount/dispose deltas rather than the page's absolute listener count.
    console.log('Coil listener lifetime', JSON.stringify(lifetime));
    expect(lifetime.removed).toBe(lifetime.added);
    await probe.dispose();
  });
}
async function findBass(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-coil]')!;
      // Use the standalone canvas, which is the last Coil mount.
      const target =
        Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas[data-coil]')).at(-1) ??
        canvas;
      for (let radius = 0; radius < 180; radius += 4)
        for (let dx = -radius; dx <= radius; dx += 4)
          for (const dy of radius === 0 ? [0] : [-radius, radius]) {
            const px = x + dx,
              py = y + dy;
            if (px < 0 || px > 950 || py < 0 || py > 500) continue;
            target.dispatchEvent(
              new PointerEvent('pointermove', {
                clientX: px,
                clientY: py,
                pointerId: 1,
                bubbles: true,
              }),
            );
            const tip = Array.from(document.querySelectorAll<HTMLElement>('.coil-tooltip')).at(-1)!;
            if (
              tip.style.display !== 'none' &&
              tip.textContent?.includes('wobbleBass · E♭2') &&
              tip.textContent.includes('Position 11.1')
            )
              return { x: px, y: py };
          }
    },
    { x, y },
  );
}
