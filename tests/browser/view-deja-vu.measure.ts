import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { analyse, comparison, layout, strip } from '../../src/views/deja-vu/model';
import type { ViewFrame } from '../../src/views/types';

// Local evidence only; the shared smoke is the browser gate.
test('deja-vu: two real comparisons, five themes, crowd and CPU frame cost', async ({ page }) => {
  const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/deja-vu`;
  await mkdir(shots, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'deja-vu');
  const originalClock = await page.evaluateHandle(() => window.odmStudio.getPlayhead);
  await page.evaluate(() => {
    window.odmStudio.getPlayhead = () => 10.4;
    history.replaceState(null, '', '/?inspect&a=deja-vu&b=');
  });
  await page.waitForFunction(
    () => window.viewProbe.frame?.now === 10.4 && window.viewProbe.frame.to >= 28,
  );
  const presented = () =>
    page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
  const costs: Record<string, unknown> = {};
  await page.setViewportSize({ width: 2560, height: 1440 });
  for (const theme of ['arcade', 'riso', 'pocket', 'sunset', 'phosphor']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await presented();
    await page.screenshot({ path: `${shots}/${theme}-2560x1440.png` });
    costs[theme] = await page.evaluate(async () => {
      const frame = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1 };
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:9999';
      document.body.append(el);
      const handle = await window.viewProbe.definition.mount(el),
        samples: number[] = [];
      for (let i = 0; i < 310; i++) {
        await new Promise(requestAnimationFrame);
        const start = performance.now();
        handle.frame({ ...frame, now: 10.4 + (i * frame.cps) / 60 });
        if (i >= 10) samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      handle.dispose();
      el.remove();
      return {
        frames: 300,
        medianMs: (samples[149] + samples[150]) / 2,
        p95Ms: samples[285],
        maxMs: samples[299],
        width: 1300,
        height: 760,
        dpr: 1,
      };
    });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.getByRole('button', { name: 'Déjà vu on Stage B', exact: true }).click();
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await presented();
  await page.screenshot({ path: `${shots}/studio-stage-b-2560x1440.png` });
  await page
    .locator('[data-region="stage-b"] canvas')
    .screenshot({ path: `${shots}/stage-b-in-host.png` });
  await page.getByRole('button', { name: 'Clear Stage B', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await presented();
  await page.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  const saved = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${shots}/frame.json`, JSON.stringify(saved, null, 2));
  const score = analyse(saved.notes);
  const moments = [10.4, 8.4].map((now) => {
    const view = comparison({ ...saved, now }, score);
    return {
      now,
      bar: view.bar + 1,
      change: view.change,
      counts: view.counts,
      rows: view.rows
        .filter((r) => r.entries.length)
        .map((r) => ({
          name: r.instrument.name,
          counts: r.entries.reduce(
            (a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + 1 }),
            {} as Record<string, number>,
          ),
        })),
    };
  });
  const sizes = [
    { label: 'Stage A', width: 1300, height: 760 },
    { label: '1920 host', width: saved.width, height: saved.height },
    { label: 'Stage B', width: 560, height: 760 },
  ].map((size) => {
    const g = layout(size, 6);
    const titleBottom = Math.max(29, 32 * g.scale) + Math.max(24, 24 * g.scale) / 2;
    const sectionBottom = g.stripTop + g.stripHeight + 16 + g.font / 2;
    return {
      ...size,
      ...g,
      mockupNoteHeight: 28,
      requiredNoteHeight: (28 * size.width) / 960,
      pitchChangedNoteHeight: g.noteHeight * 0.75,
      mockupPitchNoteHeight: 20,
      requiredPitchNoteHeight: (20 * size.width) / 960,
      maximumEmptyBand: Math.max(
        g.stripTop - titleBottom,
        g.top + g.rowHeight / 2 - g.noteHeight / 2 - sectionBottom,
        g.rowHeight - g.noteHeight,
        size.height - g.bottom,
      ),
    };
  });
  await page.evaluate(() => {
    window.odmStudio.getPlayhead = () => 8.4;
  });
  await presented();
  await page.screenshot({ path: `${shots}/section-start-1920x1080.png` });
  await page.evaluate(() => {
    window.odmStudio.getPlayhead = () => 10.4;
  });
  await presented();
  const standalone = await page.evaluateHandle(async (frame) => {
    const el = document.createElement('div');
    el.id = 'deja-vu-evidence';
    el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:9999';
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    handle.frame({ ...frame, width: 1300, height: 760, dpr: 1 });
    return { el, handle };
  }, saved);
  await page
    .locator('#deja-vu-evidence canvas')
    .screenshot({ path: `${shots}/arcade-1300x760.png` });
  await standalone.evaluate(({ el, handle }, saved) => {
    el.style.width = '560px';
    handle.frame({ ...saved, width: 560, height: 760, dpr: 1 });
  }, saved);
  await page
    .locator('#deja-vu-evidence canvas')
    .screenshot({ path: `${shots}/stage-b-560x760.png` });
  for (const [name, count, density, width] of [
    ['single', 1, 1, 1300],
    ['twenty', 20, 8, 1300],
    ['dense-500', 1, 500, 1300],
    ['twenty-stage-b', 20, 40, 560],
  ] as const) {
    await standalone.evaluate(
      ({ el, handle }, { saved, count, density, width }) => {
        const frame: ViewFrame = {
          ...saved,
          width,
          height: 760,
          dpr: 1,
          now: 10.4,
          instruments: Array.from({ length: count }, (_, i) => ({
            ...saved.instruments[i % saved.instruments.length],
            id: String(i),
            index: i,
            name: `part ${i + 1}`,
          })),
          notes: Array.from({ length: count }, (_, i) =>
            Array.from({ length: 2 * density }, (_, j) => ({
              instrument: String(i),
              start: 9 + j / density,
              end: 9 + (j + 1) / density,
              hasOnset: true,
              value: { note: j < density ? 48 : 51, gain: 0.5 },
            })),
          ).flat(),
        };
        el.style.width = `${width}px`;
        handle.frame(frame);
      },
      { saved, count, density, width },
    );
    await page.locator('#deja-vu-evidence canvas').screenshot({ path: `${shots}/${name}.png` });
  }
  await standalone.evaluate(({ el, handle }, saved) => {
    el.style.width = '1300px';
    handle.frame({
      ...saved,
      width: 1300,
      height: 760,
      dpr: 1,
      from: 10,
      to: 12,
      notes: saved.notes.filter((n) => n.end > 10 && n.start < 12),
    });
  }, saved);
  await page.locator('#deja-vu-evidence canvas').screenshot({ path: `${shots}/unasked.png` });
  const deterministic = await standalone.evaluate(({ el, handle }, saved) => {
    const f = { ...saved, width: 1300, height: 760, dpr: 1 };
    handle.frame(f);
    const picture = el.querySelector('canvas')!.toDataURL();
    handle.frame({ ...f, now: 8.4 });
    handle.frame({ ...f, now: 17.4 });
    handle.frame(f);
    return picture === el.querySelector('canvas')!.toDataURL();
  }, saved);
  expect(deterministic).toBe(true);
  await standalone.evaluate(({ el, handle }) => {
    handle.dispose();
    el.remove();
  });
  await originalClock.evaluate((clock) => {
    window.odmStudio.getPlayhead = clock;
  });
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.4);
    await window.odmStudio.play();
  });
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  await page.evaluate(() => window.odmStudio.pause());
  expect(errors).toEqual([]);
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify(
      { costs, moments, sizes, strip: strip(saved, score), deterministic, errors },
      null,
      2,
    ),
  );
  console.log('Déjà vu measurements:', JSON.stringify({ costs, moments, sizes }));
});
