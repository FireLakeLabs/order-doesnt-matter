import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    scoreCacheQuestions: { sent: number; pending: number };
  }
}

test('switching between whole-song drawings reuses the stage score', async ({ page }) => {
  await page.addInitScript(() => {
    window.scoreCacheQuestions = { sent: 0, pending: 0 };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private busy = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', () => {
          this.finished();
        });
      }
      private finished() {
        if (this.busy) window.scoreCacheQuestions.pending--;
        this.busy = false;
      }
      override postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        window.scoreCacheQuestions.sent++;
        window.scoreCacheQuestions.pending++;
        this.busy = true;
        Reflect.apply(
          NativeWorker.prototype.postMessage,
          this,
          options === undefined ? [message] : [message, options],
        );
      }
      override terminate() {
        this.finished();
        super.terminate();
      }
    };
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?inspect&a=&b=');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  await page.evaluate(() => window.odmStudio.load('stack(s("bd"), s("sd"))'));
  const ready = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-region="stage-a"] .view-host')
          ?.getAttribute('data-score-ready') === 'true' &&
        document.querySelector('[data-region="stage-a"] .view-status')?.textContent === '' &&
        window.scoreCacheQuestions.pending === 0,
    );
  const stage = page.locator('[data-region="stage-a"]');
  await stage.getByRole('button', { name: 'Views', exact: true }).click();
  await stage.locator('[data-view="loom"] .view-choice').click();
  await stage.getByRole('heading', { name: 'Loom', exact: true }).waitFor();
  await ready();
  const before = await page.evaluate(() => window.scoreCacheQuestions.sent);
  await stage.getByRole('button', { name: 'Views', exact: true }).click();
  await stage.locator('[data-view="band"] .view-choice').click();
  await stage.getByRole('heading', { name: 'The band', exact: true }).waitFor();
  await ready();
  expect(await page.evaluate(() => window.scoreCacheQuestions.sent)).toBe(before);
});
