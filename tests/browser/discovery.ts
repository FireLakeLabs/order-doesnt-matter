import { expect, type Page } from '@playwright/test';
import { test, openProgram, play, selectNode, waitForPending, appSignal } from './helpers';

declare global {
  interface Window {
    discoveryWork: { starts: number[]; ms?: number }[];
    discoveryEffects?: number;
    discoveryAccepted: number;
  }
}
async function observe(page: Page) {
  await page.addInitScript(() => {
    window.discoveryWork = [];
    const Worker = window.Worker;
    window.Worker = class extends Worker {
      postMessage(message: unknown, ...args: unknown[]) {
        const question = message as { playbackStarts?: number[] };
        if (question.playbackStarts) {
          const work = { starts: question.playbackStarts } as (typeof window.discoveryWork)[number];
          window.discoveryWork.push(work);
          const start = performance.now();
          this.addEventListener(
            'message',
            () => {
              work.ms = performance.now() - start;
            },
            { once: true },
          );
        }
        // Preserve the real worker and its evaluation/query safety path.
        return Reflect.apply(Worker.prototype.postMessage, this, [message, ...args]);
      }
    };
  });
}
async function edit(page: Page, name: string, value: number | string) {
  const before = await page.evaluate(() => window.discoveryAccepted);
  await page.evaluate(
    ({ name, value }) => {
      const app = window.odmApp;
      const doc = structuredClone(app.state.doc!);
      let found = false;
      const visit = (n: unknown): void => {
        if (!n || typeof n !== 'object') return;
        if ('name' in n && n.name === name && 'value' in n && 'id' in n) {
          const p = n.value as { core: { kind: string; value: unknown } };
          p.core = { kind: 'constant', value };
          found = true;
        }
        Object.values(n).forEach(visit);
      };
      visit(doc);
      if (!found) throw Error(`Missing setting ${name}`);
      app.editor!.apply(doc);
    },
    { name, value },
  );
  await appSignal(page, (n) => window.discoveryAccepted > n, before);
}

export async function kilnDiscovery(page: Page) {
  await observe(page);
  const start = performance.now();
  await openProgram(page, { example: 'Kiln' });
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  await play(page);
  const setupMs = performance.now() - start;
  const sounds = await page.evaluate(() => window.odmApp.engine!.sounds());
  const begin = performance.now();
  await page.getByRole('spinbutton').fill('900');
  await page.getByRole('spinbutton').press('Tab');
  await waitForPending(page);
  const edited = await page.evaluate(() =>
    window.odmApp.history.some(
      (e) => e.type === 'trigger' && (e.value as { cutoff?: number }).cutoff === 900,
    ),
  );
  expect(edited).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitForPending(page);
  const result = await page.evaluate(() => ({
    work: window.discoveryWork,
    sounds: window.odmApp.engine!.sounds(),
    latestRevision: Math.max(
      ...window.odmApp.history.filter((e) => e.type === 'swapped').map((e) => e.revision),
    ),
    last: window.odmApp.history
      .filter((e) => e.type === 'trigger' && (e.value as { cutoff?: number }).cutoff === 700)
      .at(-1),
  }));
  expect(result.last).toMatchObject({ revision: result.latestRevision, value: { cutoff: 700 } });
  expect(result.sounds.sort((a, b) => a.name.localeCompare(b.name))).toEqual(
    sounds.sort((a, b) => a.name.localeCompare(b.name)),
  );
  expect(result.work.map((w) => w.starts)).toEqual([[0, 4, 12, 28], [], []]);
  console.log(
    'DISCOVERY MEASURED',
    JSON.stringify({ setupMs, editAndUndoObservationMs: performance.now() - begin, ...result }),
  );
  await test.info().attach('section-discovery-measurement', {
    body: JSON.stringify({
      setupMs,
      editAndUndoObservationMs: performance.now() - begin,
      ...result,
    }),
    contentType: 'application/json',
  });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
}

export async function assetDiscovery(page: Page) {
  await observe(page);
  const requests: string[] = [];
  await page.route('**/discovery-*.wav', async (route) => {
    requests.push(new URL(route.request().url()).pathname);
    await route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' });
  });
  await page.route(
    (url) => url.protocol === 'https:',
    async (route) => {
      await route.fulfill({
        json: {
          _base: new URL('/', page.url()).href,
          fixture_late: {
            c3: ['discovery-a.wav', 'discovery-b.wav'],
            c4: ['discovery-c.wav', 'discovery-d.wav'],
          },
          other_late: ['discovery-e.wav', 'discovery-f.wav'],
        },
      });
    },
  );
  await openProgram(page, {
    offline: false,
    source: 'arrange([40,s("sine").gain(.2)],[2,s("late").bank("fixture").n(0).note(48).gain(.4)])',
  });
  await play(page);
  expect(requests).toContain('/discovery-a.wav');
  await page.evaluate(() => {
    window.discoveryAccepted = 0;
    const engine = window.odmApp.engine!,
      play = engine.play.bind(engine);
    engine.play = async (...args) => {
      const revision = await play(...args);
      window.discoveryAccepted++;
      return revision;
    };
  });
  await edit(page, 'gain', 0.7);
  expect(await page.evaluate(() => window.odmApp.engine!.sounds())).toContainEqual({
    name: 'fixture_late',
    state: 'ready',
  });
  expect(await page.evaluate(() => window.discoveryWork.at(-1)!.starts)).toEqual([]);
  for (const [name, value, file] of [
    ['n', 1, 'b'],
    ['note', 60, 'd'],
    ['bank', 'other', 'f'],
  ] as const) {
    await edit(page, name, value);
    expect(requests).toContain(`/discovery-${file}.wav`);
    expect(await page.evaluate(() => window.discoveryWork.at(-1)!.starts)).toEqual([0, 40]);
  }
  const before = await page.evaluate(() => window.odmApp.engine!.sounds());
  expect(
    await page.evaluate(async () => {
      try {
        await window.odmApp.engine!.play('note(');
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  expect(await page.evaluate(() => window.odmApp.engine!.sounds())).toEqual(before);
  await edit(page, 'gain', 0.8);
  expect(await page.evaluate(() => window.discoveryWork.at(-1)!.starts)).toEqual([0, 40]);
  const count = await page.evaluate(() => window.discoveryAccepted);
  await page.evaluate(() => {
    const doc = structuredClone(window.odmApp.state.doc!);
    const node = doc.body.find((n) => n.kind === 'voice')!;
    if (node.pattern.core.kind !== 'group') throw Error('Expected arrangement');
    node.pattern.core.parts[0].cycles = 41;
    window.odmApp.editor!.apply(doc);
  });
  await appSignal(page, (n) => window.discoveryAccepted > n, count);
  expect(await page.evaluate(() => window.discoveryWork.at(-1)!.starts)).toEqual([0, 41]);
  const json = await page.evaluate(() => window.odmApp.downloadDocument()!);
  await page.evaluate((json) => {
    window.odmApp.stop();
    void window.odmApp.openDocument(json);
  }, json);
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await appSignal(page, () => !window.odmApp.editor!.canUndo && window.odmApp.canPlay);
  await play(page);
  expect(await page.evaluate(() => window.discoveryWork.at(-1)!.starts)).toEqual([0, 41]);
  await page.reload();
  await page.getByRole('button', { name: 'Recover last work' }).click();
  await play(page);
  expect(await page.evaluate(() => window.discoveryWork.at(-1)!.starts)).toEqual([0, 41]);
  const ready = await page.evaluate(() => window.odmApp.engine!.sounds());
  expect(ready).toContainEqual({ name: 'other_late', state: 'ready' });
  const revision = await page.evaluate(async () =>
    window.odmApp.engine!.play(window.odmApp.exportStrudel()!, {
      fromCycle: 41,
      discoverCycles: [0, 41],
    }),
  );
  await appSignal(
    page,
    (revision) =>
      window.odmApp.history.some(
        (e) =>
          e.type === 'trigger' &&
          e.revision === revision &&
          (e.value as { bank?: string }).bank === 'other',
      ),
    revision,
  );
  const value = await page.evaluate(
    (revision) =>
      window.odmApp.history.find((e) => e.type === 'trigger' && e.revision === revision)!,
    revision,
  );
  expect(value).toMatchObject({ value: { s: 'late', n: 1, note: 60, bank: 'other', gain: 0.8 } });
  await page.evaluate(() => window.odmApp.stop());
}

export async function opaqueDiscovery(page: Page) {
  await observe(page);
  await page.route('**/discovery-registered.wav', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
  const source = `globalThis.discoveryEffects=(globalThis.discoveryEffects??0)+1; samples({registered:['/discovery-registered.wav']}); s("registered").gain(.4)`;
  await openProgram(page, { source });
  await play(page);
  const result = await page.evaluate(async () => {
    const app = window.odmApp,
      code = app.exportStrudel()!;
    const first = window.discoveryEffects;
    await app.engine!.play(code);
    return { first, second: window.discoveryEffects, sounds: app.engine!.sounds(), code };
  });
  expect(result.first).toBe(1);
  expect(result.second).toBe(2);
  expect(result.code).toContain('samples(');
  expect(result.sounds).toEqual([{ name: 'registered', state: 'ready' }]);
  expect(await page.evaluate(() => window.discoveryWork)).toHaveLength(2);
  await page.evaluate(() => window.odmApp.stop());
}
