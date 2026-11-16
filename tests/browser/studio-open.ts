import type { Page } from '@playwright/test';

/** Non-view checks use light stages regardless of the visitor's default layout.
 * Pass explicit stages when the test exercises a view or the two-stage host. */
export function openStudio(page: Page, choices = '') {
  const params = new URLSearchParams({ inspect: '', a: 'test-card', b: '' });
  for (const [key, value] of new URLSearchParams(choices)) params.set(key, value);
  return page.goto(`/studio.html?${params.toString()}`);
}
