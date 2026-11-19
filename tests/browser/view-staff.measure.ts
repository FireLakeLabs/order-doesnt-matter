import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { ViewDefinition } from '../../src/views/types';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { measure, scoreRange, staffScore } from '../../src/views/staff/model';
const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/staff`;
test('Staff: engraving, five themes, reversibility and frame cost', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  // The shared probe assumes a default-only Rollup facade. Staff's shared model
  // makes Rollup export a namespace, so discover the definition from that module.
  await prepare(page, 'loom');
  expect(
    await page.evaluate(() =>
      performance.getEntriesByType('resource').some((r) => /\/vexflow-[^/]+\.js/.test(r.name)),
    ),
  ).toBe(false);
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((r) => /\/staff\.view-[^/]+\.js/.test(r.name))?.name;
    if (!url) throw Error('Staff module was not discovered by the shelf');
    const module: Record<string, unknown> = await import(url);
    const definition = Object.values(module)
      .flatMap((value) => {
        if (!value || typeof value !== 'object') return [];
        return [value, 'default' in value ? value.default : undefined];
      })
      .find(
        (value) => value && typeof value === 'object' && 'id' in value && value.id === 'staff',
      ) as ViewDefinition | undefined;
    if (!definition) throw Error('Staff definition is absent from its built module');
    const mount = definition.mount;
    definition.mount = async (element) => {
      const handle = await mount(element);
      window.viewProbe.handle = handle;
      return {
        frame(frame) {
          window.viewProbe.definition = definition;
          window.viewProbe.frame = frame;
          handle.frame(frame);
        },
        dispose() {
          handle.dispose();
        },
      };
    };
    window.viewProbe.frame = undefined;
  });
  const stage = page.locator('[data-region="stage-a"]');
  await stage.getByRole('button', { name: 'Views', exact: true }).click();
  const staff = stage.locator('.shelf-popover [data-view="staff"] .view-choice');
  await revealView(staff);
  await staff.click();
  await page.waitForFunction(
    () => window.viewProbe.frame?.notes.length && window.viewProbe.definition.id === 'staff',
  );
  await expect(stage.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await page
    .getByRole('group', { name: 'Window', exact: true })
    .getByRole('button', { name: '2', exact: true })
    .click();
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const score = staffScore(frame),
    range = scoreRange(frame);
  const mapping = {
    key: score.key,
    range,
    notes: score.notes.length,
    parts: score.parts.map((p) => ({
      ...p,
      notes: p.notes.length,
      bars: Array.from({ length: range.bars }, (_, i) => measure(p.notes, range.from + i, 30)),
    })),
  };
  await writeFile(`${shots}/mapping.json`, JSON.stringify(mapping, null, 2));
  // Stage B is a different view for every in-place capture.
  await page.setViewportSize({ width: 2560, height: 1440 });
  const band = page
    .locator('[data-region="view-shelf"]')
    .getByRole('button', { name: 'The band on Stage B', exact: true });
  await revealView(band);
  await band.click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${shots}/${theme}-1920x1080.png` });
    await page
      .locator('[data-region="stage-a"] canvas')
      .screenshot({ path: `${shots}/${theme}-stage-a.png` });
    const measured = await page.evaluate(async () => {
      const source = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1, now: 10.4 };
      const el = document.createElement('div');
      document.body.append(el);
      const handle = await window.viewProbe.definition.mount(el);
      // Exercise dotted values, cross-bar ties and marked thirds with the same renderer.
      const instrument = source.instruments[0];
      for (const end of [0.375, 2.375, 1 / 3])
        handle.frame({
          ...source,
          now: 0.2,
          from: 0,
          to: 4,
          lookAhead: 2,
          instruments: [instrument],
          notes: [
            {
              instrument: instrument.id,
              start: 0,
              end,
              hasOnset: true,
              value: { note: 60, gain: 0.5 },
            },
          ],
        });
      const text: string[] = [];
      const fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (value, x, y, max) {
        text.push(value);
        if (max === undefined) fill.call(this, value, x, y);
        else fill.call(this, value, x, y, max);
      };
      let twenty: string | undefined, flood: string | undefined;
      try {
        const parts = Array.from({ length: 20 }, (_, i) => ({
          ...instrument,
          id: `stress-${String(i)}`,
          name: `Part ${String(i + 1)}`,
          index: i,
        }));
        handle.frame({
          ...source,
          now: 0.2,
          from: 0,
          to: 2,
          lookAhead: 2,
          instruments: parts,
          notes: parts.map((p) => ({
            instrument: p.id,
            start: 0,
            end: 1,
            hasOnset: true,
            value: { note: 60 },
          })),
        });
        twenty = text.find((s) => s.startsWith('20 notes'));
        text.length = 0;
        handle.frame({
          ...source,
          now: 0.2,
          from: 0,
          to: 2,
          lookAhead: 2,
          instruments: [instrument],
          notes: Array.from({ length: 500 }, (_, i) => ({
            instrument: instrument.id,
            start: i / 500,
            end: (i + 1) / 500,
            hasOnset: true,
            value: { note: 60 },
          })),
        });
        flood = text.find((s) => s.startsWith('500 notes'));
      } finally {
        CanvasRenderingContext2D.prototype.fillText = fill;
      }
      handle.frame(source);
      const picture = el.querySelector('canvas')!.toDataURL();
      handle.frame({ ...source, now: 17.2, width: 560, height: 675 });
      handle.frame({ ...source, now: 9.1 });
      handle.frame(source);
      const deterministic = picture === el.querySelector('canvas')!.toDataURL();
      const costs: number[] = [];
      for (let i = 0; i < 330; i++) {
        const start = performance.now();
        handle.frame({ ...source, now: 10.4 + i / 1000 });
        if (i >= 30) costs.push(performance.now() - start);
      }
      costs.sort((a, b) => a - b);
      const luminance = (hex: string) => {
        const c = [1, 3, 5]
          .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
      };
      const a = luminance(source.theme.text),
        b = luminance(source.theme.ground);
      const result = {
        twenty,
        flood,
        width: source.width,
        height: source.height,
        dpr: source.dpr,
        frames: costs.length,
        userAgent: navigator.userAgent,
        contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        theme: source.theme.name,
        deterministic,
        median: (costs[149] + costs[150]) / 2,
        p95: costs[285],
      };
      const seams: number[] = [];
      if (source.theme.name === 'arcade')
        for (let i = 0; i < 330; i++) {
          const start = performance.now();
          handle.frame({ ...source, now: 10.4 + (i % 2) });
          if (i >= 30) seams.push(performance.now() - start);
        }
      seams.sort((a, b) => a - b);
      handle.dispose();
      el.remove();
      return {
        ...result,
        seam: seams.length
          ? { median: (seams[149] + seams[150]) / 2, p95: seams[285], frames: seams.length }
          : undefined,
      };
    });
    expect(measured.twenty).toContain('20 notes');
    expect(measured.twenty).toContain('14 counted');
    expect(measured.flood).toContain('500 counted');
    expect(measured.deterministic).toBe(true);
    expect(measured.contrast).toBeGreaterThanOrEqual(4.5);
    await writeFile(`${shots}/${theme}-measurement.json`, JSON.stringify(measured));
    console.log('Staff measurement', JSON.stringify(measured));
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.setViewportSize({ width: 2560, height: 1440 });
  const choice = page
    .locator('[data-region="view-shelf"]')
    .getByRole('button', { name: 'Staff on Stage B', exact: true });
  await revealView(choice);
  await choice.click();
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await expect(page.locator('[data-region="stage-b"] canvas')).toHaveCount(1);
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  await page.locator('[data-region="stage-b"]').screenshot({ path: `${shots}/stage-b-560.png` });
  await revealView(band);
  await band.click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  for (const file of ['real-techno', 'micro-dense-64']) {
    await page.evaluate(
      async (source) => {
        await window.odmStudio.load(source);
        await window.odmStudio.seek(1.4);
      },
      await readFile(`corpus/programs/${file}.strudel`, 'utf8'),
    );
    await page.waitForFunction(
      () => window.viewProbe.frame?.now === 1.4 && window.viewProbe.frame.notes.length > 0,
    );
    await page.screenshot({ path: `${shots}/${file}.png` });
  }
  expect(errors).toEqual([]);
});
