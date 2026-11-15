import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import {
  test,
  openProgram,
  selectNode,
  waitForPending,
  play,
  appSignal,
  sharedProgram,
} from './helpers';
import { instruments } from '../../src/document';
import { generate } from '../../src/generate';
import { createNodeQueryPool } from '../../src/strudel/evaluate-node';

const motif =
  '{fs2 a2 cs3,e3 ~}%4 [fs2|[a2|cs3]|~] fs2*<1 2>/<1 2> fs2(<2 -3>,<8 9>,<0 1>) fs2*2*3!2!3@2@3?0.3?';
const source = readFileSync('corpus/programs/piece-kiln.strudel', 'utf8').replace(
  'fs2 fs2 a2 cs3',
  motif,
);
// The browser already runs three UI cases at once. Keep the trusted Node
// reference questions in one warm slot so they do not compete with page workers.
const pool = createNodeQueryPool(1);
test.afterAll(() => pool.close());
const part = (page: Page, path: (string | number)[]) =>
  page.locator(`[data-mini-key='${JSON.stringify(path)}']`);
test.describe('Kiln structural edits with shared setup', () => {
  // Only import is shared: every edit, query window, Undo and focus check stays
  // in its own case. The fixture asserts exact Doc/events restoration per case.
  const inventory = sharedProgram(async (page) => {
    await openProgram(page, { source });
    await page.getByRole('button', { name: 'Section 2', exact: true }).click();
    const doc = await page.evaluate(() => window.odmApp.state.doc!);
    const bass = instruments(doc).find((r) => r.name === 'bass')!;
    return { doc, bass };
  });
  async function open(page: Page) {
    const { bass } = inventory();
    await selectNode(page, { nodeId: `${bass.pattern.id}:rhythm` });
    await expect(page.getByRole('button', { name: 'Boxes', exact: true })).toBeDisabled();
    return inventory();
  }
  for (const [title, index, path, label, value, before, after] of [
    [
      'lane',
      0,
      [0, 'steps', 1, 'steps', 0],
      'Part 1 › Lane 2 › Part 1 value',
      '83',
      'cs3,e3 ~',
      'cs3,83 ~',
    ],
    [
      'choice',
      1,
      [1, 'steps', 1, 'steps', 0],
      'Part 2 › Candidate 2 › Candidate 1 value',
      '83',
      '[fs2|[a2|cs3]|~]',
      '[fs2|[83|cs3]|~]',
    ],
    [
      'rate',
      2,
      [2, 'expression', 'marks', 0, 'amount', 'steps', 1],
      'Part 3 › Faster × 1 › Part 2 value',
      '3',
      '*<1 2>',
      '*<1 3>',
    ],
    [
      'signed hits',
      3,
      [3, 'pulses', 'steps', 1],
      'Part 4 › Hits › Part 2 value',
      '-2',
      '(<2 -3>,<8 9>',
      '(<2 -2>,<8 9>',
    ],
    [
      'slower rate',
      2,
      [2, 'expression', 'marks', 1, 'amount', 'steps', 1],
      'Part 3 › Slower ÷ 2 › Part 2 value',
      '3',
      '/<1 2>',
      '/<1 3>',
    ],
    [
      'patterned steps',
      3,
      [3, 'steps', 'steps', 1],
      'Part 4 › Out of › Part 2 value',
      '10',
      ',<8 9>,',
      ',<8 10>,',
    ],
    [
      'rotation',
      3,
      [3, 'rotation', 'steps', 1],
      'Part 4 › Rotation › Part 2 value',
      '-1',
      ',<0 1>)',
      ',<0 -1>)',
    ],
    [
      'mark occurrence',
      4,
      [4, 'expression', 'marks', 1, 'amount'],
      'Part 5 › Faster × 2 value',
      '4',
      '*2*3!',
      '*2*4!',
    ],
  ] as const) {
    test(`Kiln structural ${title}: exact subtree, pinned windows, one Undo and phone focus`, async ({
      page,
    }) => {
      const { doc, bass } = await open(page);
      await page.locator(`[data-path="${index}"]`).click();
      await part(page, [...path]).click();
      const input = page.getByLabel(label, { exact: true });
      await input.fill(value);
      await input.press('Enter');
      await waitForPending(page);
      await expect(input).toBeFocused();
      const changed = await page.evaluate(() => window.odmApp.state.doc!);
      const expectedStrip = await pool.query(generate(changed, { only: bass.id }), 0, 32);
      expect(expectedStrip.error).toBeNull();
      await appSignal(
        page,
        ({ id, events }) => JSON.stringify(window.odmApp.state.events[id].events) === events,
        { id: bass.id, events: JSON.stringify(expectedStrip.events) },
      );
      const strip = await page
        .locator('.rhythm-editor figure rect')
        .evaluateAll((nodes) =>
          nodes.map((n) => [Number(n.getAttribute('x')), Number(n.getAttribute('width'))]),
        );
      const queried = await page.evaluate((id) => window.odmApp.state.events[id].events, bass.id);
      expect(strip).toEqual(
        queried
          .filter((e) => e.whole && e.part[0] === e.whole[0] && e.whole[0] >= 4 && e.whole[0] < 12)
          .slice(0, 500)
          .map((e) => [
            ((e.whole![0] - 4) / 8) * 1000,
            ((Math.min(12, e.whole![1]) - Math.max(4, e.whole![0])) / 8) * 1000,
          ]),
      );
      // The browser-edited Doc is an immutable snapshot. Its real-Strudel
      // comparisons and the phone/Undo flow are independent; await both inside
      // this case, including on failure, before any live trigger proof or reset.
      const proofs = await Promise.allSettled([
        (async () => {
          const reference = source.replace(before, after);
          for (const [from, to] of [
            [-1.5, 0.25],
            [4.125, 6.5],
            [17.25, 19.5],
            [17.25, 19.5],
          ]) {
            const [actual, expected] = await Promise.all([
              pool.query(generate(changed), from, to),
              pool.query(reference, from, to),
            ]);
            expect(actual.error).toBeNull();
            expect(actual).toEqual(expected);
          }
          for (const row of instruments(doc).filter((r) => r.id !== bass.id))
            expect(instruments(changed).find((r) => r.id === row.id)!.pattern).toEqual(row.pattern);
        })(),
        (async () => {
          await page.setViewportSize({ width: 390, height: 667 });
          await input.scrollIntoViewIfNeeded();
          await expect(input).toBeVisible();
          await appSignal(
            page,
            (selected) => {
              const entry = Array.from(
                document.querySelectorAll<HTMLElement>('[data-mini-key]'),
              ).find((n) => n.dataset.miniKey === selected)!;
              const tree = entry.closest('.mini-tree')!.getBoundingClientRect(),
                row = entry.getBoundingClientRect();
              return row.top >= tree.top - 1 && row.bottom <= tree.bottom + 1;
            },
            JSON.stringify(path),
          );
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          expect(
            await page
              .locator('.mini-structure button')
              .evaluateAll((nodes) =>
                nodes
                  .filter((n) => n.getBoundingClientRect().width)
                  .every((n) => n.getBoundingClientRect().height >= 44),
              ),
          ).toBe(true);
          if (process.env.ODM_MINI_SHOTS)
            await page.screenshot({ path: `.browser-build-d2-evidence/${title}.png` });
          await page.getByRole('button', { name: 'Undo', exact: true }).click();
          await waitForPending(page);
          expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(doc);
        })(),
      ]);
      for (const proof of proofs) if (proof.status === 'rejected') throw proof.reason;
      if (title === 'lane') {
        // Install a selected-lane edit while playing; observe that revision's own
        // bass trigger, with the scheduler's default margins unchanged.
        await page.setViewportSize({ width: 1440, height: 900 });
        await play(page);
        await input.fill('83');
        await input.press('Enter');
        await waitForPending(page);
        await appSignal(page, () =>
          window.odmApp.history.some(
            (e) => e.type === 'trigger' && String((e.value as { note?: unknown }).note) === '83',
          ),
        );
        await page.getByRole('button', { name: 'Stop', exact: true }).click();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(doc);
      }
    });
  }

  test('candidate/lane splices, per cycle, ordered scalar marks and guarded argument modes', async ({
    page,
  }) => {
    const { doc } = await open(page);
    const undo = async () => {
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(doc);
    };
    await page.getByRole('button', { name: 'Add lane', exact: true }).click();
    await expect(part(page, [0, 'steps', 2])).toContainText('[~]');
    await undo();
    await part(page, [0, 'per']).click();
    const per = page.getByLabel('Part 1 › Per cycle value', { exact: true });
    await per.fill('0');
    await per.press('Enter');
    await expect(page.locator('.mini-structure [role="alert"]')).toContainText('Unproven numeric');
    expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(doc);
    await per.fill('3');
    await per.press('Enter');
    await undo();
    await page.locator('[data-path="1"]').click();
    await expect(page.locator('.mini-structure')).toContainText(
      'No candidate has a fixed time slot',
    );
    await page.getByRole('button', { name: 'Add candidate', exact: true }).click();
    await expect(part(page, [1, 'steps', 3])).toContainText('~');
    await page.getByRole('button', { name: 'Remove candidate 4', exact: true }).click();
    expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(doc);
    // Two list operations mean two separate history entries.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(part(page, [1, 'steps', 3])).toBeVisible();
    await undo();
    await page.locator('[data-path="2"]').click();
    await part(page, [2, 'expression', 'marks', 0, 'amount']).click();
    await page.getByText('Edit selected part as text', { exact: true }).click();
    const text = page.getByLabel('Part 3 › Faster × 1 mini source', { exact: true });
    for (const invalid of ['<0 2>', '<1 ~>', 'Infinity', '[']) {
      await text.fill(invalid);
      await page.getByRole('button', { name: 'Save mini text', exact: true }).click();
      await expect(page.locator('.mini-structure [role="alert"]')).not.toBeEmpty();
      expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(doc);
    }
    await page.getByRole('button', { name: 'Use constant', exact: true }).click();
    await undo();
    await page.getByRole('button', { name: 'Use pattern', exact: true }).click();
    await undo();
    await page.locator('[data-path="4"]').click();
    const chance = page.getByLabel('Mark 7 Leave out ?', { exact: true });
    await chance.fill('.4');
    await chance.press('Enter');
    await undo();
    await page.getByRole('button', { name: 'Remove mark 2', exact: true }).click();
    await undo();
    await page.getByLabel('New outer mark', { exact: true }).selectOption('weight');
    await page.getByRole('button', { name: 'Append mark', exact: true }).click();
    await undo();
    // Stable path keyboard navigation enters the selected occurrence, then leaves.
    await part(page, [4]).press('ArrowDown');
    await expect(part(page, [4, 'expression', 'step'])).toBeFocused();
    await part(page, [4, 'expression', 'step']).press('ArrowUp');
    await expect(part(page, [4])).toBeFocused();
  });
});

test('values reuse the structural List; unproven per-cycle and legacy forms keep text', async ({
  page,
}) => {
  await openProgram(page, {
    source: source.replace(
      '.lpf(700)',
      '.lpf("{400 700,900 ~}%4 [400|700|~] 700*<1 2> 700(<2 3>,8)")',
    ),
  });
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  const doc = await page.evaluate(() => window.odmApp.state.doc);
  await part(page, [0, 'steps', 1, 'steps', 0]).click();
  const value = page.getByLabel('Part 1 › Lane 2 › Part 1 value', { exact: true });
  await value.fill('1100');
  await value.press('Enter');
  await waitForPending(page);
  await expect(page.locator('.values-lane')).toContainText('1100');
  await page.setViewportSize({ width: 390, height: 667 });
  await value.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.ODM_MINI_SHOTS)
    await page.screenshot({ path: '.browser-build-d2-evidence/values-phone.png' });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(doc);
  await page.keyboard.press('Escape');
  await openProgram(page, { source: 'note("{fs2 a2}%<2 3> fs2*2(3,8) fs2:2").s("sine")' });
  await selectNode(page, { breadcrumb: ['Instrument 1', 'Rhythm'] });
  await expect(page.locator('.mini-structure')).toHaveCount(0);
  await expect(page.getByText('Edit chunk as source', { exact: true })).toBeVisible();
});

test('a structural choice replaced by an ordinary note restores Boxes and its value controls', async ({
  page,
}) => {
  await openProgram(page, { source: 'note("[c4|d4]").s("sine")' });
  await selectNode(page, { breadcrumb: ['Instrument 1', 'Rhythm'] });
  const original = await page.evaluate(() => window.odmApp.state.doc);
  await page.getByText('Edit selected part as text', { exact: true }).click();
  await page.getByLabel('Part 1 mini source', { exact: true }).fill('c4');
  await page.getByRole('button', { name: 'Save mini text', exact: true }).click();
  await waitForPending(page);
  const boxes = page.getByRole('button', { name: 'Boxes', exact: true });
  await expect(boxes).toBeEnabled();
  await boxes.click();
  await expect(page.getByLabel('Note value', { exact: true })).toHaveValue('c4');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitForPending(page);
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(original);
  await expect(boxes).toBeDisabled();
  await expect(page.locator('.mini-structure')).toContainText('No candidate has a fixed time slot');
});
