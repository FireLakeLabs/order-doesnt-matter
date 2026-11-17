import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { analyse, scene } from '../../src/views/ash-run/model';

// Local visual evidence and measurements; CI uses only viewSmoke.
test('ash-run: exact-time rooftops, themes, chasm and frame cost', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/ash-run`;
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'ash-run');
  await page
    .getByRole('group', { name: 'Window', exact: true })
    .getByRole('button', { name: '1', exact: true })
    .click();
  await page.waitForFunction(() => window.viewProbe.frame?.lookAhead === 1);
  await page.setViewportSize({ width: 2560, height: 1440 });
  const settled = async (now: number) => {
    await expect(page.locator('[data-region="stage-a"] .view-host')).toHaveAttribute(
      'data-score-ready',
      'true',
    );
    await page.waitForFunction((now) => {
      const f = window.viewProbe.frame;
      return (
        f?.now === now &&
        f.notes.some((n) => n.start > now) &&
        f.notes.some((n) => n.start <= now && now < n.end)
      );
    }, now);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
  };
  const at = async (now: number) => {
    await page.evaluate(async (now) => {
      await window.odmStudio.seek(now);
    }, now);
    await settled(now);
  };
  await at(10.4);
  await page.screenshot({ path: `${shots}/arcade-2560x1440.png` });
  const saved = await page.evaluate(() => ({
    ...window.viewProbe.frame!,
    width: 1300,
    height: 760,
    dpr: 1,
  }));
  await writeFile(`${shots}/frame.json`, JSON.stringify(saved, null, 2));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await at(10.4);
  await page.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  for (const name of ['riso', 'pocket', 'sunset', 'phosphor', 'arcade']) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, name);
    await at(10.4);
    await page.screenshot({ path: `${shots}/${name}-1920x1080.png` });
  }
  await at(18.4);
  await page.screenshot({ path: `${shots}/chasm-18.4.png` });
  const chasmFrame = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${shots}/chasm-frame.json`, JSON.stringify(chasmFrame, null, 2));
  expect(scene(chasmFrame, analyse(chasmFrame.notes)).chasm).toBe(true);
  await at(10.4);
  // Reach the same now by a forward scrub and by a backward quarter-cycle step.
  await at(2);
  await page.evaluate(async () => {
    window.odmStudio.beginScrub();
    window.odmStudio.scrubTo(10.4);
    await window.odmStudio.endScrub();
  });
  await settled(10.4);
  const a = page.locator('[data-region="stage-a"] canvas');
  const forwardFrame = await page.evaluate(() => window.viewProbe.frame!);
  expect(scene(forwardFrame, analyse(forwardFrame.notes)).current?.note.start).toBe(10);
  await writeFile(`${shots}/scrub-frame.json`, JSON.stringify(forwardFrame, null, 2));
  const forward = await a.evaluate((canvas: HTMLCanvasElement) => [
    ...canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data,
  ]);
  await a.screenshot({ path: `${shots}/scrub-forward.png` });
  await at(10.65);
  await page.evaluate(() => window.odmStudio.step(-1));
  await settled(10.4);
  const backwardFrame = await page.evaluate(() => window.viewProbe.frame!);
  expect(scene(backwardFrame, analyse(backwardFrame.notes)).current?.note.start).toBe(10);
  await writeFile(`${shots}/step-frame.json`, JSON.stringify(backwardFrame, null, 2));
  const backward = await a.evaluate((canvas: HTMLCanvasElement) => [
    ...canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data,
  ]);
  await a.screenshot({ path: `${shots}/step-back.png` });
  let differentPixels = 0;
  for (let i = 0; i < forward.length; i += 4)
    if (forward.slice(i, i + 4).some((v, channel) => v !== backward[i + channel]))
      differentPixels++;
  expect(differentPixels).toBe(0);
  const second = page.locator('[data-region="stage-b"]');
  await second.getByRole('button', { name: 'Views', exact: true }).click();
  const choice = second.getByRole('button', {
    name: 'Ash Run on Stage B',
    exact: true,
    includeHidden: true,
  });
  await revealView(choice);
  await choice.click();
  await expect(second.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await page.setViewportSize({ width: 2560, height: 1440 });
  // The small-stage frame is rendered at the design's exact 560px width below too.
  await at(10.4);
  await page.screenshot({ path: `${shots}/stage-b.png` });
  const stageBWidth = await second
    .locator('canvas')
    .evaluate((canvas) => canvas.getBoundingClientRect().width);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(async () => {
    await window.odmStudio.play();
  });
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await page.waitForFunction(
    () => window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing.png` });
  await page.evaluate(() => window.odmStudio.pause());
  const stage = await page.evaluateHandle(async () => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:10000';
    document.body.append(el);
    return { el, handle: await window.viewProbe.definition.mount(el) };
  });
  await stage.evaluate(({ el, handle }, f) => {
    el.style.width = '560px';
    handle.frame({ ...f, width: 560 });
  }, saved);
  await page.screenshot({
    path: `${shots}/stage-b-560.png`,
    clip: { x: 0, y: 0, width: 560, height: 760 },
  });
  await stage.evaluate(({ el, handle }, f) => {
    el.style.width = '1300px';
    handle.frame(f);
  }, saved);
  await page.screenshot({
    path: `${shots}/arcade-view-1300x760.png`,
    clip: { x: 0, y: 0, width: 1300, height: 760 },
  });
  const costs = await stage.evaluate(async ({ handle }, f) => {
    const costs: number[] = [];
    for (let i = 0; i < 310; i++) {
      await new Promise(requestAnimationFrame);
      const start = performance.now();
      handle.frame({ ...f, now: 10.4 + (i * f.cps) / 60 });
      if (i >= 10) costs.push(performance.now() - start);
    }
    costs.sort((a, b) => a - b);
    return {
      frames: costs.length,
      median: (costs[149] + costs[150]) / 2,
      p95: costs[285],
      max: costs[299],
      width: 1300,
      height: 760,
      dpr: 1,
    };
  }, saved);
  for (const count of [1, 20]) {
    await stage.evaluate(
      ({ handle }, { f, count }) =>
        handle.frame({
          ...f,
          now: 0.4,
          from: 0,
          to: 2,
          sections: [],
          rooms: [],
          instruments: Array.from({ length: count }, (_, index) => ({
            ...f.instruments[index % f.instruments.length],
            id: String(index),
            index,
            name: `Row ${index + 1}`,
            inSection: true,
            muted: false,
          })),
          notes: Array.from({ length: 500 }, (_, i) => ({
            ...f.notes[i % f.notes.length],
            instrument: String(i % count),
            start: i / 500,
            end: (i + 1) / 500,
            hasOnset: true,
          })),
        }),
      { f: saved, count },
    );
    await page.screenshot({
      path: `${shots}/dense-${count}.png`,
      clip: { x: 0, y: 0, width: 1300, height: 760 },
    });
  }
  const view = scene(saved, analyse(saved.notes));
  const light = view.light;
  const lightName = saved.instruments.find((i) => i.id === light?.instrument)?.name;
  const roleNames = Object.fromEntries(
    Object.entries(view.roles).map(([role, id]) => [
      role,
      saved.instruments.find((i) => i.id === id)?.name ?? null,
    ]),
  );
  const report = {
    ...costs,
    differentPixels,
    stageBWidth,
    roles: roleNames,
    roofSpans: view.roofs.length,
    currentRoof: view.current?.note,
    runnerHeight: view.size,
    stageBRunnerHeight: scene({ ...saved, width: 560 }, analyse(saved.notes)).size,
    pixelsPerSecond: view.speed,
    searchlight: light
      ? { instrument: lightName, key: light.key, value: light.value, angle: light.angle }
      : null,
    chasm: scene(chasmFrame, analyse(chasmFrame.notes)).chasm,
    userAgent: await page.evaluate(() => navigator.userAgent),
  };
  await writeFile(`${shots}/measurements.json`, JSON.stringify(report, null, 2));
  console.log('Ash Run measured:', JSON.stringify(report));
  expect(errors).toEqual([]);
  await stage.evaluate(({ el, handle }) => {
    handle.dispose();
    el.remove();
  });
});
