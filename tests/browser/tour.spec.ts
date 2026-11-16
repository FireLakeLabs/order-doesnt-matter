import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { test, openProgram, play, selectNode, scoreReady } from './helpers';

async function start(page: import('@playwright/test').Page) {
  await page.locator('#take-tour').click();
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.locator('#tour-guide')).toBeVisible();
  await expect(page.locator('#driver-popover-title')).toContainText('1 of 8');
}
async function lesson(page: import('@playwright/test').Page, n: number) {
  await expect(page.locator('#driver-popover-title')).toContainText(`${n} of 8`);
  expect(
    await page.locator('#driver-popover-title').evaluate((n) => {
      const title = n.getBoundingClientRect(),
        host = document.querySelector('#tour-instructions')!.getBoundingClientRect();
      return title.top >= host.top && title.bottom <= host.bottom;
    }),
  ).toBe(true);
}
async function pin(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
}
async function geometry(page: import('@playwright/test').Page, target: string) {
  const result = await page.evaluate((target) => {
    const selectors = ['#stop', '#tour-end', target];
    return selectors.map((selector) => {
      const node = document.querySelector(selector)!,
        r = node.getBoundingClientRect();
      return {
        selector,
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
        fits: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      };
    });
  }, target);
  for (const r of result) {
    expect(r.fits, JSON.stringify(r)).toBe(true);
    expect(r.hit, JSON.stringify(r)).toBe(true);
    expect(r.h).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.ODM_TOUR_CAPTURE_DIR) {
    await mkdir(process.env.ODM_TOUR_CAPTURE_DIR, { recursive: true });
    await writeFile(
      `${process.env.ODM_TOUR_CAPTURE_DIR}/geometry.jsonl`,
      JSON.stringify({ viewport: page.viewportSize(), target, result }) + '\n',
      { flag: 'a' },
    );
  }
  return result;
}
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 390, height: 667 },
]) {
  test(`practice completes eight actual lessons at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openProgram(page);
    await start(page);
    await page.getByRole('button', { name: 'Kiln', exact: true }).click();
    await lesson(page, 2);
    if (viewport.width === 1440) {
      await play(page);
      await lesson(page, 3);
      await page.locator('#stop').click();
    } else {
      await page.getByRole('button', { name: 'Continue without playback' }).click();
      await lesson(page, 3);
    }
    await pin(page, 'Section 2');
    await lesson(page, 4);
    await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
    const exact = page.getByRole('spinbutton', { name: 'bass › lpf exact value' });
    await geometry(page, '#editor input[type=number]');
    if (process.env.ODM_TOUR_CAPTURE_DIR)
      await writeFile(
        `${process.env.ODM_TOUR_CAPTURE_DIR}/${viewport.width}x${viewport.height}-cutoff.png`,
        await page.screenshot(),
      );
    await exact.fill('800');
    await exact.press('Enter');
    await lesson(page, 5);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.locator('#undo').click();
    await lesson(page, 6);
    // Back revisits already completed actions, without undoing, editing or auto-advancing.
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await lesson(page, 5);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await lesson(page, 6);
    await pin(page, 'Section 3');
    await page.locator('#follow').click();
    await lesson(page, 7);
    for (const id of ['now-enlarge', 'watch']) {
      await page.locator(`#${id}`).click();
      await expect(page.locator('#preview-expanded')).toBeVisible();
      await expect(page.locator('#preview-close')).toBeFocused();
      await geometry(page, '#preview-close');
      await expect(page.locator('.driver-layer')).toHaveCount(0);
      const bounds = await page.evaluate(() => ({
        preview: document.querySelector('#preview-expanded')!.getBoundingClientRect().bottom,
        guide: document.querySelector('#tour-guide')!.getBoundingClientRect().top,
      }));
      if (viewport.width === 390) expect(bounds.preview).toBeLessThanOrEqual(bounds.guide);
      await page.screenshot({ path: info.outputPath(`${id}-${viewport.height}.png`) });
      if (process.env.ODM_TOUR_CAPTURE_DIR) {
        await mkdir(process.env.ODM_TOUR_CAPTURE_DIR, { recursive: true });
        await writeFile(
          `${process.env.ODM_TOUR_CAPTURE_DIR}/${viewport.width}x${viewport.height}-${id}.png`,
          await page.screenshot(),
        );
      }
      await page.locator('#preview-close').click();
      await expect(page.locator(`#${id}`)).toBeFocused();
    }
    await lesson(page, 8);
    await page.locator('#keep').click();
    for (const [id, name] of [
      ['download-document', 'odm-practice-kiln.json'],
      ['export-strudel', 'odm-practice-kiln.strudel'],
    ]) {
      const download = page.waitForEvent('download');
      await page.locator(`#${id}`).click();
      expect((await download).suggestedFilename()).toBe(name);
    }
    await geometry(page, '#download-document');
    if (process.env.ODM_TOUR_CAPTURE_DIR)
      await writeFile(
        `${process.env.ODM_TOUR_CAPTURE_DIR}/${viewport.width}x${viewport.height}-keep.png`,
        await page.screenshot(),
      );
    await page.screenshot({ path: info.outputPath(`keep-${viewport.height}.png`) });
    await page.getByRole('button', { name: 'Finish practice', exact: true }).click();
    await expect(page.locator('#tour-guide')).toBeHidden();
    await expect(page.locator('#take-tour')).toBeFocused();
    expect(
      await page.evaluate(() => ({
        practice: window.odmApp.practice,
        doc: window.odmApp.state.doc,
        playing: window.odmApp.state.playing,
      })),
    ).toEqual({ practice: false, doc: null, playing: false });
  });
}

test('practice parks original mounted drafts, histories, pin, solo, paste, recovery and focus', async ({
  page,
}) => {
  await openProgram(page, { example: 'Kiln' });
  await pin(page, 'Section 2');
  await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  const field = page.getByRole('spinbutton', { name: 'bass › lpf exact value' });
  await field.fill('900');
  await field.press('Enter');
  await page.locator('#undo').click();
  await page.locator('#redo').click();
  await field.fill('950');
  await field.press('Enter');
  await page.locator('#undo').click();
  await field.fill('850');
  await page.evaluate(() => {
    const app = window.odmApp;
    app.solo(app.state.rows.find((row) => row.name === 'bass')!.id);
    (document.querySelector('#source') as HTMLTextAreaElement).value = 'different unloaded paste';
    Object.assign(window, {
      tourOriginal: {
        app,
        editor: app.editor,
        doc: app.state.doc,
        state: app.state,
        field: document.querySelector('#editor input[type="number"]'),
        recovery: localStorage.getItem('odm:recovery'),
      },
    });
  });
  await start(page);
  await page.getByRole('button', { name: 'Kiln', exact: true }).click();
  await lesson(page, 2);
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => {
      const original = (
        window as unknown as {
          tourOriginal: {
            app: unknown;
            editor: unknown;
            doc: unknown;
            state: typeof window.odmApp.state;
            field: unknown;
            recovery: string;
          };
        }
      ).tourOriginal;
      const app = window.odmApp;
      return {
        controller: app === original.app,
        editor: app.editor === original.editor,
        doc: app.state.doc === original.doc,
        field: document.querySelector('#editor input[type="number"]') === original.field,
        redo: app.editor!.canRedo,
        undo: app.editor!.canUndo,
        solo: app.state.solo === original.state.solo,
        selected: app.state.selected === original.state.selected,
        follow: app.state.follow,
        playing: app.state.playing,
        recovery: localStorage.getItem('odm:recovery') === original.recovery,
      };
    }),
  ).toEqual({
    controller: true,
    editor: true,
    doc: true,
    field: true,
    redo: true,
    undo: true,
    solo: true,
    selected: true,
    follow: false,
    playing: false,
    recovery: true,
  });
  await expect(field).toHaveValue('850');
  await expect(page.locator('#source')).toHaveValue('different unloaded paste');
  await expect(page.locator('#take-tour')).toBeFocused();
  // Cancel also preserves the pre-blur draft.
  await page.locator('#take-tour').click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(field).toHaveValue('850');
  await page.getByRole('button', { name: 'Edit as source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Source text', exact: true }).fill('unfinished (');
  await start(page);
  await page.locator('#tour-end').click();
  await expect(page.getByRole('textbox', { name: 'Source text', exact: true })).toHaveValue(
    'unfinished (',
  );
});

test('practice reload never reads/adopts or overwrites an unadopted recovery candidate', async ({
  page,
}) => {
  await openProgram(page, { source: 's("sine").gain(.15)' });
  const saved = await page.evaluate(() => localStorage.getItem('odm:recovery'));
  await page.reload();
  await start(page);
  await page.getByRole('button', { name: 'Kiln', exact: true }).click();
  await lesson(page, 2);
  expect(await page.evaluate(() => window.odmApp.retention.candidate)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('odm:recovery'))).toBe(saved);
  await page.reload();
  await expect(page.locator('#tour-guide')).toBeHidden();
  expect(await page.evaluate(() => window.odmApp.practice)).toBe(false);
  await page.getByRole('button', { name: 'Recover last work' }).click();
  await scoreReady(page);
  expect(await page.evaluate(() => window.odmApp.state.source)).toBe('');
  expect(await page.evaluate(() => window.odmApp.downloadDocument())).toBe(saved);
});

test('practice pauses missing targets and owns Escape from an enlarged preview', async ({
  page,
}) => {
  await openProgram(page);
  await start(page);
  await page.evaluate(() => document.querySelector('#examples button')!.remove());
  await expect(page.locator('#tour-paused')).toBeVisible();
  await page.locator('#tour-retry').click();
  await expect(page.locator('#tour-paused')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tour-guide')).toBeHidden();
  await page.reload();
  await start(page);
  await page.getByRole('button', { name: 'Kiln', exact: true }).click();
  await lesson(page, 2);
  await page.locator('#now-enlarge').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#preview-expanded')).not.toBeVisible();
  await expect(page.locator('#tour-guide')).toBeHidden();
  await expect(page.locator('#take-tour')).toBeFocused();
});

test('practice entry waits for submitted source validation, cancels, and keeps validation errors', async ({
  page,
}) => {
  await openProgram(page, { example: 'Kiln' });
  await pin(page, 'Section 2');
  await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  await page.getByRole('button', { name: 'Edit as source', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'Source text', exact: true });
  await source.fill('.lpf(850)');
  await page.evaluate(() => {
    const editor = window.odmApp.editor!,
      ask = editor.ask.bind(editor),
      settle = editor.settle.bind(editor);
    // Keep the cancelled attempt finishing after the submitted edit is ready.
    editor.settle = async () => {
      editor.settle = settle;
      const ok = await settle();
      await new Promise<void>((resolve) =>
        Object.assign(window, { releaseCancelledPreparation: resolve }),
      );
      return ok;
    };
    editor.ask = async (...args) => {
      editor.ask = ask;
      await new Promise<void>((resolve) => Object.assign(window, { releaseSource: resolve }));
      return ask(...args);
    };
  });
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.locator('#take-tour').click();
  await page.locator('#tour-start').click();
  await expect(page.locator('#tour-preparing')).toContainText('Settling');
  expect(await page.evaluate(() => window.odmApp.practice)).toBe(false);
  await page.locator('#tour-cancel').click();
  await page.evaluate(() => (window as unknown as { releaseSource: () => void }).releaseSource());
  // settle finishes only after the released source validation and its edit finish.
  // Observe that barrier before checking the resulting editor message.
  await page.waitForFunction(
    () =>
      !!(window as unknown as { releaseCancelledPreparation: unknown }).releaseCancelledPreparation,
  );
  await expect(
    page.getByText('Applied. This is now editable in its own editor.', { exact: true }),
  ).toBeVisible();
  await page.locator('#take-tour').click();
  await page.locator('#tour-start').click();
  await lesson(page, 1);
  await page.evaluate(() =>
    (
      window as unknown as { releaseCancelledPreparation: () => void }
    ).releaseCancelledPreparation(),
  );
  expect(await page.evaluate(() => window.odmApp.practice)).toBe(true);
  await page.locator('#tour-end').click();
  await expect(source).toHaveValue('.lpf(850)');
  await source.fill('unfinished (');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(
    page.locator('#editor .editor-error').filter({ hasText: /./ }).first(),
  ).toBeVisible();
  await page.locator('#take-tour').click();
  await page.locator('#tour-start').click();
  await expect(page.locator('#tour-preparing')).toContainText('Could not settle');
  await page.locator('#tour-cancel').click();
  await expect(source).toHaveValue('unfinished (');
});

test('practice is usable with denied storage and a late rejected playback cannot leak on exit', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw Error('denied');
      },
    });
  });
  await openProgram(page);
  await start(page);
  await page.getByRole('button', { name: 'Kiln', exact: true }).click();
  await lesson(page, 2);
  await play(page);
  await lesson(page, 3);
  await page.locator('#stop').click();
  await page.evaluate(() => {
    const engine = window.odmApp.engine!,
      original = engine.play.bind(engine);
    engine.play = async () =>
      new Promise((_resolve, reject) =>
        Object.assign(window, {
          rejectTourPlay: () => {
            engine.play = original;
            reject(Error('late practice failure'));
          },
        }),
      );
    void window.odmApp.play();
  });
  await page.waitForFunction(
    () => !!(window as unknown as { rejectTourPlay: unknown }).rejectTourPlay,
  );
  await page.locator('#tour-end').click();
  await page.evaluate(() => (window as unknown as { rejectTourPlay: () => void }).rejectTourPlay());
  await expect(page.locator('#message')).toBeEmpty();
  expect(
    await page.evaluate(() => ({
      doc: window.odmApp.state.doc,
      playing: window.odmApp.state.playing,
    })),
  ).toEqual({ doc: null, playing: false });
  await start(page);
  await page.evaluate(() => {
    const file = new File(['{'], 'practice.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      value: () =>
        new Promise((_resolve, reject) => {
          Object.assign(window, { rejectPracticeFile: () => reject(Error('late file failure')) });
        }),
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>('#document-file')!;
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  });
  await page.locator('#tour-end').click();
  await start(page);
  await page.evaluate(async () => {
    (window as unknown as { rejectPracticeFile: () => void }).rejectPracticeFile();
    await Promise.resolve();
    await Promise.resolve();
  });
  await expect(page.locator('#load-error')).toBeEmpty();
  await page.locator('#about').click();
  await page.evaluate(() => {
    Object.assign(window, {
      aboutClosed: new Promise<void>((resolve) =>
        document.querySelector('#about-dialog')!.addEventListener('close', () => resolve(), {
          once: true,
        }),
      ),
    });
  });
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as { aboutClosed: Promise<void> }).aboutClosed);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#take-tour')).toBeFocused();
});

async function keyboardTo(page: import('@playwright/test').Page, selector: string) {
  // Choose direction only; focus moves entirely through trusted native Tab presses.
  const moves = await page.evaluate((selector) => {
    const all = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button,input,textarea,select,summary,a[href],[tabindex="0"]',
      ),
    ).filter(
      (n) =>
        n.tabIndex >= 0 &&
        !n.matches(':disabled,[hidden]') &&
        n.getClientRects().length > 0 &&
        !n.closest('[hidden],dialog:not([open])'),
    );
    const target = document.querySelector(selector)!,
      from = all.indexOf(document.activeElement as HTMLElement),
      to = all.indexOf(target as HTMLElement);
    if (to < 0) throw Error(`No keyboard target ${selector}`);
    const forward = (to - from + all.length) % all.length,
      back = (from - to + all.length) % all.length;
    return { key: forward <= back ? 'Tab' : 'Shift+Tab', count: all.length + 5 };
  }, selector);
  for (let n = 0; n < moves.count; n++) {
    if (
      await page.evaluate(
        (selector) => document.activeElement === document.querySelector(selector),
        selector,
      )
    )
      break;
    await page.keyboard.press(moves.key);
  }
  await expect(page.locator(selector).first()).toBeFocused();
}
test('practice completes through native keyboard navigation with editable arrows and single Escape', async ({
  page,
}) => {
  await openProgram(page);
  await keyboardTo(page, '#take-tour');
  await page.keyboard.press('Enter');
  await expect(page.locator('#tour-start')).toBeFocused();
  await page.keyboard.press('Enter');
  await lesson(page, 1);
  await keyboardTo(page, '#examples button');
  await page.keyboard.press('Enter');
  await lesson(page, 2);
  await keyboardTo(page, '#tour-skip');
  await page.keyboard.press('Enter');
  await lesson(page, 3);
  const first = await page
    .locator('[data-section]')
    .filter({ hasText: 'Section 2' })
    .getAttribute('data-section');
  await keyboardTo(page, `[data-section="${first}"]`);
  await page.keyboard.press('Enter');
  await lesson(page, 4);
  const cutoff = await page
    .locator('tr')
    .filter({ has: page.locator('th[data-editor-target]', { hasText: 'bass' }) })
    .locator('[data-control="lpf"]')
    .getAttribute('data-editor-target');
  await keyboardTo(page, `[data-editor-target="${cutoff}"]`);
  await page.keyboard.press('Enter');
  await keyboardTo(page, '#editor input[type=number]');
  await page.keyboard.press('ArrowUp');
  await lesson(page, 5);
  await keyboardTo(page, '.editor-done');
  await page.keyboard.press('Enter');
  await keyboardTo(page, '#undo');
  await page.keyboard.press('Enter');
  await lesson(page, 6);
  const next = await page
    .locator('[data-section]')
    .filter({ hasText: 'Section 3' })
    .getAttribute('data-section');
  await keyboardTo(page, `[data-section="${next}"]`);
  await page.keyboard.press('Enter');
  await keyboardTo(page, '#follow');
  await page.keyboard.press('Enter');
  await lesson(page, 7);
  for (const id of ['now-enlarge', 'watch']) {
    await keyboardTo(page, `#${id}`);
    await page.keyboard.press('Enter');
    await expect(page.locator('#preview-close')).toBeFocused();
    await page.keyboard.press('Enter');
  }
  await lesson(page, 8);
  await keyboardTo(page, '.driver-popover-next-btn');
  await page.keyboard.press('Enter');
  await expect(page.locator('#take-tour')).toBeFocused();
});

test('practice preserves parked instrument, values, signal and rhythm forms, and the exact empty welcome initiator', async ({
  page,
}) => {
  for (const fixture of [
    { source: 's("sine").gain(".1 .2")', breadcrumb: ['Instrument 1', 'gain'] },
    { source: 's("sine").lpf(sine.range(200,2000))', breadcrumb: ['Instrument 1', 'lpf'] },
    { source: 'note("c3 e3")', breadcrumb: ['Instrument 1', 'Rhythm'] },
    { source: 's("sine")', breadcrumb: ['Instrument 1'] },
  ]) {
    await openProgram(page, { source: fixture.source });
    await selectNode(page, { breadcrumb: fixture.breadcrumb });
    const input = page
      .locator('#editor input:not([type=range]):not([type=checkbox]):visible')
      .first();
    await input.fill('845');
    await page.evaluate(() => {
      const host = document.querySelector('#editor')!,
        field = Array.from(
          host.querySelectorAll('input:not([type=range]):not([type=checkbox])'),
        ).find((n) => n.getClientRects().length)!;
      Object.assign(window, { parkedForm: { host, field, doc: window.odmApp.state.doc } });
    });
    await start(page);
    await page.locator('#tour-end').click();
    await expect(input).toHaveValue('845');
    expect(
      await page.evaluate(() => {
        const saved = (
          window as unknown as { parkedForm: { host: Element; field: Element; doc: unknown } }
        ).parkedForm;
        return (
          saved.host === document.querySelector('#editor') &&
          saved.host.contains(saved.field) &&
          saved.doc === window.odmApp.state.doc
        );
      }),
    ).toBe(true);
  }
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const welcome = page.locator('.welcome [data-take-tour]');
  await welcome.click();
  await page.locator('#tour-start').click();
  await lesson(page, 1);
  await page.locator('#tour-end').click();
  await expect(welcome).toBeFocused();
});

test('practice uses load/play/edit failure outcomes and offers stopped continuation', async ({
  page,
}) => {
  await openProgram(page);
  await start(page);
  await page.locator('#source').fill('invalid (');
  await page.locator('#load').click();
  await expect(page.locator('#load-error')).not.toBeEmpty();
  await lesson(page, 1);
  await page.getByRole('button', { name: 'Kiln', exact: true }).click();
  await lesson(page, 2);
  await play(page);
  await lesson(page, 3);
  await pin(page, 'Section 2');
  await lesson(page, 4);
  await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  await page.evaluate(() => {
    const engine = window.odmApp.engine!,
      original = engine.play.bind(engine);
    engine.play = async () => {
      engine.play = original;
      throw Error('Practice edit rejection');
    };
  });
  const field = page.getByRole('spinbutton', { name: 'bass › lpf exact value' });
  await field.fill('800');
  await field.press('Enter');
  await expect(page.locator('#editor-status')).toContainText('Change failed');
  await lesson(page, 4);
  await field.fill('900');
  await field.press('Enter');
  await lesson(page, 5);
  await page.locator('#tour-end').click();
  await start(page);
  await page.getByRole('button', { name: 'Kiln', exact: true }).click();
  await lesson(page, 2);
  await page.evaluate(() => {
    const engine = window.odmApp.engine!,
      original = engine.play.bind(engine);
    engine.play = async () => {
      engine.play = original;
      throw Error('Practice playback rejection');
    };
  });
  await page.locator('#play').click();
  await expect(page.locator('#message')).toContainText('Practice playback rejection');
  await lesson(page, 2);
  await page.locator('#tour-skip').click();
  await lesson(page, 3);
  await page.locator('#tour-end').click();
});

test('practice restores the Now List disclosure and editor return origin', async ({ page }) => {
  await openProgram(page, { example: 'Kiln' });
  await page.locator('#live .live-list-disclosure > summary').click();
  const origin = page.locator('#live .live-instrument').filter({ hasText: 'bass' }).first();
  await origin.click();
  await start(page);
  await page.locator('#tour-end').click();
  await expect(page.locator('#live .live-list-disclosure')).toHaveAttribute('open', '');
  await page.locator('#editor').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(origin).toBeFocused();
});
