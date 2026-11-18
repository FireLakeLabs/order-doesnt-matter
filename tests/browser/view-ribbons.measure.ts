import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../../src/studio/main';
import type { ViewDefinition, ViewFrame } from '../../src/views/types';
import { neededRange } from '../../src/studio/frame';
import {
  cameraPose,
  gateX,
  noteHeight,
  noteTurn,
  noteWidth,
  pastReach,
  futureReach,
  ribbonParts,
  timeScale,
} from '../../src/views/ribbons/model';
import { revealView } from './shelf';
import { labelColour } from '../../src/views/ribbons/labels';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/ribbons`;
declare global {
  interface Window {
    ribbonsFrame: ViewFrame;
    ribbonsFrameB: ViewFrame;
  }
}
async function frames(page: Page, count = 3) {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
  }, count);
}
async function choose(page: Page, id: string, stage = 'a') {
  const region = page.locator(`[data-region="stage-${stage}"]`);
  const wide = await page.locator('.wide-shelf').isVisible();
  if (!wide) await region.getByRole('button', { name: 'Views', exact: true }).click();
  const shelf = wide ? page.locator('.wide-shelf') : region.locator('.shelf-popover');
  const choice = shelf.locator(
    `[data-view="${id}"] ${stage === 'a' ? '.view-choice' : '.view-to-b'}`,
  );
  await revealView(choice);
  await choice.click();
  await expect(region.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await expect(region.locator('.view-status')).toHaveText('');
  await frames(page);
}
async function prepare(page: Page) {
  await page.context().route('https://raw.githubusercontent.com/**', (route) => {
    const bank: Record<string, unknown> = {
      _base: 'https://raw.githubusercontent.com/ribbons-sounds/',
    };
    for (const s of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      bank[s] = ['burst.wav', 'burst.wav', 'burst.wav'];
    return route.fulfill({ json: bank });
  });
  await page
    .context()
    .route('**/ribbons-sounds/burst.wav', (route) =>
      route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
    );
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('/?inspect&a=ribbons&b=&theme=arcade');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await page
    .getByLabel('Strudel program')
    .fill(await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'));
  await page.getByRole('button', { name: 'Import program', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page
    .getByRole('group', { name: 'Window', exact: true })
    .getByRole('button', { name: '1', exact: true })
    .click();
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((r) => r.name.includes('/ribbons.view-'))!.name;
    const view = (await import(url)).default as ViewDefinition;
    const mount = view.mount;
    view.mount = async (element) => {
      const handle = await mount(element);
      return {
        ...handle,
        frame(frame) {
          handle.frame(frame);
          if (element.closest('[data-region="stage-a"]')) window.ribbonsFrame = frame;
          else if (element.closest('[data-region="stage-b"]')) window.ribbonsFrameB = frame;
        },
      };
    };
  });
  await choose(page, 'punchcard');
  await choose(page, 'ribbons');
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(
    ({ from, to }) =>
      window.ribbonsFrame?.now === 10.4 &&
      window.ribbonsFrame.from === from &&
      window.ribbonsFrame.to === to,
    neededRange('window', 10.4, 1, []),
  );
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
  await mkdir(shots, { recursive: true });
}
async function markSizes(page: Page, frame: ViewFrame) {
  const height = (960 * frame.height) / frame.width;
  const distance = height / (2 * Math.tan((48 * Math.PI) / 360));
  const marks = ribbonParts(frame).flatMap((part) => {
    const visible = part.notes.filter(
      (n) =>
        n.start < frame.now + futureReach * frame.lookAhead &&
        n.end > frame.now - pastReach * frame.lookAhead,
    );
    const note = visible.sort(
      (a, b) =>
        Math.abs((a.start + a.end) / 2 - frame.now) - Math.abs((b.start + b.end) / 2 - frame.now),
    )[0];
    if (!note) return [];
    const time = Math.max(note.start, Math.min(note.end, (note.start + note.end) / 2));
    const phase = (time - frame.now) / frame.lookAhead;
    const turn = noteTurn(note, part.instrument);
    const fullWidth = Math.max(1.8, (height / 673) * 1.8) + noteWidth(part, note);
    const points = [-1, 1].map((side) => {
      const y =
        noteHeight(part, note) * height +
        Math.sin(time * 0.9 + part.instrument.index * 0.83) * height * 0.008 +
        side * fullWidth * 0.5 * Math.cos(turn);
      const z =
        part.depth * height -
        Math.max(0, phase) * height * 0.55 +
        side * fullWidth * 0.5 * Math.sin(turn) +
        Math.sin(time * 0.7 + part.instrument.index) * 8 +
        0.3;
      const x = (gateX + phase * timeScale) * (1 - z / distance);
      return { x, y, z };
    });
    return [
      {
        name: part.instrument.name,
        points,
        gain: note.value.gain,
        turn,
        fullWidthWorld: fullWidth,
        time,
      },
    ];
  });
  return page.evaluate(
    async ({ frame, height, distance, marks, pose }) => {
      const url = performance
        .getEntriesByType('resource')
        .find((r) => r.name.includes('/three.module-'))!.name;
      const THREE = (await import(url)) as typeof import('three');
      const camera = new THREE.PerspectiveCamera(48, frame.width / frame.height, 0.1, 10000);
      camera.position.set(pose.x * height, pose.y * height, distance);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      return {
        width: frame.width,
        height: frame.height,
        marks: marks.map((mark) => {
          const points = mark.points.map((p) => new THREE.Vector3(p.x, p.y, p.z).project(camera));
          return {
            name: mark.name,
            gain: mark.gain,
            turn: mark.turn,
            time: mark.time,
            widthPx: Math.hypot(
              ((points[1].x - points[0].x) * frame.width) / 2,
              ((points[1].y - points[0].y) * frame.height) / 2,
            ),
          };
        }),
      };
    },
    { frame, height, distance, marks, pose: cameraPose(frame.now) },
  );
}

test('Ribbons: real-piece curtain, themes, reversible time and stage sizes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await prepare(page);
  const host = page.locator('[data-region="stage-a"] .view-host');
  const saved = await page.evaluate(() => window.ribbonsFrame);
  const atMoment = await host.locator('canvas').evaluate((c: HTMLCanvasElement) => ({
    ...c.dataset,
    backingWidth: c.width,
    backingHeight: c.height,
  }));
  await page.screenshot({ path: `${shots}/arcade-2560x1440.png` });
  const first = await host.screenshot({ path: `${shots}/route-forward.png` });
  await page.evaluate(() => window.odmStudio.seek(3));
  await frames(page);
  await page.evaluate(() => window.odmStudio.seek(10.15));
  await frames(page);
  await page.evaluate(() => window.odmStudio.step(1));
  await page.waitForFunction(
    ({ from, to }) =>
      window.ribbonsFrame.now === 10.4 &&
      window.ribbonsFrame.from === from &&
      window.ribbonsFrame.to === to,
    { from: saved.from, to: saved.to },
  );
  await frames(page);
  const second = await host.screenshot({ path: `${shots}/route-backward-step.png` });
  const differentPixels = await page.evaluate(
    async ({ a, b }) => {
      async function decode(data: number[]) {
        const image = await createImageBitmap(
          new Blob([new Uint8Array(data)], { type: 'image/png' }),
        );
        const c = document.createElement('canvas');
        c.width = image.width;
        c.height = image.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        image.close();
        return ctx.getImageData(0, 0, c.width, c.height).data;
      }
      const x = await decode(a),
        y = await decode(b);
      let count = 0;
      for (let i = 0; i < x.length; i += 4)
        if (
          x[i] !== y[i] ||
          x[i + 1] !== y[i + 1] ||
          x[i + 2] !== y[i + 2] ||
          x[i + 3] !== y[i + 3]
        )
          count++;
      return count;
    },
    { a: [...first], b: [...second] },
  );
  expect(differentPixels).toBe(0);
  const sizingA = await markSizes(page, saved);
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    await host.screenshot({ path: `${shots}/${theme}-curtain.png` });
    if (theme === 'riso' || theme === 'pocket')
      await page.screenshot({ path: `${shots}/${theme}-2560x1440.png` });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await frames(page);
  await page.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  await page.setViewportSize({ width: 2560, height: 1440 });
  await choose(page, 'ribbons', 'b');
  await page.addStyleTag({
    content: '[data-region="stage-b"] .view-host { width:560px!important }',
  });
  await page.waitForFunction(() => window.ribbonsFrameB?.width === 560);
  await frames(page);
  await page
    .locator('[data-region="stage-b"] .view-host')
    .screenshot({ path: `${shots}/stage-b-560.png` });
  const sizingB = await markSizes(page, await page.evaluate(() => window.ribbonsFrameB));
  const stageBState = await page
    .locator('[data-region="stage-b"] canvas')
    .evaluate((c: HTMLCanvasElement) => ({
      ...c.dataset,
      backingWidth: c.width,
      backingHeight: c.height,
    }));
  await page.evaluate(() => window.odmStudio.seek(7.99));
  await frames(page);
  await host.screenshot({ path: `${shots}/section-before.png` });
  await page.evaluate(() => window.odmStudio.seek(8));
  await frames(page);
  await host.screenshot({ path: `${shots}/section-start.png` });
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => window.odmStudio.app.state.playing && window.odmStudio.getPlayhead() > 10.4,
  );
  await frames(page);
  await host.screenshot({ path: `${shots}/playing.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page
    .getByRole('group', { name: 'Window', exact: true })
    .getByRole('button', { name: '2', exact: true })
    .click();
  await frames(page);
  await host.screenshot({ path: `${shots}/window-2.png` });
  const twenty: ViewFrame = {
    ...saved,
    instruments: Array.from({ length: 20 }, (_, index) => ({
      ...saved.instruments[index % saved.instruments.length],
      id: `ribbon-${index}`,
      index,
      inSection: true,
    })),
  };
  twenty.notes = twenty.instruments.flatMap((instrument, i) =>
    saved.notes
      .filter((n) => n.instrument === saved.instruments[i % saved.instruments.length].id)
      .map((n) => ({ ...n, instrument: instrument.id })),
  );
  const single = { ...saved, instruments: saved.instruments.filter((i) => i.name === 'subBass') };
  const examples: [string, ViewFrame][] = [
    ['twenty-a', twenty],
    ['twenty-b', { ...twenty, width: 560 }],
    ['single', single],
  ];
  const exampleStates: unknown[] = [];
  for (const [name, frame] of examples) {
    const surface = await page.evaluateHandle(async (frame) => {
      const url = performance
        .getEntriesByType('resource')
        .find((r) => r.name.includes('/ribbons.view-'))!.name;
      const view = (await import(url)).default as ViewDefinition;
      const element = document.createElement('div');
      element.style.cssText = `position:fixed;left:0;top:0;z-index:9999;width:${frame.width}px;height:${frame.height}px`;
      document.body.append(element);
      const handle = await view.mount(element);
      handle.frame(frame);
      return { element, handle };
    }, frame);
    await page.screenshot({
      path: `${shots}/${name}.png`,
      clip: { x: 0, y: 0, width: frame.width, height: frame.height },
    });
    exampleStates.push({
      name,
      ...(await surface.evaluate(({ element }) => {
        const canvas = element.querySelector('canvas')!;
        return { ...canvas.dataset, backingWidth: canvas.width, backingHeight: canvas.height };
      })),
    });
    await surface.evaluate(({ element, handle }) => {
      handle.dispose();
      element.remove();
    });
    await surface.dispose();
  }
  const parts = ribbonParts(saved);
  const counts = {
    threads: parts.length,
    visibleSpans: parts.reduce(
      (sum, p) =>
        sum +
        p.notes.filter(
          (n) =>
            n.start < saved.now + futureReach * saved.lookAhead &&
            n.end > saved.now - pastReach * saved.lookAhead,
        ).length,
      0,
    ),
    sounding: parts.reduce(
      (sum, p) => sum + p.notes.filter((n) => n.start <= saved.now && n.end > saved.now).length,
      0,
    ),
  };
  const geometry = await page
    .locator('[data-region="stage-a"] canvas')
    .evaluate((c) => ({ ...c.dataset }));
  expect(errors).toEqual([]);
  await writeFile(`${shots}/frame.json`, JSON.stringify(saved, null, 2));
  await writeFile(
    `${shots}/visual-measurements.json`,
    JSON.stringify(
      {
        counts,
        differentPixels,
        sizingA,
        sizingB,
        atMoment,
        stageBState,
        exampleStates,
        afterPlayback: geometry,
        errors,
      },
      null,
      2,
    ),
  );
});

test('Ribbons: CPU submission and available GPU timer comparison with Ring and Ridges', async ({
  page,
}) => {
  await prepare(page);
  const frame = await page.evaluate(() => ({
    ...window.ribbonsFrame,
    width: 1300,
    height: 760,
    dpr: 1,
    playing: false,
  }));
  const results = [];
  for (const id of ['ribbons', 'ring', 'ridges']) {
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
  console.log('Ribbons/Ring/Ridges render costs:', JSON.stringify(results));
  await writeFile(`${shots}/performance.json`, JSON.stringify(results, null, 2));
});

test('Ribbons: sweep label contrast in the Studio', async ({ page }) => {
  await prepare(page);
  const host = page.locator('[data-region="stage-a"] .view-host');
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    const frame = await page.evaluate(() => window.ribbonsFrame);
    const css = (hex: string) =>
      `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
    for (const { instrument } of ribbonParts(frame)) {
      const label = host.getByText(instrument.name, { exact: true });
      await expect(label).toHaveCSS('background-color', css(frame.theme.ground));
      await expect(label).toHaveCSS('opacity', '1');
      await expect(label).toHaveCSS('box-shadow', `${css(frame.theme.ground)} 0px 0px 0px 2px`);
      await expect(label).toHaveCSS('color', css(labelColour(instrument.colour, frame.theme)));
    }
    await page.screenshot({ path: `${shots}/sweep-${theme}-studio.png` });
    await host.screenshot({ path: `${shots}/sweep-${theme}-labels.png` });
  }
});
