import { readFile } from 'node:fs/promises';
import { expect, test as base, type Page } from '@playwright/test';
import { describeTarget } from '../../src/document/edit';
import type { Engine, EngineEvent } from '../../src/contract';
import type {} from '../../src/app/main';

// Collect browser performance marks after the test, outside its assertions.
export const test = base.extend<{ timings: void }>({
  timings: [
    async ({ page }, use, info) => {
      await use();
      if (!page.isClosed()) {
        const marks = await page.evaluate(() => ({
          origin: performance.timeOrigin,
          marks: performance
            .getEntriesByType('measure')
            .filter((e) => e.name.startsWith('ODM:'))
            .map((e) => ({
              name: e.name.slice(4),
              start: e.startTime,
              end: e.startTime + e.duration,
            })),
        }));
        await info.attach('browser-marks', {
          body: JSON.stringify(marks),
          contentType: 'application/json',
        });
      }
    },
    { auto: true },
  ],
});

export async function openProgram(
  page: Page,
  input: { example?: string; path?: string; source?: string; offline?: boolean } = {},
) {
  if (input.offline !== false)
    await page.route(
      (url) => url.protocol === 'https:',
      (route) => route.abort('internetdisconnected'),
    );
  await page.goto('/?inspect');
  await test.step('ODM:import', async () => {
    if (input.example) await page.getByRole('button', { name: input.example, exact: true }).click();
    else if (input.path || input.source) {
      await page
        .getByLabel('Your Strudel program')
        .fill(input.path ? await readFile(input.path, 'utf8') : input.source!);
      await page.getByRole('button', { name: 'Load', exact: true }).click();
    }
    if (input.example || input.path || input.source) {
      await scoreReady(page);
      await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
    }
  });
}
export async function play(page: Page) {
  return test.step('ODM:playback', async () => {
    await swap(page, () => page.getByRole('button', { name: 'Play', exact: true }).click());
    await appSignal(page, () => window.odmApp.canPlay && window.odmApp.state.playing);
    await expect(page.locator('#message')).toBeEmpty();
  });
}

// Signal waits share the enclosing test's deadline, rather than an unrelated 5 s
// assertion budget. No global timeouts or retries; a stuck engine fails the test.
export async function appSignal<A>(page: Page, predicate: (arg: A) => unknown, arg?: A) {
  return test.step('ODM:observation', async () => {
    const handle = await page.waitForFunction(predicate as (arg: unknown) => unknown, arg, {
      timeout: 0,
    });
    await handle.dispose();
  });
}
export async function scoreReady(page: Page) {
  return test.step('ODM:import', async () => {
    await appSignal(
      page,
      () =>
        window.odmApp.canPlay &&
        Object.keys(window.odmApp.state.events).length === window.odmApp.state.rows.length,
    );
  });
}
export async function swap(page: Page, action: () => Promise<unknown>) {
  return test.step('ODM:swap', async () => {
    const before = await page.evaluate(
      () => window.odmApp.history.filter((e) => e.type === 'swapped').length,
    );
    await action();
    await appSignal(
      page,
      (count) => window.odmApp.history.filter((e) => e.type === 'swapped').length > count,
      before,
    );
  });
}
export async function throughCycle(page: Page, cycle: number) {
  await appSignal(
    page,
    (c) => window.odmApp.history.some((e) => e.type === 'trigger' && e.cycle >= c),
    cycle,
  );
}

// Runs inside harness/online page evaluations. Subscribe before checking history
// so both an already recorded signal and a later event are handled without races.
export function installEngineSignals() {
  const profiled = new WeakSet<Engine>();
  window.odmProfileEngine = (engine) => {
    if (profiled.has(engine)) return;
    profiled.add(engine);
    let first = true;
    const play = engine.play.bind(engine);
    engine.play = (code, options) => {
      const phase = first ? 'playback' : 'swap';
      first = false;
      const start = performance.now();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        off();
        performance.measure(`ODM:${phase}`, { start, end: performance.now() });
      };
      const off = engine.subscribe((e) => {
        if (e.type === 'swapped' || e.type === 'committed') finish();
      });
      return play(code, options).catch((error) => {
        finish();
        throw error;
      });
    };
    const tap = engine.tap(),
      rms = tap.rms.bind(tap);
    tap.rms = async (from, to) => {
      const start = performance.now();
      try {
        return await rms(from, to);
      } finally {
        performance.measure('ODM:capture', { start, end: performance.now() });
      }
    };
  };
  window.odmUntil = (engine, predicate) =>
    new Promise<void>((resolve) => {
      const start = performance.now();
      const done = () => {
        performance.measure('ODM:observation', { start, end: performance.now() });
        resolve();
      };
      const off = engine.subscribe(() => {
        if (predicate()) {
          off();
          done();
        }
      });
      if (predicate()) {
        off();
        done();
      }
    });
}
declare global {
  interface Window {
    odmProfileEngine(engine: Engine): void;
    odmUntil(engine: import('../../src/contract').Engine, predicate: () => boolean): Promise<void>;
  }
}

export async function selectNode(
  page: Page,
  target: { nodeId: string } | { breadcrumb: string | string[] },
) {
  let id: string;
  if ('nodeId' in target) id = target.nodeId;
  else {
    const { doc, ids } = await page.evaluate(() => ({
      doc: window.odmApp.state.doc!,
      ids: Array.from(document.querySelectorAll<HTMLElement>('[data-editor-target]')).map(
        (n) => n.dataset.editorTarget!,
      ),
    }));
    const breadcrumb = Array.isArray(target.breadcrumb)
      ? target.breadcrumb.join(' › ')
      : target.breadcrumb;
    id = ids.find((id) => describeTarget(doc, id).breadcrumb.join(' › ') === breadcrumb) ?? '';
    if (!id) throw Error(`No selectable node at ${breadcrumb}`);
  }
  const selected = page.locator(`[data-editor-target=${JSON.stringify(id)}]`).first();
  await selected.click();
  return selected;
}
export async function waitForPending(page: Page) {
  return test.step('ODM:swap', async () => {
    await appSignal(page, () =>
      Object.values(window.odmApp.editor!.state.entries).every((e) => e.status !== 'pending'),
    );
    await scoreReady(page);
    await expect(page.locator('#editor-status')).not.toContainText('Change failed');
  });
}
export async function triggerValues(page: Page, after = 0) {
  return page.evaluate(
    (offset) =>
      window.odmApp.history
        .slice(offset)
        .filter((e): e is Extract<EngineEvent, { type: 'trigger' }> => e.type === 'trigger')
        .map((e) => e.value),
    after,
  );
}

/** Poll only an observable signal, sharing the enclosing test deadline. Keep
 * assertions about the resulting score/UI outside this readiness wait. */
export function signal<T>(read: () => T | Promise<T>, options: { timeout?: number } = {}) {
  const info = test.info();
  return expect.poll(read, {
    timeout: info.timeout,
    ...options,
  });
}
