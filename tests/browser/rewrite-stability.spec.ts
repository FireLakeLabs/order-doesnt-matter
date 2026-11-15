import { expect } from '@playwright/test';
import { test, openProgram, selectNode, appSignal, signal, waitForPending } from './helpers';
import { instruments } from '../../src/document';

test('Kiln rewrite preview survives status refreshes and updates with the score', async ({
  page,
}) => {
  await openProgram(page, { example: 'Kiln' });
  await page.getByRole('button', { name: 'Section 3', exact: true }).click();
  const id = await page.evaluate(() => {
    const pad = window.odmApp.state.rows.find((row) => row.name === 'pad')!;
    return pad.pattern.layers.find((layer) => layer.kind === 'rewrite' && layer.name === 'slow')!
      .id;
  });
  await selectNode(page, { nodeId: id });
  await appSignal(page, () => !!document.querySelector('#editor [aria-label="Without slow"]'));
  const drawing = page.getByRole('img', { name: 'With slow', exact: true });
  const before = await drawing.innerHTML();
  const held = await drawing.locator('..').elementHandle();
  if (!held) throw Error('Expected the queried rewrite preview');
  await page.evaluate(() => window.odmApp.dismissSoundNotice());
  expect(await held.evaluate((node) => node.isConnected)).toBe(true);
  const field = page.getByRole('spinbutton', { name: 'Time factor', exact: true });
  await field.fill('2');
  await field.press('Enter');
  const editedFigure = await drawing.locator('..').elementHandle();
  if (!editedFigure) throw Error('Expected the edited preview');
  await waitForPending(page);
  await signal(() => drawing.innerHTML()).not.toBe(before);
  expect(await editedFigure.evaluate((node) => node.isConnected)).toBe(true);
  const doc = await page.evaluate(() => window.odmApp.state.doc!);
  expect(instruments(doc).find((row) => row.name === 'pad')!.pattern.layers).toContainEqual(
    expect.objectContaining({
      kind: 'rewrite',
      name: 'slow',
      args: [{ kind: 'literal', value: 2 }],
    }),
  );
});
