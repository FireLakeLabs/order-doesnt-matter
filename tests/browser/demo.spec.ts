import { isDeepStrictEqual } from 'node:util';
import { expect, test, type Locator } from '@playwright/test';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { instruments } from '../../src/document';
import {
  openProgram,
  play,
  scoreReady,
  selectNode,
  waitForPending,
  appSignal,
  swap,
} from './helpers';
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
      await expect(page.locator('#editor-status')).toHaveText('Changed');
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

test('Phase 3: eight live-view checks on the real house piece, one silent video', async ({
  browser,
  request,
}) => {
  test.skip(process.env.ODM_BROWSER_MODE !== 'demo', 'Opt-in only: npm run demo');
  test.skip(!!process.env.CI, 'Local music and uncommitted recordings only');
  test.setTimeout(120000); // Optional recording only; normal suite never collects this file.
  const dir = 'test-results/demo/phase-3';
  await mkdir(dir, { recursive: true });
  const context = await browser.newContext({
    baseURL: process.env.ODM_URL,
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  const captions: string[] = [],
    limitations: string[] = [];
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const planet = (id: string) => page.locator(`[data-live-id="${id}"]`);
  let online = false;
  try {
    online = (
      await request.get(
        'https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json',
        { timeout: 6500 },
      )
    ).ok();
  } catch {
    /* Same online probe and honest fallback as Phase 2. */
  }
  const limit = (n: number, reason: string) => limitations.push(`${n}. LIMITATION: ${reason}`);
  async function caption(text: string) {
    await page.evaluate((text) => {
      let label = document.getElementById('demo-caption');
      if (!label) {
        label = document.createElement('div');
        label.id = 'demo-caption';
        label.style.cssText =
          'position:fixed;top:72px;left:8px;max-width:90%;padding:8px 14px;background:#182a35;color:#dfedec;border:1px solid #a3efd5;border-radius:8px;z-index:99;pointer-events:none;font:14px system-ui';
      }
      // Watch is a top-layer dialog: its captions must live inside it.
      (document.querySelector('dialog[open]') ?? document.body).append(label);
      label.textContent = text;
    }, text);
  }
  async function step(n: number, text: string, reproduce: string, action: () => Promise<void>) {
    await test.step(`Phase 3 ${n}: ${text}`, async () => {
      await caption(`${n}. CHECK: ${text}`);
      try {
        await action();
      } catch (error) {
        // D33: preserve a failed assertion as evidence and attempt every later step.
        // Browser/process failures still fail when artifacts or later checks cannot run.
        limit(n, `${String(error)} Reproduce: ${reproduce}`);
      }
      const issues = limitations.filter((s) => s.startsWith(`${n}.`));
      const result = `${n}. ${issues.length ? 'LIMITATION' : 'PASS'}: ${text}${issues.length ? `\n${issues.join('\n')}` : ''}`;
      await caption(result);
      await page.screenshot({ path: `${dir}/${String(n).padStart(2, '0')}.png` });
      captions.push(result);
      await writeFile(`${dir}/captions.txt`, `${captions.join('\n')}\n`);
      await writeFile(`${dir}/limitations.txt`, `${limitations.join('\n')}\n`);
      console.log(`PHASE 3 ${result}`);
    });
  }
  const sheetState = () =>
    page.evaluate(() => {
      const s = window.odmApp.state;
      return {
        doc: s.doc,
        selected: s.selected,
        follow: s.follow,
        from: s.fromCycle,
        to: s.toCycle,
        rows: Array.from(document.querySelectorAll('tbody th[scope="row"] strong')).map(
          (n) => n.textContent,
        ),
        mutes: Array.from(document.querySelectorAll('.sheet-mute')).map((n) =>
          n.getAttribute('aria-pressed'),
        ),
      };
    });
  try {
    await step(
      1,
      'Before Play: all eight planets and their shared room are present.',
      'Load the real house piece; inspect Now before pressing Play.',
      async () => {
        if (!online)
          limit(
            1,
            'Default sample host unavailable; recording uses the Phase 2 offline fallback. Reproduce: probe the default strudel.json sample host, then Load and Play.',
          );
        await openProgram(page, {
          path: 'corpus/programs/real-house-arranged.strudel',
          offline: !online,
        });
        await button('Paste Strudel').click();
        const rows = await page.evaluate(() => window.odmApp.state.rows);
        expect(rows).toHaveLength(8);
        await expect(page.locator('[data-live-id]')).toHaveCount(rows.length);
        for (const row of rows)
          await expect(planet(row.id)).toHaveAccessibleName(
            new RegExp(row.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          );
        await expect(
          page.locator('.constellation-room').filter({ hasText: /^Room 1 ·/ }),
        ).toBeVisible();
        await expect(page.locator('.constellation path').first()).toHaveAttribute('d', /.+/);
        expect(await page.evaluate(() => window.odmApp.engine)).toBeNull();
      },
    );
    await step(
      2,
      'Play: two full cycles of planet pulses match note starts and engine triggers.',
      'Load and Play; observe the next two complete cycles in Now.',
      async () => {
        await play(page);
        if (online) {
          const sounds = await page.evaluate(() => window.odmApp.engine!.sounds());
          for (const name of ['bd', 'cp', 'hh', 'oh'])
            expect(sounds).toContainEqual({ name, state: 'ready' });
          const missing = sounds.filter((s) => s.state === 'missing');
          if (missing.length)
            limit(
              2,
              `Online sound states: ${missing.map((s) => `${s.name}: ${s.detail}`).join('; ')}. Reproduce: Load real house, Play, inspect the instrument sound states.`,
            );
        }
        const capture = await page.evaluateHandle(() => {
          const app = window.odmApp,
            from = Math.ceil(app.engine!.now()!),
            to = from + 2;
          const samples: { id: string; cycle: number; frame: number }[] = [];
          let previous = performance.now();
          function frame() {
            const cycle = app.engine!.now()!,
              clock = performance.now(),
              gap = (clock - previous) / 1000;
            previous = clock;
            if (cycle >= from && cycle < to)
              document
                .querySelectorAll<HTMLElement>('[data-lit="true"]')
                .forEach((n) => samples.push({ id: n.dataset.liveId!, cycle, frame: gap }));
            if (cycle < to) requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
          return { from, to, samples };
        });
        await appSignal(
          page,
          (to) => window.odmApp.engine!.now()! >= to,
          await capture.evaluate((c) => c.to),
        );
        const observed = await capture.evaluate((c) => ({
          ...c,
          events: window.odmApp.state.events,
          cps: window.odmApp.state.cps!,
          triggers: window.odmApp.history.filter((e) => e.type === 'trigger'),
        }));
        await capture.dispose();
        const expected = Object.entries(observed.events).flatMap(([id, r]) =>
          r.events
            .filter(
              (e) =>
                e.whole &&
                e.part[0] === e.whole[0] &&
                e.whole[0] >= observed.from &&
                e.whole[0] < observed.to,
            )
            .map((event) => ({ id, event })),
        );
        expect(expected.length).toBeGreaterThan(0);
        expect(observed.samples.length).toBeGreaterThan(0);
        for (const sample of observed.samples) {
          const tolerance = (0.15 + sample.frame) * observed.cps;
          expect(
            expected.some(
              ({ id, event }) =>
                id === sample.id && Math.abs(event.whole![0] - sample.cycle) <= tolerance,
            ),
            `pulse ${sample.id} at ${sample.cycle}`,
          ).toBe(true);
        }
        for (const { id, event } of expected) {
          expect(
            observed.samples.some(
              (s) =>
                s.id === id &&
                Math.abs(s.cycle - event.whole![0]) <= (0.15 + s.frame) * observed.cps,
            ),
            `planet onset ${id} at ${event.whole![0]}`,
          ).toBe(true);
          expect(
            observed.triggers.some(
              (t) =>
                Math.abs(t.cycle - event.whole![0]) < 1e-8 &&
                isDeepStrictEqual(t.value, event.value),
            ),
            `engine onset ${id} at ${event.whole![0]}`,
          ).toBe(true);
        }
        console.log(
          `PHASE 3 MEASURED: Now ${observed.from}–${observed.to}, ${expected.length} notes, ${observed.samples.length} pulse frames; ${online ? 'online' : 'offline'}.`,
        );
      },
    );
    await step(
      3,
      'Choose breakdown during Play; verify sit-outs after Stop; no planets overlap.',
      'Load, Play, select breakdown while the intro is playing; compare its sit-outs in Now.',
      async () => {
        await button('breakdown').click();
        await scoreReady(page);
        const absent = await page.evaluate(() => {
          const s = window.odmApp.state;
          return s.rows
            .filter(
              (r) =>
                !s.events[r.id].events.some(
                  (e) =>
                    e.whole &&
                    e.part[0] === e.whole[0] &&
                    e.whole[0] >= s.fromCycle &&
                    e.whole[0] < s.toCycle,
                ),
            )
            .map((r) => r.id);
        });
        expect(absent.length).toBeGreaterThan(0);
        const faintWhilePlaying = await page
          .locator('.constellation-planet.live-absent')
          .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.liveId!).sort());
        try {
          expect(faintWhilePlaying, 'selected section sit-outs during playback').toEqual(
            [...absent].sort(),
          );
        } catch {
          limit(
            3,
            'Selecting breakdown while playing pins the sheet but Now follows the playing section, so its sit-outs do not match the selection. Reproduce: Load real house, Play intro, click breakdown. Nearest available path: Stop after selection; the chosen section then has faint sit-outs and nonoverlapping planets (asserted).',
          );
        }
        await button('Stop').click();
        for (const id of absent) {
          await expect(planet(id)).toHaveClass(/live-absent/);
          expect(
            await planet(id).evaluate((n) => Number(getComputedStyle(n).opacity)),
          ).toBeLessThan(1);
        }
        const points = await page.locator('[data-live-id]').evaluateAll((nodes) =>
          nodes.map((n) => {
            const d = (n as HTMLElement).dataset;
            return { x: Number(d.x), y: Number(d.y), r: Number(d.r) };
          }),
        );
        for (const [i, p] of points.entries())
          for (const q of points.slice(i + 1))
            expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(p.r + q.r);
      },
    );
    await step(
      4,
      'Planet opens its editor; Escape restores focus; bass cutoff 450 → 900 reaches a trigger via the sheet.',
      'Stop; choose the first drop; Play; click the bass planet; look for a constant-setting control.',
      async () => {
        await button('drop').first().click();
        await play(page);
        const id = await page.evaluate(
          () => window.odmApp.state.rows.find((r) => r.name === 'bass')!.id,
        );
        await planet(id).click();
        await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'instrument');
        await expect(page.locator('#editor').getByRole('spinbutton')).toHaveCount(0);
        limit(
          4,
          'The bass planet opens the instrument editor, which has no constant-setting control or drill-down. Reproduce: Stop, select first drop, Play, click bass planet. Escape does restore planet focus. Nearest available path: select bass › lpf in the sheet, enter 900; engine trigger asserted.',
        );
        await page.keyboard.press('Escape');
        await expect(planet(id)).toBeFocused();
        await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
        const field = page.locator('#editor').getByRole('spinbutton');
        await expect(field).toHaveValue('450');
        await field.fill('900');
        await field.press('Enter');
        await waitForPending(page);
        await expect(field).toHaveValue('900');
        await appSignal(page, () =>
          window.odmApp.history.some(
            (e) =>
              e.type === 'trigger' &&
              (e.value as { s?: string; cutoff?: number }).s === 'sawtooth' &&
              (e.value as { cutoff?: number }).cutoff === 900,
          ),
        );
        await page.keyboard.press('Escape');
        await page.locator('#live').scrollIntoViewIfNeeded();
      },
    );
    await step(
      5,
      'Sheet mute: kick planet is muted; no bd trigger for a full cycle after the swap.',
      'In the playing drop, press Mute kick in the sheet and observe the next complete cycle.',
      async () => {
        const id = await page.evaluate(
          () => window.odmApp.state.rows.find((r) => r.name === 'kick')!.id,
        );
        await swap(page, () => button('Mute kick').click());
        await waitForPending(page);
        await planet(id).scrollIntoViewIfNeeded();
        await expect(planet(id)).toHaveClass(/live-hollow/);
        await expect(planet(id)).toHaveAccessibleName(/muted/);
        const boundary = await page.evaluate(() => {
          const b = window.odmApp.history.findLast((e) => e.type === 'swapped')!;
          if (b.type !== 'swapped') throw Error('No swap acknowledgement');
          return Math.ceil(b.cycle);
        });
        await appSignal(page, (to) => window.odmApp.engine!.now()! >= to, boundary + 1);
        const notes = await page.evaluate(
          ([from, to]) =>
            window.odmApp.history.filter(
              (e) => e.type === 'trigger' && e.cycle >= from && e.cycle < to,
            ),
          [boundary, boundary + 1],
        );
        expect(notes.length).toBeGreaterThan(0);
        expect(
          notes.some((e) => e.type === 'trigger' && (e.value as { s?: string }).s === 'bd'),
        ).toBe(false);
        console.log(
          `PHASE 3 MEASURED: mute window ${boundary}–${boundary + 1}, ${notes.length} other triggers, zero bd.`,
        );
      },
    );
    const beforeWatch = await sheetState();
    await step(
      6,
      'Watch: previous turn fades, current is 1, both next turns ≥ 0.4; gate onsets match triggers.',
      'After muting kick, open Watch during the drop; observe two complete cycles.',
      async () => {
        await button('Watch').click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await caption('6. CHECK: Watch turn opacity and two cycles of gate crossings.');
        await appSignal(page, () => {
          const v = window.odmSpiral,
            t = Math.floor(v.cycle);
          return (
            v.cycle > t + 0.1 &&
            v.cycle < t + 0.9 &&
            [-1, 0, 1, 2].every((offset) => v.marks.some((m) => m.turn === t + offset))
          );
        });
        const opacity = await page.evaluate(() => {
          const v = window.odmSpiral;
          return { now: v.cycle, marks: v.marks };
        });
        for (const offset of [-1, 0, 1, 2]) {
          const marks = opacity.marks.filter((m) => m.turn === Math.floor(opacity.now) + offset);
          expect(marks.length).toBeGreaterThan(0);
          expect(
            marks.every((m) =>
              offset === -1
                ? m.opacity > 0 && m.opacity < 1
                : offset === 0
                  ? m.opacity === 1
                  : m.opacity >= 0.4,
            ),
          ).toBe(true);
        }
        const capture = await page.evaluateHandle(() => {
          const app = window.odmApp,
            from = Math.ceil(app.engine!.now()!),
            to = from + 2;
          const samples: { id: string; start: number; cycle: number; frame: number }[] = [];
          const expected: { id: string; start: number; value: unknown }[] = [];
          const seen = new Set<string>(),
            wanted = new Set<string>();
          let previous = performance.now();
          function frame() {
            const now = app.engine!.now()!,
              clock = performance.now(),
              gap = (clock - previous) / 1000;
            previous = clock;
            const input = app.watchInput(now),
              muted = new Set(
                input.rows.filter((r) => r.muted || r.pattern.muted).map((r) => r.id),
              );
            for (const [id, result] of Object.entries(input.events))
              if (!muted.has(id))
                for (const e of result.events) {
                  if (!e.whole || e.part[0] !== e.whole[0] || e.whole[0] < from || e.whole[0] >= to)
                    continue;
                  const key = JSON.stringify([id, e.whole, e.value]);
                  if (!wanted.has(key)) {
                    wanted.add(key);
                    expected.push({ id, start: e.whole[0], value: e.value });
                  }
                }
            for (const m of window.odmSpiral.marks)
              if (
                !muted.has(m.instrument) &&
                m.onset &&
                m.start >= from &&
                m.start <= now &&
                m.start < to &&
                !seen.has(m.id)
              ) {
                seen.add(m.id);
                samples.push({ id: m.instrument, start: m.start, cycle: now, frame: gap });
              }
            if (now < to) requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
          return { from, to, samples, expected };
        });
        await appSignal(
          page,
          (to) => window.odmApp.engine!.now()! >= to,
          await capture.evaluate((c) => c.to),
        );
        const observed = await capture.evaluate((c) => ({
          ...c,
          cps: window.odmApp.state.cps!,
          triggers: window.odmApp.history.filter((e) => e.type === 'trigger'),
        }));
        await capture.dispose();
        expect(observed.expected.length).toBeGreaterThan(0);
        expect(observed.samples).toHaveLength(observed.expected.length);
        for (const e of observed.expected) {
          const sample = observed.samples.find(
            (s) => s.id === e.id && Math.abs(s.start - e.start) < 1e-8,
          );
          expect(sample, `gate crossing ${e.id} at ${e.start}`).toBeDefined();
          expect(Math.abs(sample!.cycle - e.start)).toBeLessThanOrEqual(
            (0.15 + sample!.frame) * observed.cps,
          );
          expect(
            observed.triggers.some(
              (t) => Math.abs(t.cycle - e.start) < 1e-8 && isDeepStrictEqual(t.value, e.value),
            ),
            `engine gate onset ${e.id} at ${e.start}`,
          ).toBe(true);
        }
        expect(
          await page.locator('#spiral canvas').evaluate((n: HTMLCanvasElement) =>
            n
              .getContext('2d')!
              .getImageData(0, 0, n.width, n.height)
              .data.some((v, i) => i % 4 === 3 && v > 0),
          ),
        ).toBe(true);
        console.log(
          `PHASE 3 MEASURED: Watch ${observed.from}–${observed.to}, ${observed.expected.length} notes and ${observed.samples.length} gate crossings.`,
        );
      },
    );
    await step(
      7,
      'Watch Stop/Play follows playback; Close returns focus to Watch with sheet state preserved.',
      'In Watch press Stop, Play, then Close; inspect transport, focus and the pinned sheet.',
      async () => {
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'Stop', exact: true }).click();
        await appSignal(page, () => !window.odmApp.state.playing && !window.odmApp.engine!.playing);
        await expect(dialog.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
        await swap(page, () => dialog.getByRole('button', { name: 'Play', exact: true }).click());
        await appSignal(
          page,
          () =>
            window.odmApp.canPlay &&
            window.odmApp.state.playing &&
            window.odmApp.engine!.playing &&
            window.odmApp.state.message === '',
        );
        await expect(dialog.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(button('Watch')).toBeFocused();
        expect(await sheetState()).toEqual(beforeWatch);
      },
    );
    await step(
      8,
      '390×844: Now strip expands to the drawing; Watch and legend fit without scrolling.',
      'Close Watch; resize to 390×844; collapse and expand Now; open Watch.',
      async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        const details = page.locator('.live-panel'),
          summary = details.locator(':scope > summary');
        if ((await details.getAttribute('open')) !== null) await summary.click();
        await expect(details).not.toHaveAttribute('open');
        await expect(summary).toContainText('Now:');
        await summary.click();
        await expect(details).toHaveAttribute('open', '');
        await expect(page.locator('.constellation')).toBeVisible();
        await expect(page.locator('[data-live-id]')).toHaveCount(8);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await button('Watch').click();
        const dialog = page.getByRole('dialog');
        expect(
          await dialog.evaluate(
            (n) => n.scrollWidth <= n.clientWidth && n.scrollHeight <= n.clientHeight,
          ),
        ).toBe(true);
        expect(
          await page
            .locator('.spiral-legend')
            .evaluate((n) => n.scrollWidth <= n.clientWidth && n.scrollHeight <= n.clientHeight),
        ).toBe(true);
        const box = await page.locator('#spiral canvas').boundingBox();
        expect(box!.width).toBeGreaterThan(0);
        expect(box!.height).toBeGreaterThan(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(390);
        expect(box!.y + box!.height).toBeLessThanOrEqual(844);
      },
    );
    expect(captions).toHaveLength(8);
  } finally {
    await context.close();
    await rename(await page.video()!.path(), `${dir}/demo.webm`);
    console.log(
      `PHASE 3: ${dir}/demo.webm (NO AUDIO), captions.txt, limitations.txt, 01–08 PNGs; ${limitations.length} limitations.`,
    );
  }
});

test('Phase 4: gaps and fixes on the real arranged house piece, one silent video', async ({
  browser,
}) => {
  test.skip(process.env.ODM_BROWSER_MODE !== 'demo', 'Opt-in only: npm run demo');
  test.skip(!!process.env.CI, 'Local music and uncommitted recordings only');
  test.setTimeout(120000); // Same recording budget as the earlier phases; outside the normal suite.
  const { phaseFour } = await import('./phase-four');
  await phaseFour(browser);
});
