import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { analyse, scene } from '../../src/views/ash-run/model';
import { crossing, building } from '../../src/views/ash-run/city';

// Real Studio frames, then an exact-size mount for comparison with the approved board.
test('ash-run: districts, edge jump, snare vault and reversible time', async ({ page }) => {
  const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/ash-run`;
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await prepare(page, 'ash-run');
  const at = async (now: number) => {
    await page.evaluate(async (now) => {
      await window.odmStudio.seek(now);
    }, now);
    await page.waitForFunction((now) => {
      const f = window.viewProbe.frame;
      return (
        f?.now === now &&
        f.from <= now &&
        f.to >= now + f.lookAhead &&
        f.notes.some((n) => n.start <= now && now < n.end) &&
        f.notes.some((n) => n.start > now)
      );
    }, now);
    await expect(page.locator('[data-region="stage-a"] .view-host')).toHaveAttribute(
      'data-score-ready',
      'true',
    );
    await page.evaluate(() => document.fonts.ready);
    return page.evaluate(() => ({ ...window.viewProbe.frame!, width: 960, height: 600, dpr: 1 }));
  };
  const mount = await page.evaluateHandle(async () => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;width:960px;height:600px;z-index:10000';
    document.body.append(el);
    return { el, handle: await window.viewProbe.definition.mount(el) };
  });
  const render = async (f: Awaited<ReturnType<typeof at>>, name: string) => {
    await mount.evaluate(({ handle }, frame) => handle.frame(frame), f);
    await page.screenshot({
      path: `${shots}/${name}.png`,
      clip: { x: 0, y: 0, width: 960, height: 600 },
    });
  };
  let saved = await at(10.4);
  await render(saved, 'bar-11-40');
  await writeFile(`${shots}/frame.json`, JSON.stringify(saved));
  for (const [now, name] of [
    [1, 'bar-2-intro'],
    [5, 'bar-6-build'],
    [17, 'bar-18-breakdown'],
  ] as const) {
    await render(await at(now), name);
  }
  saved = await at(10.4);
  const s = scene(saved, analyse(saved.notes));
  const data = analyse(saved.notes);
  const b = s.buildings.find((b) => {
    const jump = crossing(s, b);
    return (
      jump.takeoff > 8 &&
      !(data.parts.get(s.roles.snare!) ?? []).some(
        (e) => Math.abs(e.note.start - jump.landing) < 0.14,
      )
    );
  })!;
  const jump = crossing(s, b);
  const jumpTimes = [
    jump.takeoff - 0.025,
    jump.takeoff + 0.045,
    (jump.takeoff + jump.landing) / 2,
    jump.landing - 0.025,
    jump.landing + saved.cps * 0.05,
    jump.landing + saved.cps * 0.13,
  ];
  for (const [i, now] of jumpTimes.entries()) await render({ ...saved, now }, `jump-${i}`);
  const hit = data.parts
    .get(s.roles.snare!)!
    .find((e) => !scene({ ...saved, now: e.note.start }, data).airborne && e.note.start >= 8)!;
  for (const [i, delta] of [-0.09, -0.04, 0, 0.04, 0.09].entries())
    await render({ ...saved, now: hit.note.start + delta }, `vault-${i}`);
  // Three-floor drop recovery gets its own sequence.
  const drop = crossing(s, building(2));
  const rollFrame = await at(drop.landing);
  for (const [i, delta] of [-0.03, 0.03, 0.09, 0.17, 0.26, 0.36].entries())
    await render({ ...rollFrame, now: drop.landing + delta * saved.cps }, `roll-${i}`);
  await render(saved, 'scrub-forward');
  const pixels = await mount.evaluate(({ el }) => el.querySelector('canvas')!.toDataURL());
  await render({ ...saved, now: 12 }, 'scrub-away');
  await render(saved, 'scrub-backward');
  expect(await mount.evaluate(({ el }) => el.querySelector('canvas')!.toDataURL())).toBe(pixels);
  const costs = await mount.evaluate(async ({ handle }, f) => {
    const times: number[] = [];
    for (let i = 0; i < 310; i++) {
      await new Promise(requestAnimationFrame);
      const start = performance.now();
      handle.frame({ ...f, now: 10.4 + (i * f.cps) / 60 });
      if (i >= 10) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return {
      frames: times.length,
      median: (times[149] + times[150]) / 2,
      p95: times[285],
      max: times[299],
    };
  }, saved);
  await at(10.4);
  for (const name of ['riso', 'pocket', 'sunset', 'phosphor', 'arcade']) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click({ force: true });
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, name);
    const themed = await page.evaluate(() => ({
      theme: window.viewProbe.frame!.theme,
      instruments: window.viewProbe.frame!.instruments,
    }));
    await render({ ...saved, ...themed }, `theme-${name}`);
  }
  const small = { ...saved, width: 560, height: 760 };
  await mount.evaluate(({ handle }, f) => handle.frame(f), small);
  await page.screenshot({
    path: `${shots}/stage-b-560x760.png`,
    clip: { x: 0, y: 0, width: 560, height: 760 },
  });
  const report = {
    cpuSubmissionMs: costs,
    runnerHeight: s.size,
    stageBRunnerHeight: scene(small, data).size,
    pixelsPerSecond: s.speed,
    jumpSeconds: (jump.landing - jump.takeoff) / saved.cps,
    jumpTimes,
    vaultOnset: hit.note.start,
    dropLanding: drop.landing,
    roles: Object.fromEntries(
      Object.entries(s.roles).map(([key, id]) => [
        key,
        saved.instruments.find((i) => i.id === id)?.name,
      ]),
    ),
    reversiblePixels: 'identical',
  };
  await writeFile(`${shots}/measurements.json`, JSON.stringify(report, null, 2));
  console.log('Ash Run measurements:', JSON.stringify(report));
  await mount.evaluate(({ el, handle }) => {
    handle.dispose();
    el.remove();
  });
  expect(errors).toEqual([]);
});
