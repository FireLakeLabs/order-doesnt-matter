import type { Locator } from '@playwright/test';

/** Expand the containing shelf group before choosing or dragging its tile. */
export async function revealView(target: Locator) {
  const toggle = target
    .locator('xpath=ancestor::section[contains(@class,"view-group")]')
    .locator('.view-group-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}
