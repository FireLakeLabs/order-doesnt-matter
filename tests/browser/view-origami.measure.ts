import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/origami`;
const themes = ['arcade', 'riso', 'pocket', 'sunset', 'phosphor'];
test('Origami: real snapshots, themes, pull tab, exact reversibility and CPU submission', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'origami');
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  const a = page.locator('[data-region="stage-a"]'),
    b = page.locator('[data-region="stage-b"]');
  const ready = async () => {
    await expect(a.locator('canvas')).toHaveAttribute('data-computing', '0');
    await page.evaluate(() => document.fonts.ready);
  };
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await ready();
  await expect(a.getByLabel('Origami focused part')).toHaveValue(
    await page.evaluate(
      () => window.viewProbe.frame!.instruments.find((i) => i.name === 'wobbleBass')!.id,
    ),
  );
  await b.getByRole('button', { name: 'Views', exact: true }).click();
  const quilt = b.getByRole('button', { name: 'Quilt on Stage B', exact: true });
  await revealView(quilt);
  await quilt.click();
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await expect(b.locator('canvas')).toHaveCount(1);
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  for (const theme of themes) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await ready();
    await page.screenshot({ path: `${shots}/${theme}-1920x1080.png` });
    await a.locator('canvas').screenshot({ path: `${shots}/${theme}-stage-a.png` });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.waitForFunction(() => window.viewProbe.frame?.theme.name === 'arcade');
  await ready();
  const mapping = await page.evaluate(async () => {
    const frame = window.viewProbe.frame!,
      id = frame.instruments.find((i) => i.name === 'wobbleBass')!.id,
      s = frame.structure!.get(id)!;
    return {
      range: [frame.from, frame.to],
      steps: await Promise.all(
        s.steps.map(async (step, index) => ({
          index,
          kind: step.kind,
          name: 'name' in step ? step.name : 'phrase',
          answer: await s.snapshot(index),
        })),
      ),
      context: s.context,
      driver: await Promise.all(
        s.steps.flatMap((step) =>
          step.kind === 'setting' && step.driver.kind === 'signal'
            ? step.driver.rates.map(async (rate) => ({
                name: rate.name,
                args: rate.args,
                time: rate.time,
                answer: await rate.events(),
              }))
            : [],
        ),
      ),
    };
  });
  await writeFile(`${shots}/mapping.json`, JSON.stringify(mapping, null, 2));
  // Profile a second mount with real host frames, including their lazy structure handles.
  const measured = await page.evaluate(async (themes) => {
    const source = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1, now: 10.4 };
    const el = document.createElement('div');
    document.body.append(el);
    const before = window.viewProbe.listeners,
      handle = await window.viewProbe.definition.mount(el),
      canvas = el.querySelector('canvas')!;
    async function settle(frame: typeof source) {
      do {
        handle.frame(frame);
        await new Promise(requestAnimationFrame);
      } while (canvas.dataset.computing !== '0');
      handle.frame(frame);
    }
    handle.frame(source);
    const pendingOnFirstFrame = canvas.dataset.computing !== '0';
    await settle(source);
    const texts: { text: string; size: string; ink: string }[] = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
      texts.push({ text, size: this.font, ink: String(this.fillStyle) });
      if (max === undefined) fill.call(this, text, x, y);
      else fill.call(this, text, x, y, max);
    };
    handle.frame(source);
    CanvasRenderingContext2D.prototype.fillText = fill;
    const costs: number[] = [];
    for (let i = 0; i < 330; i++) {
      const start = performance.now();
      handle.frame({ ...source, now: 10.4 + i / 1000 });
      if (i >= 30) costs.push(performance.now() - start);
    }
    costs.sort((a, b) => a - b);
    const deterministic: Record<string, boolean> = {},
      contrast: Record<string, number> = {};
    function luminance(hex: string) {
      const rgb = hex
        .replace('#', '')
        .match(/../g)!
        .map((v) => parseInt(v, 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    }
    // Capture each theme from the actual Studio adapter, not a second token table.
    for (const theme of themes) {
      (document.querySelector(`[aria-label="Theme ${theme}"]`) as HTMLButtonElement).click();
      while (window.viewProbe.frame?.theme.name !== theme) await new Promise(requestAnimationFrame);
      const frame = {
        ...source,
        theme: window.viewProbe.frame.theme,
        instruments: window.viewProbe.frame.instruments,
      };
      await settle(frame);
      const picture = canvas.toDataURL();
      await settle({ ...frame, now: 22, width: 560 });
      await settle({ ...frame, now: 2.4 });
      await settle(frame);
      deterministic[theme] = picture === canvas.toDataURL();
      const fresh = document.createElement('div');
      document.body.append(fresh);
      const other = await window.viewProbe.definition.mount(fresh);
      do {
        other.frame(frame);
        await new Promise(requestAnimationFrame);
      } while (fresh.querySelector('canvas')!.dataset.computing !== '0');
      other.frame(frame);
      deterministic[theme] &&= picture === fresh.querySelector('canvas')!.toDataURL();
      other.dispose();
      fresh.remove();
      const ink = luminance(frame.theme.text);
      // All labels use text ink; paper fibres are 14% muted ink over panel.
      const blend = (a: string, b: string, t: number) =>
        '#' +
        [0, 2, 4]
          .map((i) =>
            Math.round(
              parseInt(a.slice(1 + i, 3 + i), 16) * (1 - t) +
                parseInt(b.slice(1 + i, 3 + i), 16) * t,
            )
              .toString(16)
              .padStart(2, '0'),
          )
          .join('');
      contrast[theme] = Math.min(
        ...[
          frame.theme.panel,
          frame.theme.ground,
          blend(frame.theme.panel, frame.theme.muted, 0.14),
        ].map((c) => {
          const bg = luminance(c);
          return (Math.max(ink, bg) + 0.05) / (Math.min(ink, bg) + 0.05);
        }),
      );
    }
    handle.dispose();
    el.remove();
    return {
      width: 1300,
      height: 760,
      frames: costs.length,
      median: costs[149],
      p95: costs[285],
      max: costs[299],
      deterministic,
      contrast,
      texts,
      pendingOnFirstFrame,
      listenerDelta: window.viewProbe.listeners - before,
      userAgent: navigator.userAgent,
    };
  }, themes);
  expect(Object.values(measured.deterministic).every(Boolean)).toBe(true);
  expect(Math.min(...Object.values(measured.contrast))).toBeGreaterThan(4.5);
  expect(measured.listenerDelta).toBe(0);
  expect(measured.pendingOnFirstFrame).toBe(true);
  await writeFile(`${shots}/measurements.json`, JSON.stringify(measured, null, 2));
  console.log('Origami measured', JSON.stringify(measured));
  // Pointer capture moves the view-only pull tab; double-click restores full opening and automatic focus.
  const box = (await a.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width - 130, box.y + box.height - 24);
  await page.mouse.down();
  await page.mouse.move(box.x + 110, box.y + box.height - 24, { steps: 5 });
  await page.mouse.up();
  await expect(a.locator('canvas')).toHaveAttribute('data-stages', '1');
  await ready();
  await page.screenshot({ path: `${shots}/fully-folded.png` });
  await a.locator('canvas').dblclick({ position: { x: 40, y: 40 } });
  await ready();
  await expect(a.locator('canvas')).toHaveAttribute('data-stages', '8');
  // Canvas part-name click switches focus without changing the score/document.
  await a.locator('canvas').click({ position: { x: 45, y: box.height - 60 } });
  await expect(a.getByLabel('Origami focused part')).not.toHaveValue(
    await page.evaluate(
      () => window.viewProbe.frame!.instruments.find((i) => i.name === 'wobbleBass')!.id,
    ),
  );
  await a.locator('canvas').dblclick({ position: { x: 40, y: 40 } });
  await ready();
  await page.setViewportSize({ width: 2560, height: 1440 });
  const choice = page
    .locator('.wide-shelf')
    .getByRole('button', { name: 'Origami on Stage B', exact: true });
  await revealView(choice);
  await choice.click();
  await expect(b.locator('canvas')).toHaveAttribute('data-computing', '0');
  await b.screenshot({ path: `${shots}/stage-b-560.png` });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  for (const file of ['real-techno', 'micro-callback-deep', 'micro-dense-64']) {
    await page.evaluate(
      async (source) => {
        await window.odmStudio.load(source);
        await window.odmStudio.seek(1.4);
      },
      await readFile(`corpus/programs/${file}.strudel`, 'utf8'),
    );
    await page.waitForFunction((file) => {
      const frame = window.viewProbe.frame;
      const title =
        document.querySelector<HTMLCanvasElement>('[data-region="stage-a"] canvas')?.title ?? '';
      return (
        frame?.now === 1.4 &&
        frame.instruments.length === (file === 'real-techno' ? 4 : 1) &&
        title.includes(
          file === 'micro-callback-deep'
            ? 'Callback'
            : file === 'micro-dense-64'
              ? 'fast'
              : 'resonance',
        )
      );
    }, file);
    await expect(a.locator('canvas')).toHaveAttribute('data-computing', '0');
    await page.screenshot({ path: `${shots}/${file}.png` });
    const evidence = await page.evaluate(async () => {
      const frame = window.viewProbe.frame!;
      const id = document.querySelector<HTMLCanvasElement>('[data-region="stage-a"] canvas')!
        .dataset.focus!;
      const structure = frame.structure!.get(id)!;
      return {
        instruments: frame.instruments.length,
        steps: await Promise.all(
          structure.steps.map(async (step, index) => {
            const answer = await structure.snapshot(index);
            return {
              index,
              name: 'name' in step ? step.name : 'phrase',
              status: answer.status,
              reason:
                answer.status === 'unavailable' ? answer.reason : answer.result.error?.message,
              onsets:
                answer.status === 'available'
                  ? answer.result.events.filter(
                      (e) => e.hasOnset && e.whole && e.whole[0] >= 0 && e.whole[0] < 4,
                    ).length
                  : null,
            };
          }),
        ),
      };
    });
    await writeFile(`${shots}/${file}-mapping.json`, JSON.stringify(evidence, null, 2));

    if (file === 'micro-callback-deep')
      await expect(a.locator('canvas')).toHaveAttribute(
        'title',
        /Callback snapshots are not yet supported/,
      );
  }
});
