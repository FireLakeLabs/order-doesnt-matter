import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { appSignal } from './helpers';
import type { ViewFrame } from '../../src/views/types';
import type {} from '../../src/studio/main';

declare global {
  interface Window {
    historyFrame?: ViewFrame;
  }
}

for (const optIn of [false, true]) {
  test(`history ${optIn ? 'opt-in queries stored dubstep scores lazily' : 'is absent and never queries for an ordinary view'}`, async ({
    page,
  }, info) => {
    let lookupLoads = 0;
    page.on('request', (request) => {
      if (/\/history-lookup-[^/]+\.js/.test(request.url())) lookupLoads++;
    });
    await page.route('**/assets/test-card.view-*.js', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const name = body.match(/export\{([\w$]+) as default\}/)?.[1];
      if (!name) throw Error('No test-card export');
      await route.fulfill({
        response,
        body:
          body +
          `
        ${optIn ? `${name}.history = true;` : ''}
        const originalMount = ${name}.mount;
        ${name}.mount = async (element) => {
          const handle = await originalMount(element);
          return {
            frame(frame) { window.historyFrame = frame; handle.frame(frame); },
            dispose() { delete window.historyFrame; handle.dispose(); }
          };
        };
      `,
      });
    });
    await page.goto('/?inspect&a=test-card&b=');
    await appSignal(page, () => !!window.historyFrame);
    if (!optIn) {
      expect(await page.evaluate(() => 'history' in window.historyFrame!)).toBe(false);
      await page.evaluate(
        (source) => window.odmStudio.load(source),
        await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
      );
      await appSignal(page, () =>
        window.historyFrame!.instruments.some((row) => row.name === 'wobbleBass'),
      );
      // The only module capable of asking version questions was never loaded.
      // A worker query therefore cannot be dispatched by a non-opted-in view.
      expect(lookupLoads).toBe(0);
      expect(await page.evaluate(() => 'history' in window.historyFrame!)).toBe(false);
      return;
    }
    await page.evaluate(
      (source) => window.odmStudio.load(source),
      await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
    );
    await appSignal(
      page,
      () =>
        !!window.historyFrame?.history &&
        window.historyFrame.instruments.some((row) => row.name === 'wobbleBass'),
    );
    const measured = await page.evaluate(async () => {
      const frame = window.historyFrame!;
      const lookup = frame.history!;
      const id = lookup.versions[0].id;
      const start = performance.now();
      const pending = lookup.score(id);
      if (pending !== lookup.score(id)) throw Error('Missing pending deduplication');
      const answer = await pending;
      const coldMs = performance.now() - start;
      if (answer.status !== 'available') throw Error(answer.reason);
      for (const row of answer.score.instruments)
        if (row.result.error) throw Error(row.result.error.message);
      const hitStart = performance.now();
      if ((await lookup.score(id)) !== answer) throw Error('Missing cache reuse');
      return {
        coldMs,
        hitMs: performance.now() - hitStart,
        range: [frame.from, frame.to],
        instruments: answer.score.instruments.length,
        events: answer.score.instruments.reduce((sum, row) => sum + row.result.events.length, 0),
        identities: answer.score.instruments.every(
          (row) =>
            row.id &&
            row.patternId &&
            row.path.length &&
            row.uses.every((use) => use.pathIds.length),
        ),
        engineAbsent: window.odmStudio.app.engine == null,
      };
    });
    expect(measured.events).toBeGreaterThan(0);
    expect(measured.identities).toBe(true);
    expect(measured.engineAbsent).toBe(true);
    expect(lookupLoads).toBe(1);
    await info.attach('history-score-cost', {
      body: JSON.stringify(measured),
      contentType: 'application/json',
    });
    console.log('HISTORY BROWSER MEASURED (fresh worker per instrument)', JSON.stringify(measured));
  });
}
