import type { Page } from '@playwright/test';

const pages = new WeakMap<Page, Promise<void>>();
/** Chromium-only suite: abort HTTPS in pages and their workers without disabling
 * the ordinary HTTP asset cache. Playwright routing disables that cache.
 */
export function blockHttps(page: Page): Promise<void> {
  let ready = pages.get(page);
  if (!ready) {
    ready = (async () => {
      const session = await page.context().newCDPSession(page);
      session.on('Fetch.requestPaused', ({ requestId }) => {
        // A target may close while its abort is in flight; the paused request
        // cannot reach the network and is discarded with that target.
        void session
          .send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' })
          .catch(() => {});
      });
      await session.send('Fetch.enable', {
        patterns: [{ urlPattern: 'https://*', requestStage: 'Request' }],
      });
    })();
    pages.set(page, ready);
  }
  return ready;
}
