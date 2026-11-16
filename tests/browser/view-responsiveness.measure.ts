import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';

const mode = process.env.ODM_VIEW_RENDERER ?? 'swiftshader';
const hardware = mode === 'hardware';
test.use({
  launchOptions: {
    args: [
      '--autoplay-policy=no-user-gesture-required',
      ...(hardware
        ? [
            '--use-angle=vulkan',
            '--enable-features=Vulkan',
            '--use-vulkan=native',
            '--enable-gpu',
            '--disable-vulkan-surface',
            '--ignore-gpu-blocklist',
            '--disable-gpu-sandbox',
          ]
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    ],
  },
});

declare global {
  interface Window {
    renderProbe: {
      calls: number;
      triangles: number;
      uploads: number;
      rows: { cpu: number; interval: number; calls: number; triangles: number; uploads: number }[];
      lag: number[];
      active: boolean;
    };
  }
}
for (const id of ['ring', 'tunnel', 'coil'])
  test(`${id}: renderer responsiveness`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(() => {
      window.renderProbe = { calls: 0, triangles: 0, uploads: 0, rows: [], lag: [], active: false };
      const gl = WebGL2RenderingContext.prototype;
      const arrays = gl.drawArrays,
        elements = gl.drawElements,
        buffer = gl.bufferData;
      gl.drawArrays = function (mode, first, count) {
        window.renderProbe.calls++;
        if (mode === this.TRIANGLES) window.renderProbe.triangles += count / 3;
        return arrays.call(this, mode, first, count);
      };
      gl.drawElements = function (mode, count, type, offset) {
        window.renderProbe.calls++;
        if (mode === this.TRIANGLES) window.renderProbe.triangles += count / 3;
        return elements.call(this, mode, count, type, offset);
      };
      gl.bufferData = function (...args: unknown[]): void {
        window.renderProbe.uploads++;
        Reflect.apply(buffer, this, args);
      };
      let previous = performance.now();
      function tick() {
        const now = performance.now();
        if (window.renderProbe.active)
          window.renderProbe.lag.push(Math.max(0, now - previous - 16));
        previous = now;
        setTimeout(tick, 16);
      }
      setTimeout(tick, 16);
    });
    await prepare(page, id);
    const renderer = await page.evaluate(() => {
      const gl = document
        .querySelector<HTMLCanvasElement>('[data-region="stage-a"] canvas')!
        .getContext('webgl2')!;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const handle = window.viewProbe.handle!,
        original = handle.frame;
      let previous = 0;
      handle.frame = function (frame) {
        const probe = window.renderProbe;
        probe.calls = probe.triangles = probe.uploads = 0;
        const start = performance.now();
        original(frame);
        const cpu = performance.now() - start;
        if (frame.playing) {
          probe.rows.push({
            cpu,
            interval: previous ? start - previous : 0,
            calls: probe.calls,
            triangles: probe.triangles,
            uploads: probe.uploads,
          });
          previous = start;
        }
      };
      window.renderProbe.active = true;
      return {
        name: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown',
        samples: Number(gl.getParameter(gl.SAMPLES)),
        dpr: devicePixelRatio,
      };
    });
    if (hardware) expect(renderer.name).not.toMatch(/SwiftShader|llvmpipe|software/i);
    else expect(renderer.name).toMatch(/SwiftShader/i);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => window.renderProbe.rows.length >= 90);
    const stop = performance.now();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const clickMs = performance.now() - stop;
    const data = await page.evaluate(() => {
      window.renderProbe.active = false;
      const frame = window.viewProbe.frame!,
        handle = window.viewProbe.handle!;
      const gl = document
        .querySelector<HTMLCanvasElement>('[data-region="stage-a"] canvas')!
        .getContext('webgl2')!;
      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const completed: number[] = [];
      for (let i = 0; i < 12; i++) {
        const start = performance.now();
        handle.frame({ ...frame, now: frame.now + i * 0.001, playing: false });
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        if (i > 1) completed.push(performance.now() - start);
      }
      return {
        ...window.renderProbe,
        completed,
        frame: {
          width: frame.width,
          height: frame.height,
          dpr: frame.dpr,
          notes: frame.notes.length,
        },
        quality: {
          ...document.querySelector<HTMLElement>('[data-region="stage-a"] canvas')!.dataset,
        },
      };
    });
    const summary = (values: number[]) => {
      values.sort((a, b) => a - b);
      return {
        median: values[Math.floor(values.length / 2)],
        p95: values[Math.floor(values.length * 0.95)],
        max: values.at(-1),
      };
    };
    const rows = data.rows.slice(5);
    const result = {
      id,
      mode,
      renderer,
      clickMs,
      frame: data.frame,
      quality: data.quality,
      cpu: summary(rows.map((r) => r.cpu)),
      interval: summary(rows.map((r) => r.interval)),
      completed: summary(data.completed),
      settledInterval: summary(rows.slice(-20).map((r) => r.interval)),
      settledCalls: summary(rows.slice(-20).map((r) => r.calls)),
      lag: summary(data.lag),
      drawCalls: summary(rows.map((r) => r.calls)),
      triangles: summary(rows.map((r) => r.triangles)),
      uploadFrames: rows.filter((r) => r.uploads > 0).length,
      rows: rows.length,
    };
    const dir = `${process.env.ODM_VIEW_MEASURE_DIR}/responsiveness`;
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/${id}-${mode}.png` });
    const remounted = await page.evaluate(async () => {
      const el = document.createElement('div');
      const frame = { ...window.viewProbe.frame!, playing: false };
      el.style.cssText = `position:fixed;inset:0;width:${frame.width}px;height:${frame.height}px`;
      document.body.append(el);
      const handle = await window.viewProbe.definition.mount(el);
      handle.frame(frame);
      const learned = { ...el.querySelector('canvas')!.dataset };
      handle.dispose();
      el.remove();
      return learned;
    });
    expect(remounted.renderScale).toBe(data.quality.renderScale);
    expect(remounted.bloom).toBe(data.quality.bloom);
    await writeFile(`${dir}/${id}-${mode}.json`, JSON.stringify({ ...result, remounted }, null, 2));
    console.log(JSON.stringify(result));
  });
