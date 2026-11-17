import { expect, type Page } from '@playwright/test';
import {
  test,
  openProgram,
  selectNode,
  waitForPending,
  appSignal,
  chooseSection,
  sourceChecked,
} from './helpers';
import { callbackPiece } from '../fixtures/callback-rewrite';

const editor = (page: Page) => page.locator('#editor');
const undo = (page: Page) => page.getByRole('button', { name: 'Undo', exact: true }).click();
const done = (page: Page) =>
  editor(page).getByRole('button', { name: 'Done', exact: true }).click();
const document = (page: Page) => page.evaluate(() => window.odmStudio.app.state.doc);
async function number(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  await field.press('Enter');
  await waitForPending(page);
}

test('real house tray: values, source, rhythm, signal, ordered rewrites and instrument navigation retain exact Undo', async ({
  page,
}) => {
  await openProgram(page, { path: 'corpus/programs/real-house-arranged.strudel' });
  const original = await document(page);
  await chooseSection(page, 'drop');
  await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  await expect(editor(page)).toHaveAttribute('data-editor-kind', 'constant');
  await page.getByRole('button', { name: 'Change over time', exact: true }).click();
  await number(page, 'Value 2 (Hz)', '900');
  await appSignal(page, function editedValuesQueried() {
    const app = window.odmStudio.app;
    const bass = app.state.rows.find((row) => row.name === 'bass');
    return (
      bass &&
      app.state.events[bass.id]?.events.some(
        (event) => (event.value as { cutoff?: number }).cutoff === 900,
      )
    );
  });
  await expect(page.locator('.values-lane')).toContainText('900');
  await undo(page);
  await expect(page.getByRole('spinbutton', { name: 'Value 2 (Hz)', exact: true })).toHaveValue(
    '450',
  );
  await undo(page);
  expect(await document(page)).toEqual(original);
  await expect(editor(page)).toHaveAttribute('data-editor-kind', 'constant');
  await editor(page).getByRole('button', { name: 'Edit as source', exact: true }).click();
  const source = page.getByLabel('Source text', { exact: true });
  await source.fill('.lpf(900)');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await sourceChecked(page);
  await expect(editor(page)).toContainText('Applied.');
  await waitForPending(page);
  await source.fill('.lpf(');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await sourceChecked(page);
  await expect(editor(page).getByRole('alert').filter({ visible: true })).toContainText(
    'Check the source text',
  );
  await expect(source).toHaveValue('.lpf(');
  await page.getByRole('button', { name: 'Revert', exact: true }).click();
  await expect(source).toHaveValue('.cutoff(900)');
  await undo(page);
  expect(await document(page)).toEqual(original);
  await done(page);
  await page
    .locator('.lane-label:not([data-setting])')
    .filter({ has: page.locator('strong', { hasText: /^bass$/ }) })
    .click();
  await page.getByRole('button', { name: /Edit rhythm/ }).click();
  await number(page, 'Note value', '83');
  await page.getByRole('button', { name: 'Split in 2', exact: true }).click();
  await page.locator('[data-path="0"]').press('ArrowDown');
  await page.getByRole('button', { name: 'Rest', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bring back', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bring back', exact: true }).click();
  for (let i = 0; i < 4; i++) await undo(page);
  expect(await document(page)).toEqual(original);
  await done(page);
  await selectNode(page, { breadcrumb: ['percussion · hh', 'gain'] });
  await number(page, 'High bound', '0.6');
  await page.locator('.signal-editor summary').click();
  await page.getByRole('button', { name: 'saw', exact: true }).click();
  await number(page, 'One sweep every N cycles', '2');
  await appSignal(page, function signalValuesDrawn() {
    return !!window.document
      .querySelector('#editor .signal-curve polyline')
      ?.getAttribute('points');
  });
  await expect(
    page
      .getByRole('img', { name: 'Real setting values over the current window' })
      .locator('polyline'),
  ).not.toHaveAttribute('points', '');
  for (let i = 0; i < 3; i++) await undo(page);
  expect(await document(page)).toEqual(original);
  await done(page);
  await selectNode(page, { breadcrumb: ['kick', 'Rewrites'] });
  await page.getByRole('button', { name: 'Add fast', exact: true }).click();
  await number(page, 'Time factor', '2');
  await appSignal(page, function rewriteComparisonQueried() {
    return !!window.document.querySelector('#editor [aria-label="Without fast"]');
  });
  await expect(page.getByRole('img', { name: 'Without fast' })).toBeVisible();
  await done(page);
  await selectNode(page, { breadcrumb: ['kick', 'Rewrites'] });
  await page.getByRole('button', { name: 'Add degradeBy', exact: true }).click();
  await page.getByRole('button', { name: 'Move earlier', exact: true }).click();
  await expect(editor(page).locator('ol')).toContainText(/degradeBy[\s\S]*fast/);
  await page.getByRole('button', { name: 'Remove rewrite', exact: true }).click();
  await page.getByRole('button', { name: 'Edit fast', exact: true }).click();
  await page.getByRole('button', { name: 'Remove rewrite', exact: true }).click();
  expect(await document(page)).toEqual(original);
  await done(page);
  await selectNode(page, { breadcrumb: ['bass'] });
  const name = page.getByLabel('Instrument name', { exact: true });
  await name.fill('changed bass');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(
    page
      .locator('.lane-label')
      .filter({ has: page.locator('strong', { hasText: /^changed bass$/ }) }),
  ).toBeVisible();
  await undo(page);
  await expect(name).toHaveValue('bass');
});

test('callback tray: branch factor, order, independent source validation and failed live edits', async ({
  page,
}) => {
  await openProgram(page, { source: callbackPiece });
  const original = await document(page);
  await selectNode(page, { breadcrumb: ['bass', 'every'] });
  await page.getByRole('button', { name: 'Open Periodic change · p', exact: true }).click();
  await page.getByRole('button', { name: 'Edit fast', exact: true }).click();
  await number(page, 'Time factor', '3');
  await undo(page);
  expect(await document(page)).toEqual(original);
  await page.getByRole('button', { name: 'Move earlier', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Callback rewrites · in order' })).toHaveText(
    'fastrev',
  );
  await undo(page);
  await done(page);
  await selectNode(page, { breadcrumb: ['bass', 'layer'] });
  await page.getByRole('button', { name: 'Open Branch 2 · right', exact: true }).click();
  await page.getByRole('button', { name: 'Add early', exact: true }).click();
  await number(page, 'Cycles earlier', '.25');
  await page.getByRole('button', { name: 'Remove rewrite', exact: true }).click();
  expect(await document(page)).toEqual(original);
  await page.getByRole('button', { name: 'Back to layer', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Argument 2 as source', exact: true }).click();
  const source = page.getByLabel('Source text', { exact: true });
  await source.fill('right => (');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(editor(page).getByRole('alert').filter({ visible: true })).toContainText(
    'Check the source text',
  );
  expect(await document(page)).toEqual(original);
  await source.fill('right => right.pan(.8).rev()');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(editor(page)).toContainText('Applied.');
  await undo(page);
  await done(page);
  await selectNode(page, { breadcrumb: ['bass', 'every'] });
  await page.getByRole('button', { name: 'Edit Change as source', exact: true }).click();
  await page.evaluate(async () => {
    await window.odmStudio.setLoop({ from: 4, to: 12 });
    await window.odmStudio.play();
  });
  await source.fill('p=>p.notARealRewrite()');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await appSignal(page, function failedEditorEntry() {
    return Object.values(window.odmStudio.app.editor!.state.entries).some(
      (e) => e.status === 'failed',
    );
  });
  expect(await document(page)).toEqual(original);
  await expect(source).toHaveValue('p=>p.notARealRewrite()');
  expect(await page.evaluate(() => window.odmStudio.app.state.playing)).toBe(true);
  await page.evaluate(() => window.odmStudio.stop());
});

test('structural mini tray: lanes, candidates, signed hits, invalid text and restoration to Boxes', async ({
  page,
}) => {
  await openProgram(page, { source: 'note("{fs2 a2,cs3 ~}%4 [fs2|a2|~] fs2(-3,8)").s("sine")' });
  await page.locator('.lane-label').first().click();
  await page.getByRole('button', { name: /Edit rhythm/ }).click();
  const original = await document(page);
  const part = (key: (number | string)[]) =>
    page.locator(`[data-mini-key='${JSON.stringify(key)}']`);
  await part([0, 'steps', 1, 'steps', 0]).click();
  await page.getByLabel('Part 1 › Lane 2 › Part 1 value', { exact: true }).fill('83');
  await page.getByLabel('Part 1 › Lane 2 › Part 1 value', { exact: true }).press('Enter');
  await waitForPending(page);
  await undo(page);
  expect(await document(page)).toEqual(original);
  await page.locator('[data-path="1"]').click();
  await part([1, 'steps', 1]).click();
  await page.getByLabel('Part 2 › Candidate 2 value', { exact: true }).fill('84');
  await page.getByLabel('Part 2 › Candidate 2 value', { exact: true }).press('Enter');
  await waitForPending(page);
  await undo(page);
  await page.locator('[data-path="2"]').click();
  await expect(editor(page)).toContainText('5 of 8 positions can play.');
  await number(page, 'hits', '-2');
  await expect(editor(page)).toContainText('6 of 8 positions can play.');
  await undo(page);
  await done(page);
  await openProgram(page, { source: 'note("[c4|d4]").s("sine")' });
  await page.locator('.lane-label').first().click();
  await page.getByRole('button', { name: /Edit rhythm/ }).click();
  const choice = await document(page);
  await page.getByText('Edit selected part as text', { exact: true }).click();
  const text = page.getByLabel('Part 1 mini source', { exact: true });
  await text.fill('[');
  await page.getByRole('button', { name: 'Save mini text', exact: true }).click();
  await expect(page.locator('.mini-structure [role="alert"]')).not.toBeEmpty();
  expect(await document(page)).toEqual(choice);
  await text.fill('c4');
  await page.getByRole('button', { name: 'Save mini text', exact: true }).click();
  await waitForPending(page);
  await expect(page.getByRole('button', { name: 'Boxes', exact: true })).toBeEnabled();
  await undo(page);
  expect(await document(page)).toEqual(choice);
});
