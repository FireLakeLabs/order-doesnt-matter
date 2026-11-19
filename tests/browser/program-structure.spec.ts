import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { appSignal } from './helpers';
import type { ViewFrame, ViewSnapshot } from '../../src/views/types';
import type {} from '../../src/studio/main';

declare global {
  interface Window {
    structureFrames: Record<string, ViewFrame>;
  }
}

test('only opted-in views receive structure; dubstep snapshots query lazily and reuse their answers', async ({
  page,
}, info) => {
  for (const [id, optIn] of [
    ['test-card', true],
    ['scope', false],
  ] as const) {
    await page.route(`**/assets/${id}.view-*.js`, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const name = body.match(/export\{([\w$]+) as default\}/)?.[1];
      if (!name) throw Error(`${id} module has no default definition`);
      await route.fulfill({
        response,
        body:
          body +
          `
        window.structureFrames ??= {};
        ${optIn ? `${name}.structure = true;` : ''}
        const originalMount = ${name}.mount;
        ${name}.mount = async (element) => {
          const handle = await originalMount(element);
          const stage = element.closest('[data-region]').dataset.region;
          return {
            frame(frame) { window.structureFrames[stage] = frame; handle.frame(frame); },
            dispose() { delete window.structureFrames[stage]; handle.dispose(); }
          };
        };
      `,
      });
    });
  }
  await page.goto('/?inspect&a=test-card&b=scope');
  await appSignal(
    page,
    () => !!window.structureFrames?.['stage-a']?.structure && !!window.structureFrames?.['stage-b'],
  );
  expect(await page.evaluate(() => 'structure' in window.structureFrames['stage-b'])).toBe(false);
  await page.evaluate(
    (source) => window.odmStudio.load(source),
    await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
  );
  await appSignal(page, () =>
    window.structureFrames['stage-a'].instruments.some((row) => row.name === 'wobbleBass'),
  );
  const measured = await page.evaluate(async () => {
    const frame = window.structureFrames['stage-a'];
    const row = frame.instruments.find((row) => row.name === 'wobbleBass')!;
    const structure = frame.structure!.get(row.id)!;
    const costs: { step: number; ms: number; events: number }[] = [];
    function result(snapshot: ViewSnapshot) {
      if (snapshot.status !== 'available') throw Error(snapshot.reason);
      if (snapshot.result.error) throw Error(snapshot.result.error.message);
      return snapshot.result;
    }
    for (let step = 0; step < structure.steps.length; step++) {
      const start = performance.now();
      const pending = structure.snapshot(step);
      if (pending !== structure.snapshot(step)) throw Error('Pending query was not deduplicated');
      const answer = result(await pending);
      costs.push({ step, ms: performance.now() - start, events: answer.events.length });
    }
    const start = performance.now();
    for (let step = 0; step < structure.steps.length; step++) {
      const first = await structure.snapshot(step);
      if (first !== (await structure.snapshot(step))) throw Error('Cache answer was not reused');
    }
    const hitsMs = performance.now() - start;
    const filter = structure.steps.find(
      (step) => step.kind === 'setting' && step.name === 'cutoff',
    )!;
    if (filter.kind !== 'setting') throw Error('No filter');
    const rates = result(await filter.driver.rates[0].events()).events.map((event) => event.value);
    return {
      from: frame.from,
      to: frame.to,
      costs,
      hitsMs,
      rates,
      engineAbsent: window.odmStudio.app.engine == null,
    };
  });
  expect(measured.costs).toHaveLength(8);
  expect(measured.costs.every((entry) => entry.events > 0)).toBe(true);
  expect(measured.rates.slice(0, 4)).toEqual([2, 4, 3, 8]);
  expect(measured.engineAbsent).toBe(true);
  await info.attach('structure-snapshot-costs', {
    body: JSON.stringify(measured),
    contentType: 'application/json',
  });
  console.log('STRUCTURE BROWSER MEASURED (fresh worker per query)', JSON.stringify(measured));
});
