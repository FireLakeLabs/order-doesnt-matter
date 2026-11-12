import { queryEventsNode } from '../../src/strudel/evaluate-node';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { EngineEvent } from '../../src/contract';
import type {} from '../../src/app/main';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
async function open(page: Page) {
  await page.route(
    (url) => url.protocol === 'https:',
    (route) => route.abort('internetdisconnected'),
  );
  await page.goto('/?inspect');
}
const row = (page: Page, name: string) =>
  page.getByRole('row').filter({
    has: page
      .getByRole('rowheader')
      .filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) }),
  });
const cell = (page: Page, name: string, control: string) =>
  row(page, name).locator(`.sheet-cell[data-control="${control}"]`);
async function play(page: Page) {
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'swapped').length),
    )
    .toBeGreaterThan(0);
}
async function setValue(page: Page, value: number) {
  const input = page.getByRole('spinbutton');
  await input.fill(String(value));
  // Capture both treatments in the same input turn, before an asynchronous swap.
  const seen = await input.evaluate((el) => {
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      panel: document.querySelector('#editor-status')!.textContent,
      cell: document
        .querySelector('[data-editor-selected="true"]')
        ?.getAttribute('data-edit-state'),
    };
  });
  expect(seen).toEqual({ panel: 'Changing — not playing yet', cell: 'pending' });
}
test('constant editor: pending → swapped → trigger values → undo; readonly, focus and phone', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Kiln', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  await play(page);
  const target = cell(page, 'bass', 'lpf');
  await target.click();
  await expect(page.locator('#editor-breadcrumb')).toHaveText('bass › lpf');
  const old = Number(await page.getByRole('spinbutton').inputValue());
  await setValue(page, 900);
  await expect(page.locator('#editor-status')).toHaveText('Playing now');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.odmApp.history.filter(
            (e) => e.type === 'trigger' && (e.value as { cutoff?: number }).cutoff === 900,
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  const marker = await page.evaluate(() => window.odmApp.history.length);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('spinbutton')).toHaveValue(String(old));
  await expect
    .poll(() =>
      page.evaluate(
        ({ old, marker }) =>
          window.odmApp.history
            .slice(marker)
            .filter((e) => e.type === 'trigger' && (e.value as { cutoff?: number }).cutoff === old)
            .length,
        { old, marker },
      ),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    const engine = window.odmApp.engine!,
      original = engine.play;
    engine.play = () => {
      engine.play = original;
      return Promise.reject(Error('injected swap refusal'));
    };
  });
  await setValue(page, 1000);
  await expect(page.locator('#editor-status')).toContainText(
    'Change failed: injected swap refusal',
  );
  await expect(page.getByRole('spinbutton')).toHaveValue(String(old));
  await expect(target).toHaveAttribute('data-edit-state', 'failed');
  await expect(target).toContainText(String(old));
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor')).toBeHidden();
  await expect(target).toBeFocused();
  await target.press('Space');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await cell(page, 'lead', 'note').press('Enter');
  await expect(page.locator('#editor')).toContainText('Edit this rhythm');
  await expect(page.getByRole('slider')).toHaveCount(0);
});
test('real house: pasted local file → bass lpf 450 → 900 → unchanged other trigger values', async ({
  page,
}) => {
  await open(page);
  const source = await readFile('corpus/programs/real-house-arranged.strudel', 'utf8');
  await page.getByLabel('Your Strudel program').fill(source);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'drop', exact: true }).first().click();
  await play(page);
  await cell(page, 'bass', 'lpf').click();
  await expect(page.getByRole('spinbutton')).toHaveValue('450');
  // Compare a full cycle's event bags, normalized by phase and with multiplicity.
  const collect = async (cycle: number) => {
    await expect
      .poll(
        () =>
          page.evaluate(
            (c) =>
              window.odmApp.history.filter((e) => e.type === 'trigger' && e.cycle >= c + 1).length,
            cycle,
          ),
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);
    return page.evaluate(
      (c) =>
        window.odmApp.history.filter(
          (e): e is Extract<EngineEvent, { type: 'trigger' }> =>
            e.type === 'trigger' && e.cycle >= c && e.cycle < c + 1,
        ),
      cycle,
    );
  };
  const before = await collect(8);
  await setValue(page, 900);
  await expect(page.locator('#editor-status')).toHaveText('Playing now');
  const now = await page.evaluate(() => window.odmApp.engine!.now()!);
  const afterCycle = Math.ceil(now) + 1;
  const after = await collect(afterCycle);
  const expected = await queryEventsNode(source, afterCycle, afterCycle + 1);
  expect(expected.error).toBeNull();
  const stable = (x: unknown): string =>
    x && typeof x === 'object'
      ? Array.isArray(x)
        ? `[${x.map(stable)}]`
        : `{${Object.entries(x)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}:${stable(v)}`)}}`
      : JSON.stringify(x);
  const bags = (items: typeof before, bass: boolean) =>
    items
      .filter((e) => ((e.value as { s?: string }).s === 'sawtooth') === bass)
      .map((e) => stable(e.value))
      .sort();
  expect(bags(before, false).length).toBeGreaterThan(0);
  // Perlin is fixed by absolute time, so compare unedited source at the same
  // future cycle rather than demanding identical values in different cycles.
  const otherExpected = expected.events
    .filter((e) => e.hasOnset && (e.value as { s?: string }).s !== 'sawtooth')
    .map((e) => stable(e.value))
    .sort();
  expect(bags(after, false)).toEqual(otherExpected);
  expect(bags(after, true).length).toBeGreaterThan(0);
  for (const e of after.filter((e) => (e.value as { s?: string }).s === 'sawtooth'))
    expect(e.value).toMatchObject({ cutoff: 900 });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

test('section-local setting is distinct; signal stays read-only; arrow keys and undo shortcuts', async ({
  page,
}) => {
  await open(page);
  await page
    .getByLabel('Your Strudel program')
    .fill(
      'const chords=note(60).s("sine").lpf(450); const intro=stack(chords.lpf(600)); const build=stack(chords.lpf(sine.range(400,2000))); arrange([4,intro],[4,build],[4,chords])',
    );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'in intro: lpf 600', exact: true }).press('Enter');
  await expect(page.locator('#editor-breadcrumb')).toHaveText('chords › in intro › lpf');
  const slider = page.getByRole('slider');
  await slider.press('Shift+ArrowRight');
  await expect(page.getByRole('spinbutton')).toHaveValue('610');
  await expect(page.locator('#editor-status')).toHaveText('Plays on next start');
  await page.getByRole('spinbutton').focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('spinbutton')).toHaveValue('600');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('spinbutton')).toHaveValue('610');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'in intro: lpf 610', exact: true })).toBeFocused();
  await cell(page, 'chords', 'lpf').click();
  await expect(page.getByRole('spinbutton')).toHaveValue('450');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'in build: lpf signal', exact: true }).click();
  await expect(page.locator('#editor-breadcrumb')).toHaveText('chords › in build › lpf');
  await expect(page.locator('#editor')).toContainText('400 to 2000 Hz · signal');
  await expect(page.locator('input[type="range"]')).toHaveCount(0);
});
