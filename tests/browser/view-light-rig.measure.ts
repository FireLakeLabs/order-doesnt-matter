import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { ViewDefinition, ViewFrame } from '../../src/views/types';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { indexRig, rigSlots, slotAt } from '../../src/views/light-rig/model';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/light-rig`;
async function frames(page: Page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
}
async function choose(page: Page, id: string, stage = 'a') {
  const wide = await page.locator('.wide-shelf').isVisible();
  const region = page.locator('[data-region="stage-a"]');
  if (!wide) await region.getByRole('button', { name: 'Views', exact: true }).click();
  const shelf = wide ? page.locator('.wide-shelf') : region.locator('.shelf-popover');
  const choice = shelf.locator(
    `[data-view="${id}"] ${stage === 'a' ? '.view-choice' : '.view-to-b'}`,
  );
  await revealView(choice);
  await choice.click();
  await page.waitForFunction(
    (stage) =>
      document
        .querySelector(`[data-region="stage-${stage}"] .view-host`)
        ?.getAttribute('data-score-ready') === 'true' &&
      document.querySelector(`[data-region="stage-${stage}"] .view-status`)?.textContent === '',
    stage,
    { timeout: 0 },
  );
  await frames(page);
}
async function setup(page: Page) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'light-rig');
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
  await mkdir(shots, { recursive: true });
}

test('Light rig: Studio themes, exact reverse/resize, narrow stage, and playing evidence', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await setup(page);
  await choose(page, 'band', 'b');
  const saved = await page.evaluate(() => window.viewProbe.frame!);
  const score = indexRig(saved),
    slots = rigSlots(saved, score);
  const counts = slots.map((s) => ({
    role: s.role,
    members: s.members.map((i) => i.name),
    ...slotAt(s, score, saved),
  }));
  await writeFile(`${shots}/frame.json`, JSON.stringify(saved, null, 2));
  const reversible = [];
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    await page.screenshot({ path: `${shots}/${theme}-1920x1080.png` });
    const result = await page.evaluate(async () => {
      const frame = {
        ...window.viewProbe.frame!,
        width: 1300,
        height: 760,
        dpr: 1,
        playing: false,
      };
      const el = document.createElement('div');
      document.body.append(el);
      const handle = await window.viewProbe.definition.mount(el);
      const render = (f: ViewFrame) => {
        handle.frame(f);
        return el.querySelector('canvas')!.toDataURL();
      };
      render(frame); // compile before the reference capture
      const a = render(frame);
      render({ ...frame, now: 3, width: 560, height: 620 });
      render({ ...frame, now: 18.3 });
      const b = render(frame);
      const data = {
        theme: frame.theme.name,
        exactPixels: a === b,
        scale: el.querySelector('canvas')!.dataset.renderScale,
      };
      handle.dispose();
      el.remove();
      return data;
    });
    expect(result.exactPixels).toBe(true);
    reversible.push(result);
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.evaluate(() => window.odmStudio.seek(10));
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10);
  await frames(page);
  await page.screenshot({ path: `${shots}/onset-strobe.png` });
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => window.odmStudio.app.state.playing && window.odmStudio.getPlayhead() > 10.4,
  );
  await frames(page);
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.setViewportSize({ width: 2560, height: 1440 });
  await choose(page, 'light-rig', 'b');
  await choose(page, 'band', 'a');
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(
    () => window.viewProbe.frame?.now === 10.4 && window.viewProbe.frame.width < 700,
  );
  await frames(page);
  await page.locator('[data-region="stage-b"]').screenshot({ path: `${shots}/stage-b-560.png` });
  expect(
    await page.locator('[data-region="stage-b"] .view-host').evaluate((e) => e.clientWidth),
  ).toBeGreaterThan(500);
  expect(errors).toEqual([]);
  await writeFile(`${shots}/mapping.json`, JSON.stringify({ counts, reversible, errors }, null, 2));
});

test('Light rig: contrasting real ambient and twenty counted assignments', async ({ page }) => {
  await setup(page);
  await choose(page, 'band', 'b');
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(1.4);
    },
    await readFile('corpus/programs/real-ambient.strudel', 'utf8'),
  );
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 1.4 &&
      window.viewProbe.frame.notes.length > 0 &&
      window.viewProbe.frame.sections.length === 0,
  );
  await frames(page);
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    await page.screenshot({ path: `${shots}/real-ambient-${theme}-1920x1080.png` });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.waitForFunction(() => window.viewProbe.frame?.theme.name === 'arcade');
  const result = await page.evaluateHandle(async () => {
    const frame = {
      ...window.viewProbe.frame!,
      width: 560,
      height: 630,
      dpr: 1,
      now: 1.4,
      sections: [],
    };
    const originals = frame.instruments;
    frame.instruments = Array.from({ length: 20 }, (_, index) => ({
      ...originals[index % originals.length],
      id: String(index),
      name: `Part ${index + 1}`,
      index,
      inSection: true,
    }));
    frame.notes = frame.instruments.flatMap((i) => [
      {
        instrument: i.id,
        start: 1,
        end: 2,
        hasOnset: true,
        value: { note: 36 + i.index, gain: 0.6 },
      },
    ]);
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;width:560px;height:630px';
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    handle.frame(frame);
    const data = { ...el.querySelector('canvas')!.dataset };
    return { el, handle, data, frame };
  });
  // Use a handle for the DOM surface; keep screenshot evidence outside the repository.
  const data = await result.evaluate(({ data }) => data);
  expect(data.assignments).toBe('20');
  expect(data.active).toBe('20');
  await page.screenshot({
    path: `${shots}/twenty-stage-b.png`,
    clip: { x: 0, y: 0, width: 560, height: 630 },
  });
  const dense = await result.evaluate(({ el, handle, frame }) => {
    const instrument = { ...frame.instruments[0], settings: [] };
    const input = {
      ...frame,
      now: 0.339,
      cps: 1,
      instruments: [instrument],
      notes: Array.from({ length: 500 }, (_, i) => ({
        instrument: instrument.id,
        start: i / 500,
        end: i / 500 + 0.1,
        hasOnset: true,
        value: { gain: 1 },
      })),
    };
    handle.frame(input);
    return { label: el.textContent, data: { ...el.querySelector('canvas')!.dataset } };
  });
  expect(dense.label).toContain('10 merged');
  await page.screenshot({
    path: `${shots}/dense-strobe-counted.png`,
    clip: { x: 0, y: 0, width: 560, height: 630 },
  });
  await result.evaluate(({ el, handle }) => {
    handle.dispose();
    el.remove();
  });
  await result.dispose();
});

test('Light rig: CPU submission and available GPU timer comparison with Ribbons and Ring', async ({
  page,
}) => {
  await setup(page);
  const frame = await page.evaluate(() => ({
    ...window.viewProbe.frame!,
    width: 1300,
    height: 760,
    dpr: 1,
    playing: false,
  }));
  const results = [];
  for (const id of ['light-rig', 'ribbons', 'ring']) {
    await choose(page, id);
    const url = await page.evaluate(
      (id) =>
        performance.getEntriesByType('resource').find((r) => r.name.includes(`/${id}.view-`))!.name,
      id,
    );
    await choose(page, 'punchcard');
    const measured = await page.evaluate(
      async ({ url, frame, id }) => {
        const view = (await import(url)).default as ViewDefinition;
        const element = document.createElement('div');
        element.style.cssText = 'position:fixed;inset:0;z-index:9999;width:1300px;height:760px';
        document.body.append(element);
        const handle = await view.mount(element);
        const coldStart = performance.now();
        handle.frame(frame);
        const coldFrameMs = performance.now() - coldStart;
        const canvas = element.querySelector('canvas')!;
        const gl = canvas.getContext('webgl2')!;
        const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
          TIME_ELAPSED_EXT: number;
          GPU_DISJOINT_EXT: number;
        } | null;
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        const cpu: number[] = [],
          completed: number[] = [],
          gpu: number[] = [],
          scales = new Set<string>();
        const pending: WebGLQuery[] = [];
        let disjoint = 0;
        const poll = () => {
          for (let i = pending.length - 1; i >= 0; i--) {
            const q = pending[i];
            if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
            if (timer && !gl.getParameter(timer.GPU_DISJOINT_EXT))
              gpu.push(Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6);
            else disjoint++;
            gl.deleteQuery(q);
            pending.splice(i, 1);
          }
        };
        for (let i = 0; i < 44; i++) {
          await new Promise(requestAnimationFrame);
          poll();
          const query = timer && i >= 8 ? gl.createQuery() : null;
          if (query && timer) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
          const start = performance.now();
          handle.frame({ ...frame, now: 10.4 + (i * frame.cps) / 24 });
          const cost = performance.now() - start;
          if (query && timer) {
            gl.endQuery(timer.TIME_ELAPSED_EXT);
            pending.push(query);
          }
          // Completion wall time is useful on software renderers without GPU
          // timer queries, but includes CPU/IPC and is not GPU execution time.
          gl.finish();
          const completion = performance.now() - start;
          if (i >= 8) {
            cpu.push(cost);
            completed.push(completion);
            scales.add(`${canvas.dataset.renderScale}/${canvas.dataset.bloom}`);
          }
        }
        for (let i = 0; i < 20 && pending.length; i++) {
          await new Promise(requestAnimationFrame);
          poll();
        }
        for (const q of pending) gl.deleteQuery(q);
        const summary = (values: number[]) => {
          values.sort((a, b) => a - b);
          return {
            samples: values.length,
            medianMs: values[Math.floor(values.length / 2)] ?? null,
            p95Ms: values[Math.floor(values.length * 0.95)] ?? null,
            maxMs: values.at(-1) ?? null,
          };
        };
        const result = {
          id,
          coldFrameMs,
          cpu: summary(cpu),
          submitToFinishWall: summary(completed),
          gpu: summary(gpu),
          timerSupported: !!timer,
          unresolvedQueries: pending.length,
          disjoint,
          scaleAndBloom: [...scales],
          width: frame.width,
          height: frame.height,
          dpr: frame.dpr,
          backingWidth: canvas.width,
          backingHeight: canvas.height,
          renderer: debug
            ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
            : String(gl.getParameter(gl.RENDERER)),
        };
        handle.dispose();
        element.remove();
        return result;
      },
      { url, frame, id },
    );
    results.push(measured);
  }
  console.log('Light rig/Ribbons/Ring render costs:', JSON.stringify(results));
  await writeFile(`${shots}/performance.json`, JSON.stringify(results, null, 2));
});
