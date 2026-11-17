import { expect, test, type Page } from '@playwright/test';
import { appSignal } from './helpers';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import packageJson from '../../package.json' with { type: 'json' };
const { dependencies } = packageJson;
import type {} from '../../src/studio/main';

const url = '/?inspect&a=test-card&b=test-card';
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
      await Promise.allSettled(document.getAnimations().map((animation) => animation.finished));
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

test('Keep work retains edited Studio work across reload, with portable exports and replacement protection', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(url);
  await ready(page);
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await page.getByLabel('Strudel program').fill('note("c4 e4").s("sine").gain(0.7)');
  await page.getByRole('button', { name: 'Import program', exact: true }).click();
  await expect(page.getByLabel('Strudel program')).toBeHidden();
  await ready(page);
  const oldDoc = await page.evaluate(() => window.odmStudio.app.state.doc);
  await page.locator('.lane-label').first().click();
  await page.getByRole('button', { name: 'Edit Level', exact: true }).click();
  await page.getByRole('spinbutton').fill('0.8');
  await page.getByRole('spinbutton').press('Enter');
  await page.locator('#editor').getByRole('button', { name: 'Done', exact: true }).click();
  await ready(page);
  const studioDoc = await page.evaluate(() => window.odmStudio.app.state.doc);
  await appSignal(page, function editedGainQueried() {
    const events = Object.values(window.odmStudio.app.state.events).flatMap((r) => r.events);
    return events.length > 0 && events.every((e) => (e.value as { gain?: number }).gain === 0.8);
  });
  const values = await page.evaluate(() =>
    Object.values(window.odmStudio.app.state.events)
      .flatMap((r) => r.events)
      .map((e) => e.value),
  );
  expect(studioDoc).not.toEqual(oldDoc);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(oldDoc);
  await page.keyboard.press('Control+Shift+z');
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(studioDoc);
  await page.getByRole('button', { name: /^Keep work/ }).click();
  const json = await download(page, 'Download document');
  const generated = await download(page, 'Export Strudel');
  expect(JSON.parse(json)).toEqual(studioDoc);
  expect(generated).toContain('0.8');
  await page.getByRole('button', { name: 'Copy Strudel code' }).click();
  await expect(page.getByText('Strudel copied.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('0.8');
  await pictures(page, 'keep');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await page.getByLabel('Strudel program').fill('// pending paste draft');
  await page.getByRole('button', { name: 'Lichen', exact: true }).click();
  await page.getByRole('button', { name: 'Keep current', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Replace current work?' })).toBeHidden();
  await expect(page.getByLabel('Strudel program')).toHaveValue('// pending paste draft');
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(studioDoc);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^Keep work/ }).click();
  await page.getByLabel('Document file').setInputFiles({
    name: 'piece.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(oldDoc)),
  });
  await expect(page.getByRole('dialog', { name: 'Replace current work?' })).toBeVisible();
  await pictures(page, 'replace');
  await page.getByRole('button', { name: 'Keep current', exact: true }).click();
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(studioDoc);
  for (const text of ['{', '{"version":99,"body":[]}', '{"version":2,"body":[{}]}']) {
    await page
      .getByLabel('Document file')
      .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(page.getByRole('dialog')).toContainText('Could not open document');
    expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(studioDoc);
  }
  await page
    .getByLabel('Document file')
    .setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await appSignal(page, function reopenedWithoutHistory() {
    return window.odmStudio.app.canPlay && !window.odmStudio.app.editor!.canUndo;
  });
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(studioDoc);
  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(studioDoc);
  expect(await page.evaluate(() => window.odmStudio.app.state.playing)).toBe(false);
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await page.getByLabel('Strudel program').fill(generated);
  await page.getByRole('button', { name: 'Import program', exact: true }).click();
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await appSignal(
    page,
    function generatedProgramRestored(code) {
      return window.odmStudio.app.canPlay && window.odmStudio.app.state.source === code;
    },
    generated,
  );
  await ready(page);
  expect(
    await page.evaluate(() =>
      Object.values(window.odmStudio.app.state.events)
        .flatMap((r) => r.events)
        .map((e) => e.value),
    ),
  ).toEqual(values);
});

test('About and source links match the legal notice and the pinned packages; examples and import notes stay available', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
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
  await expect(about).toContainText('AGPL');
  const licences = await page.request.get('/licenses.txt');
  expect(licences.ok()).toBe(true);
  expect(await licences.text()).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
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
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await page.getByLabel('Strudel program').fill('// my paste draft');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
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
  await page.getByRole('button', { name: 'Edit Level', exact: true }).click();
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
  await appSignal(page, () => !!document.querySelector('[data-practice-ready="true"]'));
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
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await page.getByLabel('Strudel program').fill('// practice paste draft');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .locator('.lane-label:not([data-setting])')
    .filter({ has: page.locator('strong', { hasText: /^hh$/ }) })
    .click();
  await page.getByRole('button', { name: 'Edit Level', exact: true }).click();
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
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => window.odmStudio.app.state.playing);
  // Help cancellation and exiting at the first step preserve the same draft too.
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Close help', exact: true }).click();
  expect(await page.evaluate(() => window.odmStudio.app.state.playing)).toBe(true);
  await expect(input).toHaveValue('// my unfinished draft');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await appSignal(page, () => !!document.querySelector('[data-practice-ready="true"]'));
  await expect(guide).toContainText('Make it move');
  await page.getByRole('button', { name: 'End practice', exact: true }).click();
  await expect(input).toHaveValue('// my unfinished draft');
  // Cancel precisely while Studio awaits loop setup, then release that work.
  // A late continuation must never load Kiln into the restored work session.
  await page.evaluate(() => {
    const runtime = window.odmStudio;
    const original = runtime.setLoop;
    const holder = window as typeof window & {
      parityReleaseLoop?: () => void;
      parityLoopDone?: boolean;
    };
    runtime.setLoop = async (loop) => {
      runtime.setLoop = original;
      await original.call(runtime, loop);
      await new Promise<void>((resolve) => {
        holder.parityReleaseLoop = () => {
          resolve();
        };
      });
      holder.parityLoopDone = true;
    };
  });
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await page.waitForFunction(
    () =>
      typeof (window as typeof window & { parityReleaseLoop?: unknown }).parityReleaseLoop ===
      'function',
  );
  await page.getByRole('button', { name: 'Close help', exact: true }).click();
  await page.evaluate(() =>
    (window as typeof window & { parityReleaseLoop: () => void }).parityReleaseLoop(),
  );
  await page.waitForFunction(
    () => (window as typeof window & { parityLoopDone?: boolean }).parityLoopDone,
  );
  await expect(input).toHaveValue('// my unfinished draft');
  await expect(page.getByRole('dialog', { name: 'Replace current work?' })).toBeHidden();
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(before.doc);
  expect(await page.evaluate(() => localStorage.getItem('odm:recovery'))).toBe(before.recovery);
  await page.locator('#editor').getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await expect(page.getByLabel('Strudel program')).toHaveValue('// my paste draft');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  // Kiln practice uses the same setting id and kind as the visitor's own Kiln.
  await page
    .locator('.lane-label:not([data-setting])')
    .filter({ has: page.locator('strong', { hasText: /^hh$/ }) })
    .click();
  await page.getByRole('button', { name: 'Edit Level', exact: true }).click();
  await page.getByRole('spinbutton').fill('0.91');
  const constantDoc = await page.evaluate(async () => {
    const runtime = window.odmStudio;
    await runtime.setLoop({ from: 0, to: 1 });
    const engine = runtime.app.engine!;
    const original = engine.setLoop.bind(engine);
    const holder = window as typeof window & {
      parityConstant?: Element | null;
      parityEngineLoops?: ({ from: number; to: number } | null)[];
    };
    holder.parityConstant = document.querySelector('#editor input[type="number"]');
    holder.parityEngineLoops = [];
    engine.setLoop = async (loop) => {
      await original(loop);
      holder.parityEngineLoops!.push(loop ? { ...loop } : null);
    };
    return runtime.app.state.doc;
  });
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await appSignal(page, () => !!document.querySelector('[data-practice-ready="true"]'));
  await expect(guide).toContainText('Make it move');
  for (let step = 0; step < 5; step++)
    await guide.getByRole('button', { name: 'Skip step', exact: true }).click();
  await page
    .locator('.lane-label:not([data-setting])')
    .filter({ has: page.locator('strong', { hasText: /^hh$/ }) })
    .click();
  await page.getByRole('button', { name: 'Edit Level', exact: true }).click();
  await page.getByRole('spinbutton').fill('0.33');
  await page.getByRole('spinbutton').press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor')).toBeHidden();
  await expect(guide).toBeVisible();
  await page.getByRole('button', { name: 'Edit Level', exact: true }).click();
  await page.getByRole('spinbutton').fill('0.35');
  await page.getByRole('spinbutton').press('Enter');
  await guide.getByRole('button', { name: 'Finish practice', exact: true }).click();
  await expect(guide).toBeHidden();
  await expect(page.getByRole('spinbutton')).toHaveValue('0.91');
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { parityConstant?: Element | null }).parityConstant ===
        document.querySelector('#editor input[type="number"]'),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(constantDoc);
  await page.waitForFunction(() =>
    (
      window as typeof window & { parityEngineLoops?: ({ from: number; to: number } | null)[] }
    ).parityEngineLoops?.some((loop) => loop?.from === 0 && loop.to === 1),
  );
  expect(await page.evaluate(() => window.odmStudio.transport.getSnapshot().loop)).toEqual({
    from: 0,
    to: 1,
  });
  await page.getByRole('spinbutton').press('Enter');
  expect(await page.evaluate(() => window.odmStudio.app.exportStrudel())).toContain('0.91');
});

test('saved pre-Studio dubstep document restores at home with its edited cutoff', async ({
  page,
}) => {
  const payload = await readFile('tests/fixtures/legacy-recovery.json', 'utf8');
  await page.addInitScript((payload) => localStorage.setItem('odm:recovery', payload), payload);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?inspect&a=test-card&b=');
  await ready(page);
  expect(await page.evaluate(() => window.odmStudio.app.state.doc)).toEqual(JSON.parse(payload));
  await expect(page.locator('.lane-label:not([data-setting])')).toHaveCount(13);
  await page
    .locator('.lane-label')
    .filter({ has: page.locator('strong', { hasText: /^darkPad$/ }) })
    .click();
  await page.getByRole('button', { name: 'Edit Cutoff', exact: true }).click();
  await expect(page.getByRole('spinbutton')).toHaveValue('910');
  expect(await page.evaluate(() => window.odmStudio.app.engine)).toBeNull();
  expect(await page.evaluate(() => window.odmStudio.app.state.playing)).toBe(false);
});

test('old Studio link replaces itself at home with its layout, query and hash intact', async ({
  page,
}) => {
  const response = await page.request.get('/studio.html');
  const html = await response.text();
  expect(html).toContain('location.replace');
  expect(html).toContain('http-equiv="refresh"');
  expect(html).not.toMatch(/<script[^>]+src=|modulepreload|audio/i);
  await page.goto('/studio.html?a=loom&b=&theme=riso#saved-layout');
  await expect(page).toHaveURL(/\/\?a=loom&b=&theme=riso#saved-layout$/);
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'riso');
  await expect(page.locator('[data-region="stage-a"] h2')).toHaveText('Loom');
  await expect(page.locator('[data-region="stage-b"] canvas')).toHaveCount(0);
});

test('Keep work exports remain usable with denied, quota and corrupt browser storage', async ({
  browser,
}) => {
  for (const failure of ['denied', 'quota', 'corrupt']) {
    const context = await browser.newContext({
      baseURL: process.env.ODM_URL,
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();
    try {
      await page.addInitScript((failure) => {
        if (failure === 'corrupt') localStorage.setItem('odm:recovery', '{');
        if (failure === 'denied')
          Storage.prototype.getItem = () => {
            throw Error('denied');
          };
        if (failure !== 'corrupt')
          Storage.prototype.setItem = () => {
            throw Error('quota');
          };
      }, failure);
      await page.goto(url);
      await ready(page);
      await page.getByRole('button', { name: /^Keep work/ }).click();
      if (failure !== 'corrupt')
        await expect(page.getByRole('dialog')).toContainText('could not be saved');
      expect(JSON.parse(await download(page, 'Download document')).version).toBe(2);
      expect(await download(page, 'Export Strudel')).toContain('s(');
    } finally {
      await context.close();
    }
  }
});
