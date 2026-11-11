import { expect, test } from '@playwright/test';
test('built shell loads without browser or request errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => errors.push(request.url()));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: "Order Doesn't Matter" })).toBeVisible();
  await expect(page.getByRole('main')).toBeAttached();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});
