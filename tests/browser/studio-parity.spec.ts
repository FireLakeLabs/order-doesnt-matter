import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dependencies } from '../../package.json' with { type: 'json' };
import type {} from '../../src/studio/main';
import type {} from '../../src/app/main';

const url = '/studio.html?inspect&a=test-card&b=test-card';
const shots = process.env.ODM_PARITY_SHOTS;
const ready = (page: Page) =>
  expect(page.locator('[data-region="score"]')).toHaveAttribute('data-score-ready', 'true');
async function pictures(page: Page, name: string) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  const original = await page.locator('html').getAttribute('data-theme');
  for (const [theme, width, height] of [
    ['arcade', 2560, 1440],
    ['arcade', 1920, 1080],
    ['riso', 1920, 1080],
    ['pocket', 1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    // A modal deliberately prevents clicking the top bar. Change the root only for visual QA.
    await page.locator('html').evaluate((html, theme) => {
      html.dataset.theme = theme;
    }, theme);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().map((animation) => animation.finished));
    });
    await page.screenshot({ path: `${shots}/${name}-${theme}-${width}x${height}.png` });
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      barHeight: document.querySelector('.top-bar')!.getBoundingClientRect().height,
    }));
    expect(dimensions.scrollWidth).toBe(width);
    expect(dimensions.scrollHeight).toBe(height);
    expect(dimensions.barHeight).toBe(52);
    await writeFile(
      `${shots}/${name}-${theme}-${width}x${height}.json`,
      JSON.stringify(dimensions),
    );
  }
  await page.locator('html').evaluate((html, theme) => {
    html.dataset.theme = theme ?? 'arcade';
  }, original);
}
async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  return readFile((await (await pending).path())!, 'utf8');
}

test('Keep work shares edited recovery across old page, Studio and reload, with portable exports and replacement protection', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?inspect');
  await page.getByLabel('Your Strudel program').fill('note("c4 e4").s("sine").gain(0.5)');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await page.waitForFunction(() => window.odmApp.canPlay);
  await page.evaluate(() => {
    const app = window.odmApp;
    const gain = app.state.rows[0].pattern.layers
      .flatMap((layer) => (layer.kind === 'settings' ? layer.settings : []))
      .find((setting) => setting.name === 'gain')!;
    app.editor!.edit(gain.id, 0.7);
  });
  const oldDoc = await page.evaluate(() => window.odmApp.state.doc);
  await page.goto(url);
  await page.getByRole('button', { name: /^Keep work/ }).click();
  await expect(page.getByRole('button', { name: 'Recover last work' })).toBeVisible();
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toBeNull();
  await page.getByRole('button', { name: 'Recover last work' }).click();
  await ready(page);
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(oldDoc);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.lane-label').first().click();
  await page.getByRole('button', { name: 'Edit Gain', exact: true }).click();
  await page.getByRole('spinbutton').fill('0.8');
  await page.getByRole('spinbutton').press('Enter');
  await page.locator('#editor').getByRole('button', { name: 'Done', exact: true }).click();
  const studioDoc = await page.evaluate(() => window.odmStudio.app.state.doc);
  expect(studioDoc).not.toEqual(oldDoc);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(oldDoc);
  await page.keyboard.press('Control+Shift+z');
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(studioDoc);
  await page.getByRole('button', { name: /^Keep work/ }).click();
  expect(JSON.parse(await download(page, 'Download document'))).toEqual(studioDoc);
  expect(await download(page, 'Export Strudel')).toContain('0.8');
  await page.getByRole('button', { name: 'Copy Strudel code' }).click();
  await expect(page.getByText('Strudel copied.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('0.8');
  await pictures(page, 'keep');
  await page.getByLabel('Document file').setInputFiles({
    name: 'piece.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(oldDoc)),
  });
  await expect(page.getByRole('dialog', { name: 'Replace current work?' })).toBeVisible();
  await pictures(page, 'replace');
  await page.getByRole('button', { name: 'Keep current', exact: true }).click();
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(studioDoc);
  await page.reload();
  await page.getByRole('button', { name: /^Keep work/ }).click();
  await page.getByRole('button', { name: 'Recover last work' }).click();
  await ready(page);
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(studioDoc);
  expect(await page.evaluate(() => window.odmStudio.app.state.playing)).toBe(false);
  await page.goto('/?inspect');
  await page.getByRole('button', { name: 'Recover last work' }).click();
  await page.waitForFunction(() => window.odmApp.canPlay);
  expect(await page.evaluate(() => window.odmApp.state.doc)).toEqual(studioDoc);
});

test('About and source links match the old legal notice and the pinned packages; examples and import notes stay available', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?inspect');
  await page.getByRole('button', { name: 'About', exact: true }).click();
  const legal = await page.locator('#about-dialog p').nth(1).innerText();
  await page.goto(url);
  await ready(page);
  await expect(page.getByRole('link', { name: 'Our source', exact: true })).toHaveAttribute(
    'href',
    'https://github.com/FireLakeLabs/order-doesnt-matter',
  );
  await expect(
    page.getByRole('link', { name: `Strudel ${dependencies['@strudel/web']} source`, exact: true }),
  ).toHaveAttribute(
    'href',
    `https://codeberg.org/uzu/strudel/src/tag/${encodeURIComponent(`@strudel/web@${dependencies['@strudel/web']}`)}`,
  );
  await page.getByRole('button', { name: 'About / AGPL' }).click();
  const about = page.getByRole('dialog');
  expect((await about.locator('p').nth(1).innerText()).replace(/\s+/g, ' ')).toBe(
    legal.replace(/\s+/g, ' '),
  );
  for (const name of ['core', 'mini', 'tonal', 'transpiler', 'web', 'webaudio', 'superdough']) {
    const pkg = name === 'superdough' ? name : `@strudel/${name}`;
    const tag = `${pkg}@${dependencies[pkg as keyof typeof dependencies]}`;
    await expect(about.getByRole('link', { name: tag, exact: true })).toHaveAttribute(
      'href',
      `https://codeberg.org/uzu/strudel/src/tag/${encodeURIComponent(tag)}`,
    );
  }
  await expect(
    about.getByRole('link', { name: 'Full licence texts and third-party notices' }),
  ).toHaveAttribute('href', '/licenses.txt');
  await pictures(page, 'about');
  await about.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await pictures(page, 'paste');
  await page.getByRole('button', { name: 'Lichen', exact: true }).click();
  await ready(page);
  await page.waitForFunction(() => window.odmStudio.app.state.source.includes('lichen'));
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await page.getByLabel('Strudel program').fill('this is not valid Strudel }');
  await page.getByRole('button', { name: 'Import program' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).not.toBeEmpty();
  await page
    .getByLabel('Strudel program')
    .fill(await readFile('corpus/programs/micro-register.strudel', 'utf8'));
  await page.getByRole('button', { name: 'Import program' }).click();
  await ready(page);
  await page.getByRole('button', { name: /^Notes \(/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Code stays in your piece');
  await pictures(page, 'notes');
});

test('Practice teaches real Studio controls and restores the mounted draft, history, layout and recovery after finish or early exit', async ({
  page,
  context,
}) => {
  await context.route('https://raw.githubusercontent.com/**', (route) =>
    route.fulfill({
      json: {
        _base: 'https://assets.invalid/',
        bd: ['burst.wav'],
        hh: ['burst.wav'],
        cp: ['burst.wav'],
        sd: ['burst.wav'],
        oh: ['burst.wav'],
        speech: ['burst.wav'],
        ade: ['burst.wav'],
      },
    }),
  );
  await context.route('https://assets.invalid/burst.wav', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(url);
  await ready(page);
  await page.getByRole('button', { name: 'Sections', exact: true }).click();
  await pictures(page, 'sections');
  await page.getByRole('menuitem', { name: 'Section 2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('.score-heading h2')).toContainText('Section 2');
  await page.evaluate(() => window.odmStudio.seek(20));
  await expect(page.locator('.score-heading h2')).toContainText('Section 2');
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await page.evaluate(() => window.odmStudio.seek(0));
  await ready(page);
  await page
    .locator('.lane-label')
    .filter({ has: page.locator('strong', { hasText: /^hh$/ }) })
    .click();
  await page.getByRole('button', { name: 'Edit Gain', exact: true }).click();
  await page.getByRole('spinbutton').fill('0.6');
  await page.getByRole('spinbutton').press('Enter');
  await page
    .locator('#editor')
    .getByRole('button', { name: 'Edit as source', exact: true })
    .click();
  const input = page.getByLabel('Source text', { exact: true });
  await input.fill('// my unfinished draft');
  const before = await page.evaluate(() => {
    Object.assign(window, {
      parityEditor: window.odmStudio.app.editor,
      parityInput: document.querySelector('#editor textarea'),
    });
    return {
      doc: window.odmStudio.app.state.doc,
      recovery: localStorage.getItem('odm:recovery'),
      layout: localStorage.getItem('odm-studio-layout'),
    };
  });
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await pictures(page, 'help');
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  const guide = page.getByRole('complementary', { name: 'Guided practice' });
  await expect(guide).toContainText('Make it move');
  await pictures(page, 'practice');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(guide).toContainText('Take it slow');
  await page.getByRole('button', { name: 'Speed 0.5', exact: true }).click();
  await expect(guide).toContainText('Time is yours');
  const track = (await page.getByTestId('song-track').boundingBox())!;
  await page.mouse.move(track.x + 30, track.y + 30);
  await page.mouse.down();
  await page.mouse.move(track.x + 120, track.y + 30);
  await page.mouse.up();
  await expect(guide).toContainText('Swap the scenery');
  await page
    .locator('[data-region="stage-b"]')
    .getByRole('button', { name: 'Views', exact: true })
    .click();
  await page
    .locator('.shelf-popover')
    .getByRole('button', { name: 'Loom on Stage B', exact: true })
    .click();
  await expect(guide).toContainText('Pick your colours');
  await page.getByRole('button', { name: 'Theme riso', exact: true }).click();
  await expect(guide).toContainText('Make a little change');
  await page
    .locator('.lane-label:not([data-setting])')
    .filter({ has: page.locator('strong', { hasText: /^hh$/ }) })
    .click();
  await page.getByRole('button', { name: 'Edit Gain', exact: true }).click();
  await page.getByRole('spinbutton').fill('0.4');
  await page.getByRole('spinbutton').press('Enter');
  await page.getByRole('button', { name: 'Finish practice', exact: true }).click();
  await expect(guide).toBeHidden();
  await expect(input).toHaveValue('// my unfinished draft');
  expect(
    await page.evaluate(() => {
      const retained = window as typeof window & { parityEditor: unknown; parityInput: unknown };
      return {
        editor: retained.parityEditor === window.odmStudio.app.editor,
        input: retained.parityInput === document.querySelector('#editor textarea'),
        doc: window.odmStudio.app.state.doc,
        recovery: localStorage.getItem('odm:recovery'),
        playing: window.odmStudio.app.state.playing,
      };
    }),
  ).toEqual({
    editor: true,
    input: true,
    doc: before.doc,
    recovery: before.recovery,
    playing: false,
  });
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  // Help cancellation and exiting at the first step preserve the same draft too.
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Close help', exact: true }).click();
  await expect(input).toHaveValue('// my unfinished draft');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(guide).toBeVisible();
  await page.getByRole('button', { name: 'End practice', exact: true }).click();
  await expect(input).toHaveValue('// my unfinished draft');
  expect(await page.evaluate(() => localStorage.getItem('odm:recovery'))).toBe(before.recovery);
});
