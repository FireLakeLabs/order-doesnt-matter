import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { describeTarget } from '../../src/document/edit';
import type { EngineEvent } from '../../src/contract';
import type {} from '../../src/app/main';

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
  if (input.example) await page.getByRole('button', { name: input.example, exact: true }).click();
  else if (input.path || input.source) {
    await page
      .getByLabel('Your Strudel program')
      .fill(input.path ? await readFile(input.path, 'utf8') : input.source!);
    await page.getByRole('button', { name: 'Load', exact: true }).click();
  }
  if (input.example || input.path || input.source) {
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(
          () => Object.keys(window.odmApp.state.events).length === window.odmApp.state.rows.length,
        ),
      )
      .toBe(true);
  }
}
export async function play(page: Page) {
  const before = await page.evaluate(
    () => window.odmApp.history.filter((e) => e.type === 'swapped').length,
  );
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'swapped').length),
    )
    .toBeGreaterThan(before);
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
  await expect(page.locator('#editor')).not.toHaveAttribute('data-edit-state', 'pending');
  await expect(page.locator('#editor-status')).not.toContainText('Change failed');
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
