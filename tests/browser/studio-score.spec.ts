import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type {} from '../../src/studio/main';

const shots = '/tmp/odm-studio-score/shots';
// Original fixture: two rewrites and seven settings on one line, including a
// piece-defined rewrite. No third-party music or network assets.
const nine = `register('ghosts', (amount, pat) => pat.off(1/8, p => p.gain(amount)));
const sawBass = note("c2 eb2 g2 bb2").s("sawtooth").lpf("<400 2400>").gain(.7).pan(.4).room(.2).attack(.01).ghosts(.2).rev();
sawBass`;
async function assets(context: BrowserContext) {
  await context.route('https://raw.githubusercontent.com/**', (route) => {
    const bank: Record<string, unknown> = {
      _base: 'https://raw.githubusercontent.com/studio-score-sounds/',
    };
    for (const name of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      bank[name] = ['burst.wav', 'burst.wav', 'burst.wav'];
    return route.fulfill({ json: bank });
  });
  await context.route('**/studio-score-sounds/burst.wav', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
}
async function ready(page: Page) {
  await expect(page.locator('[data-region="score"]')).toHaveAttribute('data-score-ready', 'true', {
    timeout: 0,
  });
}
async function load(page: Page, source: string) {
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  await page.evaluate((source) => window.odmStudio.load(source), source);
  await page.waitForFunction(
    (source) => window.odmStudio.app.canPlay && window.odmStudio.app.state.source === source,
    source,
  );
  await ready(page);
}
async function seek(page: Page, cycle: number) {
  await page.evaluate(async (cycle) => {
    window.odmStudio.pause();
    await window.odmStudio.seek(cycle);
  }, cycle);
  await expect(page.locator('.score-heading h2')).toContainText(cycle >= 16 ? 'breakdown' : 'drop');
  await ready(page);
}
async function noScroll(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement,
          score = document.querySelector<HTMLElement>('.score-scroll')!;
        return (
          root.scrollWidth === root.clientWidth &&
          root.scrollHeight === root.clientHeight &&
          score.scrollWidth === score.clientWidth &&
          score.scrollHeight === score.clientHeight
        );
      }),
    )
    .toBe(true);
  const sizes = await page.evaluate(() => {
    const page = document.documentElement,
      score = document.querySelector<HTMLElement>('.score-scroll')!;
    return {
      page: [page.scrollWidth, page.clientWidth, page.scrollHeight, page.clientHeight],
      score: [score.scrollWidth, score.clientWidth, score.scrollHeight, score.clientHeight],
    };
  });
  expect(sizes.page[0]).toBe(sizes.page[1]);
  expect(sizes.page[2]).toBe(sizes.page[3]);
  expect(sizes.score[0]).toBe(sizes.score[1]);
  expect(sizes.score[2]).toBe(sizes.score[3]);
  return sizes;
}
async function picture(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await ready(page);
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.view-host')).every(
        (host) => host.getAttribute('data-score-ready') === 'true',
      ) &&
      Array.from(document.querySelectorAll('.view-status')).every((status) => !status.textContent),
  );
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${name}.png` });
}
const row = (page: Page, name: string) =>
  page
    .locator('.lane-label:not([data-setting])')
    .filter({ has: page.locator('strong', { hasText: name }) });
const tray = (page: Page) => page.locator('[data-region="tray"]');

test('real dubstep score fits both desktops, follows sections and ruler scrubbing, and presents every theme and editor', async ({
  page,
  context,
}) => {
  await assets(context);
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('/studio.html?inspect');
  await load(page, await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'));
  await seek(page, 9.4);
  await page.evaluate(() => window.odmStudio.setLoop({ from: 8, to: 10 }));
  await expect(page.locator('.lane-label:not([data-setting])')).toHaveCount(13);
  await expect(page.locator('.lane-label[data-resting="false"]')).toHaveCount(6);
  await expect(page.locator('.lane-label[data-resting="true"]')).toHaveCount(7);
  await row(page, 'wobbleBass').click();
  await expect(page.locator('.instrument-row[data-selected="true"]')).toContainText('wobbleBass');
  await expect(tray(page).getByRole('button', { name: 'Edit Cutoff', exact: true })).toBeVisible();
  const sizes = await page
    .locator('[data-region="score"], [data-region="tray"]')
    .evaluateAll((regions) =>
      regions.map((el) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height };
      }),
    );
  expect(sizes[0].width).toBeCloseTo(2000, -1);
  expect(sizes[1].width).toBeCloseTo(560, -1);
  for (const size of sizes) expect(Math.abs(size.height - 572) / 572).toBeLessThan(0.05);
  await noScroll(page);
  await picture(page, 'arcade-2560-grid');
  await tray(page).getByRole('button', { name: 'Edit Cutoff', exact: true }).click();
  await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'signal');
  await expect(page.getByLabel('Low bound', { exact: true })).toHaveValue('140');
  const editorStyle = await page.locator('#editor').evaluate((editor) => ({
    footer: getComputedStyle(editor.querySelector('footer')!).display,
    border: getComputedStyle(editor.querySelector('input')!).borderStyle,
  }));
  expect(editorStyle).toEqual({ footer: 'flex', border: 'solid' });
  await picture(page, 'arcade-2560-cutoff');
  await page.locator('#editor').getByRole('button', { name: 'Done', exact: true }).click();
  await tray(page).getByRole('button', { name: 'Edit rhythm', exact: false }).click();
  await expect(page.locator('.wide-editor #editor')).toHaveAttribute('data-layout', 'wide');
  const wide = await page.locator('.wide-editor').boundingBox();
  expect(wide!.width).toBeGreaterThan(1900);
  await picture(page, 'arcade-2560-rhythm');
  await page.locator('#editor').getByRole('button', { name: 'Done', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await noScroll(page);
  const heights = await page.locator('.lane-label:not([data-setting])').evaluateAll((rows) =>
    rows.map((row) => ({
      resting: row.getAttribute('data-resting') === 'true',
      height: row.getBoundingClientRect().height,
    })),
  );
  expect(heights.every((row) => row.height >= (row.resting ? 14 : 44))).toBe(true);
  await picture(page, 'arcade-1920-grid');
  await tray(page).getByRole('button', { name: 'Edit Cutoff', exact: true }).click();
  await picture(page, 'arcade-1920-cutoff');
  await page.locator('#editor').getByRole('button', { name: 'Done', exact: true }).click();
  await tray(page).getByRole('button', { name: 'Edit rhythm', exact: false }).click();
  await picture(page, 'arcade-1920-rhythm');
  await page.locator('#editor').getByRole('button', { name: 'Done', exact: true }).click();
  for (const theme of ['phosphor', 'pocket', 'riso', 'sunset']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await picture(page, `${theme}-1920-grid`);
    await noScroll(page);
  }
  await page.evaluate(() => window.odmStudio.setLoop(null));
  await seek(page, 17);
  await expect(page.locator('.lane-label[data-resting="false"]')).toHaveCount(3);
  await expect(page.locator('.lane-label[data-resting="true"]')).toHaveCount(10);
  // The ruler uses absolute section time and transport scrubbing, including seeks back.
  await seek(page, 9.4);
  const ruler = (await page.getByTestId('score-ruler').boundingBox())!;
  await page.mouse.move(ruler.x + ruler.width / 4, ruler.y + 16);
  await page.mouse.down();
  await page.mouse.move(ruler.x + ruler.width / 2, ruler.y + 16);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.odmStudio.getPlayhead())).toBeCloseTo(12, 2);
  await tray(page).getByRole('button', { name: 'Show Cutoff as lane', exact: true }).click();
  await expect(page.locator('.lane-label[data-setting]')).toHaveCount(1);
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify({ sizes, heights, editorStyle }, null, 2),
  );
});

test('cutoff edit is pending until its engine acknowledgement; top-bar Undo restores the value', async ({
  page,
  context,
}) => {
  await assets(context);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/studio.html?inspect&a=test-card&b=');
  await load(page, await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'));
  await seek(page, 9.4);
  await row(page, 'wobbleBass').click();
  await page.evaluate(async () => {
    await window.odmStudio.setLoop({ from: 8, to: 16 });
    await window.odmStudio.play();
  });
  await page.waitForFunction(() => window.odmStudio.app.state.playing);
  await tray(page).getByRole('button', { name: 'Edit Cutoff', exact: true }).click();
  const beforeRevision = await page.evaluate(() =>
    Math.max(
      0,
      ...window.odmStudio.app.history.flatMap((event) =>
        'revision' in event ? [event.revision] : [],
      ),
    ),
  );
  const instrument = await row(page, 'wobbleBass').getAttribute('data-instrument');
  await page.getByLabel('Low bound', { exact: true }).fill('210');
  await page.getByLabel('Low bound', { exact: true }).press('Enter');
  await expect(page.locator('#editor')).toHaveAttribute('data-edit-state', 'pending');
  await page.locator('#editor').getByRole('button', { name: 'Done', exact: true }).click();
  const tile = page.locator('.setting-tile[data-setting-name="lpf"]');
  // The marker is driven by coordinator state, without delaying or faking an engine event.
  await expect(tile).toHaveAttribute('data-edit-state', 'pending');
  await expect(tile).toHaveAttribute('data-edit-state', '', { timeout: 0 });
  await page.waitForFunction(
    ({ beforeRevision, instrument }) =>
      window.odmStudio.app.history.some(
        (event) =>
          event.type === 'trigger' &&
          event.revision > beforeRevision &&
          event.instrument === instrument,
      ),
    { beforeRevision, instrument },
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  await tray(page).getByRole('button', { name: 'Edit Cutoff', exact: true }).click();
  await expect(page.getByLabel('Low bound', { exact: true })).toHaveValue('140');
  await page.evaluate(() => window.odmStudio.stop());
});

test('custom definitions open as source, and nine things fit a 560px tray', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('/studio.html?inspect&a=test-card&b=');
  await load(page, await readFile('corpus/programs/micro-register.strudel', 'utf8'));
  await page.locator('.lane-label').first().click();
  await tray(page).getByRole('button', { name: 'ghosts custom', exact: true }).click();
  await expect(page.getByLabel('Source text', { exact: true })).toHaveValue(/register\('ghosts'/);
  // The source kind's draft must survive an unrelated document update (Undo/Redo uses same host).
  await page
    .getByLabel('Source text', { exact: true })
    .fill('// draft\nregister("ghosts", (amount, pat) => pat);');
  await page.evaluate(() => {
    const app = window.odmStudio.app;
    const setting = app.state.rows[0].pattern.layers
      .flatMap((layer) => (layer.kind === 'settings' ? layer.settings : []))
      .find((setting) => setting.name === 's')!;
    app.editor!.edit(setting.id, 'triangle');
  });
  await expect(page.getByLabel('Source text', { exact: true })).toHaveValue(/\/\/ draft/);
  await page.locator('#editor').getByRole('button', { name: 'Done', exact: true }).click();
  await load(page, nine);
  await page.locator('.lane-label').first().click();
  await expect(tray(page).locator('.rewrite-chain li')).toHaveCount(2);
  await expect(tray(page).locator('.setting-tile')).toHaveCount(7);
  await expect(page.locator('.lane-counts')).toContainText('2 rewrites');
  await expect(page.locator('.lane-counts')).toContainText('7 settings');
  expect(
    await tray(page)
      .locator('.tray-content')
      .evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight),
  ).toBe(true);
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await picture(page, 'nine-things-560-tray');
});

test('an opaque corpus instrument stays visible and source-editable while playback runs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/studio.html?inspect&a=test-card&b=');
  // Both wholly opaque corpus patterns deliberately throw. Remove only this
  // fixture's intentional failure to exercise its otherwise real Pattern query.
  const source = (
    await readFile('corpus/programs/micro-query-late-throws.strudel', 'utf8')
  ).replace(
    "if (Number(state.span.begin) >= 3) throw new Error('corpus intentional late failure'); ",
    '',
  );
  await load(page, source);
  await page.locator('.lane-label').first().click();
  await expect(tray(page).locator('.tray-source pre')).toContainText('new Pattern');
  await tray(page)
    .locator('.tray-heading')
    .getByRole('button', { name: 'Edit as source', exact: true })
    .click();
  await expect(page.getByLabel('Source text', { exact: true })).toHaveValue(/new Pattern/);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.odmStudio.app.state.playing &&
      window.odmStudio.app.history.some((event) => event.type === 'trigger'),
  );
  await page.evaluate(() => window.odmStudio.stop());
});
