import { expect, test, type Locator } from '@playwright/test';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { instruments } from '../../src/document';
import { openProgram, play, scoreReady, selectNode, waitForPending, appSignal } from './helpers';
import type {} from '../../src/app/main';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
test('Phase 2: ten editors, one silent video', async ({ browser, request }) => {
  test.skip(process.env.ODM_BROWSER_MODE !== 'demo', 'Opt-in only: npm run demo');
  test.skip(!!process.env.CI, 'Local music and uncommitted recordings only');
  // Deliberate viewing holds belong only to this optional recording. The default
  // suite never collects this file, creates its context, or pays these holds.
  test.setTimeout(120000);
  let online = false;
  try {
    online = (
      await request.get(
        'https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json',
        { timeout: 6500 },
      )
    ).ok();
  } catch {
    /* Offline recording retains the interface's honest sound states. */
  }
  const dir = 'test-results/demo';
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/captions.txt`, '');
  console.log(
    `DEMO: ${online ? 'online (sample hosts allowed)' : 'offline (sample hosts blocked)'}; video has no audio; ${dir}/`,
  );
  const size = { width: 1440, height: 900 };
  const context = await browser.newContext({
    baseURL: process.env.ODM_URL,
    viewport: size,
    recordVideo: { dir, size },
  });
  const page = await context.newPage();
  const images: string[] = [],
    captions: string[] = [];
  const limitations: { step: number; reason: string; caption: string }[] = [];
  const selectedBass = () =>
    page.evaluate(() => {
      const state = window.odmApp.state;
      const bass = state.rows.find((r) => r.name === 'bass')!;
      return state.events[bass.id].events
        .filter((e) => e.hasOnset && e.part[0] >= state.fromCycle && e.part[0] < state.toCycle)
        .map((e) => ({ span: e.whole, value: e.value as { note?: string; cutoff?: number } }));
    });
  const editor = page.locator('#editor');
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const instrument = async (name: string) => {
    await page.getByRole('rowheader').getByText(name, { exact: true }).click();
    await expect(editor).toHaveAttribute('data-editor-kind', 'instrument');
  };
  const close = async () => {
    if (await editor.isVisible()) await page.keyboard.press('Escape');
  };
  const exact = async (field: Locator, value: string) => {
    await field.fill(value);
    await field.press('Enter');
    await waitForPending(page);
    await expect(field).toHaveValue(value);
  };
  async function caption(text: string) {
    await page.evaluate((text) => {
      let label = document.getElementById('demo-caption');
      if (!label) {
        label = document.createElement('div');
        label.id = 'demo-caption';
        label.style.cssText =
          'position:fixed;top:8px;left:25%;max-width:50%;padding:8px 14px;background:#182a35;color:#dfedec;border:1px solid #a3efd5;border-radius:8px;z-index:99;pointer-events:none;font:14px system-ui';
        document.body.append(label);
      }
      label.textContent = text;
    }, text);
  }
  async function hold(text: string) {
    await caption(text);
    await page.waitForTimeout(2000); // Viewing time, never a readiness wait.
  }
  async function step(n: number, name: string, text: string, action: () => Promise<void>) {
    await caption(`${n}. ${text}`);
    await action();
    const issues = limitations.filter((issue) => issue.step === n);
    const result = [text, ...issues.map((issue) => issue.caption)].join(' ');
    await hold(`${n}. ${result}`);
    const file = `${String(n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: `${dir}/${file}` });
    images.push(file);
    captions.push(`${n}. ${result}`);
    await writeFile(`${dir}/captions.txt`, `${captions.join('\n')}\n`);
    console.log(`DEMO ${n}: ${result}`);
    await writeFile(
      `${dir}/limitations.txt`,
      limitations.map((issue) => `${issue.step}. ${issue.reason}`).join('\n'),
    );
  }
  try {
    await openProgram(page, {
      path: 'corpus/programs/real-house-arranged.strudel',
      offline: !online,
    });
    await expect(page.getByRole('rowheader')).toHaveCount(8);
    await button('Paste Strudel').click();
    await play(page);

    await step(1, 'song', 'Select drop; Follow off and on; pin drop to edit.', async () => {
      await button('drop').first().click();
      await expect(page.locator('#window')).toHaveText('Cycles 8–16');
      await expect(button('Follow')).toHaveAttribute('aria-pressed', 'false');
      await hold('1. Selected drop · Follow off');
      await button('Follow').click();
      await expect(button('Follow')).toHaveAttribute('aria-pressed', 'true');
      await hold('1. Follow on · tracks the playing section');
      // Selecting pins the window; Stop/Play is the existing UI for starting there.
      await button('drop').first().click();
      await button('Stop').click();
      await play(page);
      await expect(page.locator('#window')).toHaveText('Cycles 8–16');
      await scoreReady(page);
    });
    await step(2, 'constant', 'Bass filter: 450 → 900; pending, then playing.', async () => {
      await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
      const field = editor.getByRole('spinbutton');
      await expect(field).toHaveValue('450');
      await page.evaluate(() => {
        const states: string[] = [];
        window.odmApp.subscribe(() =>
          states.push(document.querySelector('#editor')?.getAttribute('data-edit-state') ?? ''),
        );
        Object.defineProperty(window, 'demoPendingStates', { value: states });
      });
      await exact(field, '900');
      expect(
        await page.evaluate(
          () => (window as unknown as { demoPendingStates: string[] }).demoPendingStates,
        ),
      ).toContain('pending');
      await expect(page.locator('#editor-status')).toHaveText('Playing now');
      await appSignal(page, () =>
        window.odmApp.history.some(
          (e) => e.type === 'trigger' && (e.value as { cutoff?: number }).cutoff === 900,
        ),
      );
    });
    await step(3, 'values', 'Chords room: two values take turns each cycle.', async () => {
      await close();
      await selectNode(page, { breadcrumb: ['chords', 'room'] });
      await button('Change over time').click();
      await expect(editor).toHaveAttribute('data-editor-kind', 'values');
      await exact(editor.getByRole('spinbutton', { name: 'Value 2', exact: true }), '0.7');
      await expect(
        editor.getByRole('combobox', { name: 'Values timing', exact: true }),
      ).toHaveValue('alternate');
    });
    await step(4, 'signal', 'Hat gain: high bound 0.6; change the shape to saw.', async () => {
      await close();
      await selectNode(page, { breadcrumb: ['percussion · hh', 'gain'] });
      await exact(page.getByLabel('High bound', { exact: true }), '0.6');
      await hold('4. Hat gain · high bound 0.6');
      await editor.locator('summary').click();
      await button('saw').click();
      await waitForPending(page);
      await expect(button('saw')).toHaveAttribute('aria-pressed', 'true');
    });
    await step(5, 'rewrite', 'Kick: add fast 2, inspect the notes, then remove it.', async () => {
      await close();
      const doc = await page.evaluate(() => window.odmApp.state.doc!);
      const kick = instruments(doc).find((r) => r.name === 'kick')!;
      await selectNode(page, { nodeId: `${kick.pattern.id}:rewrites` });
      await button('Add fast').click();
      await exact(page.getByRole('spinbutton', { name: 'Time factor', exact: true }), '2');
      await expect(editor.getByRole('img', { name: 'With fast', exact: true })).toBeVisible();
      await hold('5. Kick · fast 2 · compare its real note spans');
      await button('Remove rewrite').click();
      await waitForPending(page);
      await expect(editor.locator('ol li')).toHaveCount(0);
    });
    await step(
      6,
      'instrument',
      'Mute chords in one drop only; solo bass, stop solo; rename hats.',
      async () => {
        await close();
        await instrument('chords');
        const drops = editor.getByRole('checkbox', { name: /^Plays in drop/ });
        await expect(drops).toHaveCount(2);
        await drops.first().uncheck();
        await waitForPending(page);
        await expect(drops.first()).not.toBeChecked();
        await expect(drops.last()).toBeChecked();
        await hold('6. Chords off in the first drop · still on in the second');
        await close();
        await instrument('bass');
        await editor.getByRole('checkbox', { name: 'Solo', exact: true }).check();
        await expect(page.locator('#solo-banner')).toContainText('Solo: bass');
        await hold('6. Solo bass');
        await button('Stop solo').click();
        await expect(page.locator('#solo-banner')).toBeHidden();
        await hold('6. Stop solo · the piece returns');
        await close();
        await instrument('percussion · hh');
        await editor.getByRole('textbox', { name: 'Instrument name', exact: true }).fill('hats');
        await button('Rename').click();
        await waitForPending(page);
        await expect(
          page
            .getByRole('rowheader')
            .filter({ has: page.locator('strong', { hasText: /^hats$/ }) }),
        ).toHaveCount(1);
      },
    );
    await step(
      7,
      'section',
      'Intro: 4 → 8 cycles; uncheck kick in the first drop, where it plays.',
      async () => {
        await close();
        await button('intro').click();
        await button('Edit section intro').click();
        await exact(page.getByRole('spinbutton', { name: 'Length in cycles', exact: true }), '8');
        await expect(button('intro')).toContainText('8 cycles');
        await hold('7. Intro · now eight cycles');
        await close();
        // Breakdown has no kick in this piece. Use the allowed playing section.
        await button('drop').first().click();
        await button('Edit section drop').first().click();
        const kick = editor.getByRole('checkbox', { name: 'kick', exact: true });
        await expect(kick).toBeChecked();
        await kick.uncheck();
        await waitForPending(page);
        await expect(kick).not.toBeChecked();
      },
    );
    await step(
      8,
      'rhythm',
      'Bass Boxes: change a note; split it, rest half; switch to List.',
      async () => {
        await close();
        await selectNode(page, { breadcrumb: ['bass', 'Rhythm'] });
        await button('Boxes').click();
        const before = await selectedBass();
        expect(before.length).toBeGreaterThan(0);
        await exact(page.getByLabel('Note value', { exact: true }), 'd2');
        await hold('8. Bass · first note changed to d2');
        await button('Split in 2').click();
        await page.locator('.rhythm-boxes [data-path="0"]').press('ArrowDown');
        await button('Rest').click();
        await waitForPending(page);
        await expect(page.locator('.rhythm-boxes [data-path="0.0"]')).toContainText('rest');
        await expect(page.locator('.rhythm-boxes [data-path="0.1"]')).toContainText('d2');
        await hold('8. First part split in two · first half is a rest');
        await button('List').click();
        await expect(page.locator('[data-view="List"]')).toBeVisible();
        const after = await selectedBass();
        expect(after).not.toEqual(before);
        expect(after.some((e) => String(e.value.note) === 'd2')).toBe(true);
      },
    );
    await step(9, 'source', 'Edit a setting as source, Apply 1100, then open Setup.', async () => {
      await close();
      await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
      await button('Edit as source').click();
      const field = page.getByRole('textbox', { name: 'Source text', exact: true });
      const previous = await field.inputValue();
      expect(previous).toContain('900');
      await field.fill(previous.replace('900', '1100'));
      await button('Apply').click();
      await expect(editor).toContainText('Applied.');
      await waitForPending(page);
      await hold('9. Source applied · bass filter 1100');
      const notes = await selectedBass();
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.some((e) => e.value.cutoff === 1100)).toBe(true);
      await close();
      await page.locator('.sheet-setup summary').click();
      await expect(page.locator('.sheet-setup')).toHaveAttribute('open', '');
    });
    await step(10, 'undo-stop', 'Undo three edits, then Stop.', async () => {
      const before = await page.evaluate(() => JSON.stringify(window.odmApp.state.doc));
      for (let i = 0; i < 3; i++) {
        await expect(button('Undo')).toBeEnabled();
        await button('Undo').click();
        await waitForPending(page);
      }
      expect(await page.evaluate(() => JSON.stringify(window.odmApp.state.doc))).not.toBe(before);
      await hold('10. Three edits undone');
      await button('Stop').click();
      await appSignal(page, () => !window.odmApp.state.playing);
      await expect(button('Stop')).toBeDisabled();
    });
    console.log(
      `DEMO: ten step images; ${limitations.length} interface limitations (limitations.txt); no source/API bypasses.`,
    );
  } finally {
    if (!page.isClosed()) await context.close();
    await rename(await page.video()!.path(), `${dir}/demo.webm`);
  }
  expect(images).toHaveLength(10);
  // A separate non-recording context keeps the output to ONE video. Inline PNGs
  // are local artifacts, and Playwright renders the contact sheet without deps.
  const contact = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const sheet = await contact.newPage();
    const tiles = await Promise.all(
      images.map(
        async (file, i) =>
          `<figure><img src="data:image/png;base64,${(await readFile(`${dir}/${file}`)).toString('base64')}"><figcaption>${captions[i].replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</figcaption></figure>`,
      ),
    );
    await sheet.setContent(
      `<style>body{margin:0;padding:16px;background:#0b141b;color:#dfedec;font:16px system-ui;display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}img{display:block;width:100%}figcaption{padding:8px 0}</style>${tiles.join('')}`,
    );
    await sheet
      .locator('img')
      .evaluateAll((nodes) => Promise.all(nodes.map((n) => (n as HTMLImageElement).decode())));
    await sheet.screenshot({ path: `${dir}/contact.png`, fullPage: true });
  } finally {
    await contact.close();
  }
  console.log(`DEMO: ${dir}/demo.webm (NO AUDIO), 01–10 PNGs, captions.txt, contact.png`);
});
