import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { scoreReady } from './helpers';
import { indexStage, stageMarks, roomRugs } from '../../src/views/soundstage/model';
import { stageLayout } from '../../src/views/soundstage/geometry';
import type { ViewFrame } from '../../src/views/types';

const positions = (frame: ViewFrame) => {
  const marks = stageMarks(frame, indexStage(frame.notes));
  const { box, spots } = stageLayout(frame, marks, (s) => s.length * 7);
  return {
    stage: { width: frame.width, height: frame.height },
    box,
    marks: spots.map((s) => ({
      name: s.mark.instruments[0].name,
      pan: s.mark.pan,
      room: s.mark.room,
      gain: s.mark.gain,
      voices: s.mark.count,
      held: s.mark.held,
      trueX: s.trueX,
      trueY: s.trueY,
      radius: s.radius,
      positions: s.mark.positions,
    })),
    rugs: roomRugs(frame, marks).map((r) => ({
      orbit: r.orbit,
      members: r.marks.map((m) => m.instruments[0].name),
      sizeRequests: r.requests.map((v) => ({ name: v.instrument.name, size: v.size })),
    })),
  };
};
test('Soundstage: bar 11, five themes, Stage B, playing, panning corpus and frame cost', async ({
  page,
}) => {
  const dir = `${process.env.ODM_VIEW_MEASURE_DIR}/soundstage`;
  await mkdir(dir, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'soundstage');
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 10.4 &&
      window.viewProbe.frame.lookAhead === 1 &&
      window.viewProbe.frame.from === 4 &&
      window.viewProbe.frame.to === 17,
  );
  await scoreReady(page);
  const saved = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${dir}/frame.json`, JSON.stringify(saved, null, 2));
  const layouts: ReturnType<typeof positions>[] = [];
  for (const [width, height] of [
    [2560, 1440],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['arcade', 'riso', 'pocket', 'phosphor', 'sunset']) {
      await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
      await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        animations: 'disabled',
        path: `${dir}/${theme}-${String(width)}x${String(height)}.png`,
      });
      if (theme === 'arcade')
        layouts.push(positions(await page.evaluate(() => window.viewProbe.frame!)));
    }
  }
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  const b = page.locator('[data-region="stage-b"]');
  const choice = page
    .locator('.wide-shelf')
    .getByRole('button', { name: 'Soundstage on Stage B', exact: true, includeHidden: true });
  await revealView(choice);
  await choice.click();
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await b.screenshot({ animations: 'disabled', path: `${dir}/stage-b.png` });
  const stageB = await b.locator('canvas').boundingBox();
  if (!stageB) throw Error('Stage B canvas is not visible');
  layouts.push(positions({ ...saved, width: stageB.width, height: stageB.height }));
  await page.evaluate(() => window.odmStudio.play());
  await page.waitForFunction(
    () => window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ animations: 'disabled', path: `${dir}/playing-2560x1440.png` });
  await page.evaluate(() => window.odmStudio.pause());
  const costs = await page.evaluate(async (saved) => {
    const el = document.createElement('div');
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    const frame = { ...saved, width: 1300, height: 760, dpr: 1 };
    const firstStart = performance.now();
    handle.frame(frame);
    const firstFrameMs = performance.now() - firstStart;
    const values: number[] = [];
    for (let i = 0; i < 310; i++) {
      await new Promise(requestAnimationFrame);
      const start = performance.now();
      handle.frame({ ...frame, now: 10.4 + (i * frame.cps) / 60 });
      if (i >= 10) values.push(performance.now() - start);
    }
    handle.frame(frame);
    const before = el.querySelector('canvas')!.toDataURL();
    handle.frame({ ...frame, now: 11.1 });
    handle.frame(frame);
    const reversible = before === el.querySelector('canvas')!.toDataURL();
    handle.dispose();
    const fresh = await window.viewProbe.definition.mount(el);
    fresh.frame(frame);
    const remount = before === el.querySelector('canvas')!.toDataURL();
    fresh.dispose();
    el.remove();
    values.sort((a, b) => a - b);
    return {
      firstFrameMs,
      frames: values.length,
      median: (values[149] + values[150]) / 2,
      p95: values[285],
      max: values[299],
      width: 1300,
      height: 760,
      dpr: 1,
      reversible,
      remount,
    };
  }, saved);
  expect(costs.reversible).toBe(true);
  expect(costs.remount).toBe(true);
  const panning: { piece: string; now: number; layout: ReturnType<typeof positions> }[] = [];
  for (const [file, times] of [
    ['micro-signal-lanes', [10.05, 10.55]],
    ['mms-jux', [10.4]],
    ['micro-orbit-delay', [10.4]],
  ] as const) {
    await page.evaluate(
      async (source) => {
        await window.odmStudio.load(source);
        window.viewProbe.frame = undefined;
      },
      await readFile(`corpus/programs/${file}.strudel`, 'utf8'),
    );
    for (const now of times) {
      await page.evaluate((t) => window.odmStudio.seek(t), now);
      await page.waitForFunction(
        (t) =>
          window.viewProbe.frame?.now === t &&
          window.viewProbe.frame.from === 4 &&
          window.viewProbe.frame.notes.some((n) =>
            window.viewProbe.frame!.instruments.some((i) => i.id === n.instrument),
          ),
        now,
      );
      await scoreReady(page);
      const frame = await page.evaluate(() => window.viewProbe.frame!);
      panning.push({ piece: file, now, layout: positions(frame) });
      await page.screenshot({ animations: 'disabled', path: `${dir}/${file}-${String(now)}.png` });
    }
  }
  await writeFile(
    `${dir}/measurements.json`,
    JSON.stringify({ costs, layouts, stageB, panning }, null, 2),
  );
  console.log('Soundstage measurements:', JSON.stringify({ costs, layouts, panning }));
});
