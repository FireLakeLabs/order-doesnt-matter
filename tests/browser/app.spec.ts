import { expect, test } from '@playwright/test';
import { instruments, sections } from '../../src/document';
import type {} from '../../src/app/main';

const offline = async (page: import('@playwright/test').Page) =>
  page.route(
    (url) => url.protocol === 'https:',
    (route) => route.abort('internetdisconnected'),
  );
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
test('page: original arrangement → rows → measured synth PCM → pinned section → Stop → failed paste', async ({
  page,
}) => {
  await offline(page);
  await page.goto('/?inspect');
  await page.getByRole('button', { name: 'Kiln', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.odmApp.engine)).toBeNull();
  const doc = await page.evaluate(() => window.odmApp.state.doc!);
  const rows = instruments(doc),
    parts = sections(doc);
  await expect(page.getByRole('rowheader')).toHaveCount(rows.length);
  for (const row of rows)
    await expect(page.getByRole('rowheader').filter({ hasText: row.name })).toBeVisible();
  for (const part of parts)
    await expect(page.getByRole('button', { name: part.name, exact: true })).toBeVisible();
  await expect(page.getByRole('rowheader').first()).toContainText('not loaded yet');
  await expect(page.getByRole('rowheader').filter({ hasText: 'bass' })).toContainText(
    'No events in this window',
  );
  // The original opens with sample drums. Select its second section, which also has a synth.
  await page.getByRole('button', { name: parts[1].name, exact: true }).click();
  await expect(page.locator('#window')).toHaveText('Cycles 4–12');
  await expect(page.getByRole('rowheader').filter({ hasText: 'bass' })).not.toContainText(
    'No events in this window',
  );
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('rowheader').filter({ hasText: 'bass' })).toContainText(
    'not loaded yet',
  );
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'trigger').length),
    )
    .toBeGreaterThan(4);
  const measured = await page.evaluate(async () => {
    const app = window.odmApp,
      e = app.engine!;
    const triggers = app.history.filter((t) => t.type === 'trigger');
    const synth = triggers.find((t) => (t.value as { s: string }).s === 'triangle')!;
    const tap = e.tap();
    return {
      baseline: await tap.rms(triggers[0].time - 0.08, triggers[0].time - 0.02),
      rms: await tap.rms(synth.time + 0.005, synth.time + 0.105),
      firstCycle: triggers[0].cycle,
    };
  });
  console.log('APP MEASURED (rendered PCM, threshold 0.001)', JSON.stringify(measured));
  expect(measured.rms).toBeGreaterThan(0.001);
  expect(measured.rms).toBeGreaterThan(measured.baseline * 10);
  expect(measured.firstCycle).toBe(4);
  for (const drum of ['bd', 'hh', 'cp'])
    await expect(page.getByText(new RegExp(`${drum}: missing`)).first()).toBeVisible();
  await expect(page.getByText(/offline or network error/).first()).toBeVisible();
  const mark = page.locator('.sheet-playhead').first();
  const before = await mark.getAttribute('d');
  await expect.poll(() => mark.getAttribute('d')).not.toBe(before);
  await expect(page.getByRole('button', { name: parts[1].name, exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await page.getByRole('button', { name: parts[2].name, exact: true }).click();
  await expect(page.locator('#window')).toHaveText('Cycles 12–28');
  await expect(page.getByRole('rowheader').filter({ hasText: 'pad' })).not.toContainText(
    'Not queried',
  );
  // Pinned cells survive continued playback in a different section.
  const current = await page.evaluate(() => window.odmApp.engine!.now());
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.odmApp.engine!.now())).toBeGreaterThan(current!);
  await expect(page.locator('#window')).toHaveText('Cycles 12–28');
  await expect(page.getByRole('button', { name: parts[2].name, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: parts[1].name, exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(page.locator('#window')).toHaveText('Cycles 4–12');
  // Garbage keeps the previous rows and active transport.
  await page.getByLabel('Your Strudel program').fill('note(');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not read this Strudel');
  await expect(page.getByRole('rowheader')).toHaveCount(rows.length);
  expect(await page.evaluate(() => window.odmApp.engine!.playing)).toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const count = await page.evaluate(
    () => window.odmApp.history.filter((e) => e.type === 'trigger').length,
  );
  await page.waitForTimeout(350);
  expect(
    await page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'trigger').length),
  ).toBe(count);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('worker timeout leaves the page responsive; superseded results never replace a new piece', async ({
  page,
}) => {
  await offline(page);
  await page.goto('/?inspect');
  for (const source of ['new Pattern(()=>{while(true){}})', 'while(true){}; silence']) {
    await page.getByLabel('Your Strudel program').fill(source);
    const start = Date.now();
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
    await expect(page.getByLabel('Your Strudel program')).toBeHidden();
    await expect(page.locator('#message')).toContainText('timed out', { timeout: 7000 });
    expect(Date.now() - start).toBeLessThan(7000);
    if (source.startsWith('new'))
      await expect(page.getByRole('rowheader').first()).toContainText('Broken: Question timed out');
    await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
  }
  await page.getByLabel('Your Strudel program').fill('new Pattern(()=>{while(true){}})');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await page.getByRole('button', { name: 'Lichen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(page.getByRole('rowheader').first()).not.toContainText('Broken');
  await expect(page.locator('#message')).toBeEmpty();
});

test('engine errors appear in the top bar', async ({ page }) => {
  await offline(page);
  await page.goto('/?inspect');
  await page.getByLabel('Your Strudel program').fill('note("not_a_note").s("sine")');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#message')).not.toBeEmpty();
  await expect
    .poll(() => page.evaluate(() => window.odmApp.history.filter((e) => e.type === 'error').length))
    .toBeGreaterThan(0);
  await expect(page.locator('#message')).not.toContainText('Preparing');
});
