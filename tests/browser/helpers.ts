import { blockHttps } from './offline';
import { readFile } from 'node:fs/promises';
import { expect, test as base, type Page } from '@playwright/test';
import { describeTarget, instrumentTargets } from '../../src/document/edit';
import type { Engine } from '../../src/contract';
import type {} from '../../src/studio/main';
import { walk } from '../../src/document';
import { openStudio } from './studio-open';

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
  input: {
    example?: string;
    path?: string;
    source?: string;
    offline?: boolean;
  } = {},
) {
  if (input.offline !== false) await blockHttps(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openStudio(page);
  await scoreReady(page);
  if (input.example || input.path || input.source) {
    await page.getByRole('button', { name: 'Paste', exact: true }).click();
    if (input.example) await page.getByRole('button', { name: input.example, exact: true }).click();
    else {
      await page
        .getByLabel('Strudel program')
        .fill(input.path ? await readFile(input.path, 'utf8') : input.source!);
      await page.getByRole('button', { name: 'Import program', exact: true }).click();
    }
    const replacement = page.getByRole('dialog', { name: 'Replace current work?' });
    if (await replacement.isVisible())
      await replacement.getByRole('button', { name: 'Replace', exact: true }).click();
    await importFinished(page);
    await expect(page.getByLabel('Strudel program')).toBeHidden();
    await scoreReady(page);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  }
}
export async function play(page: Page) {
  return test.step('ODM:playback', async () => {
    await swap(page, () => page.getByRole('button', { name: 'Play', exact: true }).click());
    await appSignal(page, function playbackReady() {
      return window.odmStudio.app.canPlay && window.odmStudio.app.state.playing;
    });
    await expect(page.locator('.top-message')).toBeEmpty();
  });
}

// Signal waits share the enclosing test's deadline, rather than an unrelated 5 s
// assertion budget. No global timeouts or retries; a stuck engine fails the test.
export async function appSignal<A>(page: Page, predicate: (arg: A) => unknown, arg?: A) {
  // Preserve the timing reporter's phase title; name the signal in its child step.
  return test.step('ODM:observation', () =>
    test.step(`Wait for ${predicate.name || predicate.toString()}`, async () => {
      const handle = await page.waitForFunction(predicate as (arg: unknown) => unknown, arg, {
        timeout: 0,
      });
      await handle.dispose();
    }));
}
export async function scoreReady(page: Page) {
  return test.step('ODM:import', async () => {
    await appSignal(page, function studioScoreReady() {
      const app = window.odmStudio.app;
      // Whole-program setup can be playable without modeled instrument rows.
      return (
        app.canPlay &&
        (app.state.rows.length === 0 ||
          document.querySelector('[data-region="score"]')?.getAttribute('data-score-ready') ===
            'true')
      );
    });
  });
}
// Paste closes only after the worker accepts the replacement document.
export async function importFinished(page: Page) {
  await appSignal(page, function pasteImportFinished() {
    return (
      window.odmStudio.app.canPlay &&
      document.querySelector('.paste-dialog')?.getAttribute('data-state') !== 'open'
    );
  });
}
// Source validation runs before an edit can create coordinator pending entries.
export async function sourceChecked(page: Page) {
  await appSignal(page, function sourceValidationFinished() {
    const form = document.querySelector('#editor .source-text')?.closest('form');
    return form?.querySelector('button')?.disabled === false;
  });
}
export async function swap(page: Page, action: () => Promise<unknown>) {
  return test.step('ODM:swap', async () => {
    const before = await page.evaluate(() =>
      Math.max(
        0,
        ...window.odmStudio.app.history.filter((e) => e.type === 'swapped').map((e) => e.revision),
      ),
    );
    await action();
    await appSignal(
      page,
      // History is capped: an older swap can disappear while this one arrives.
      function newerRevisionTriggered(revision) {
        return window.odmStudio.app.history.some(
          (e) => e.type === 'swapped' && e.revision > revision,
        );
      },
      before,
    );
  });
}
export async function throughCycle(page: Page, cycle: number) {
  await appSignal(
    page,
    function cycleTriggered(c) {
      return window.odmStudio.app.history.some((e) => e.type === 'trigger' && e.cycle >= c);
    },
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
    const doc = await page.evaluate(() => window.odmStudio.app.state.doc!);
    const ids: string[] = [];
    walk(doc, (node) => {
      ids.push(node.id);
      if ('core' in node) ids.push(`${node.id}:rhythm`, `${node.id}:rewrites`);
    });
    const breadcrumb = Array.isArray(target.breadcrumb)
      ? target.breadcrumb.join(' › ')
      : target.breadcrumb;
    id = ids.find((id) => describeTarget(doc, id).breadcrumb.join(' › ') === breadcrumb) ?? '';
    if (!id) throw Error(`No selectable node at ${breadcrumb}`);
  }
  // Enter through the Studio tray, then the instrument editor's real navigation.
  const doc = await page.evaluate(() => window.odmStudio.app.state.doc!);
  const targetInfo = describeTarget(doc, id);
  const rowId = targetInfo.instrumentId ?? (targetInfo.kind === 'instrument' ? id : null);
  if (!rowId) throw Error(`No instrument for ${id}`);
  if (await page.locator('#editor').isVisible())
    await page.locator('#editor').getByRole('button', { name: 'Done', exact: true }).click();
  const row = page.locator(
    `.lane-label[data-instrument=${JSON.stringify(rowId)}]:not([data-setting])`,
  );
  await row.click();
  await page
    .locator('[data-region="tray"]')
    .getByRole('button', { name: 'Instrument', exact: true })
    .click();
  if (targetInfo.kind !== 'instrument') {
    const label = instrumentTargets(doc, rowId).find((target) => target.nodeId === id)?.text;
    if (!label) throw Error(`No instrument navigation target ${id}`);
    await page
      .getByRole('navigation', { name: 'Instrument settings and rewrites' })
      .getByRole('button', { name: label, exact: true })
      .click();
  }
  return row;
}
export async function waitForPending(page: Page) {
  return test.step('ODM:swap', async () => {
    await appSignal(page, function editorEntriesSettled() {
      return Object.values(window.odmStudio.app.editor!.state.entries).every(
        (e) => e.status !== 'pending',
      );
    });
    await scoreReady(page);
    await expect(page.locator('#editor-status')).not.toContainText('Change failed');
  });
}
/** Poll only an observable signal, sharing the enclosing test deadline. Keep
 * assertions about the resulting score/UI outside this readiness wait. */
export function signal<T>(read: () => T | Promise<T>, options: { timeout?: number } = {}) {
  const info = test.info();
  return expect.poll(read, {
    timeout: info.timeout,
    message: `Wait for ${read.name || read.toString()}`,
    ...options,
  });
}

export async function chooseSection(page: Page, name: string) {
  await page.getByRole('button', { name: 'Sections', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).first().click();
  await scoreReady(page);
}
