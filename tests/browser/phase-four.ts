import { expect, test, type Browser } from '@playwright/test';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import {
  openProgram,
  play,
  scoreReady,
  selectNode,
  waitForPending,
  appSignal,
  swap,
  signal,
} from './helpers';
import { PREFLIGHT_TIMEOUT } from '../../src/engine/playback-limits';

/** D33: every action asserts; defects become captioned limitations, never fixes here. */
export async function phaseFour(browser: Browser) {
  const dir = 'test-results/demo/phase-4';
  await mkdir(dir, { recursive: true });
  const context = await browser.newContext({
    baseURL: process.env.ODM_URL,
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  const source = await readFile('corpus/programs/real-house-arranged.strudel', 'utf8');
  const captions: string[] = [],
    limitations: string[] = [];
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const limit = (n: number, reason: string) => limitations.push(`${n}. LIMITATION: ${reason}`);
  async function caption(text: string) {
    await page.evaluate((text) => {
      let label = document.getElementById('demo-caption');
      if (!label) {
        label = document.createElement('div');
        label.id = 'demo-caption';
        label.style.cssText =
          'position:fixed;top:72px;left:8px;max-width:90%;padding:8px 14px;background:var(--panel);color:var(--text);border:1px solid var(--accent);border-radius:8px;z-index:99;pointer-events:none;font:14px system-ui';
      }
      (document.querySelector('dialog[open]') ?? document.body).append(label);
      label.textContent = text;
    }, text);
  }
  async function step(n: number, text: string, reproduce: string, action: () => Promise<void>) {
    await test.step(`Phase 4 ${n}: ${text}`, async () => {
      await caption(`${n}. CHECK: ${text}`);
      try {
        await action();
      } catch (error) {
        limit(n, `${String(error)} Reproduce: ${reproduce}`);
      }
      const issues = limitations.filter((s) => s.startsWith(`${n}.`));
      const result = `${n}. ${issues.length ? 'LIMITATION' : 'PASS'}: ${text}${issues.length ? `\n${issues.join('\n')}` : ''}`;
      await caption(result);
      await page.screenshot({ path: `${dir}/${String(n).padStart(2, '0')}.png` });
      captions.push(result);
      await writeFile(`${dir}/captions.txt`, `${captions.join('\n')}\n`);
      await writeFile(`${dir}/limitations.txt`, `${limitations.join('\n')}\n`);
      console.log(`PHASE 4 ${result}`);
    });
  }
  const close = async () => {
    if (await page.locator('#editor').isVisible()) await page.keyboard.press('Escape');
  };
  async function load() {
    await openProgram(page, { source }); // Read above, never bundled or copied into the repo.
    await button('drop').first().click();
    await scoreReady(page);
    await button('Paste Strudel').click();
  }
  async function queried(id: string, action: () => Promise<unknown>) {
    const before = await page.evaluateHandle((id) => window.odmApp.state.events[id], id);
    try {
      await action();
      await signal(() =>
        before.evaluate((old, id) => window.odmApp.state.events[id] !== old, id),
      ).toBe(true);
    } finally {
      await before.dispose();
    }
  }
  let original: string;
  let originalEvents: string;
  async function reset() {
    await close();
    await page.evaluate(() => {
      const app = window.odmApp;
      app.stop();
      while (app.editor!.canUndo) app.editor!.undo();
    });
    expect(await page.evaluate(() => JSON.stringify(window.odmApp.state.doc))).toBe(original);
    await scoreReady(page);
    await signal(() => page.evaluate(() => JSON.stringify(window.odmApp.state.events))).toBe(
      originalEvents,
    );
    await button('drop').first().click();
  }
  const row = (name: string) =>
    page.evaluate((name) => window.odmApp.state.rows.find((r) => r.name === name)!, name);
  const starts = (id: string) =>
    page.evaluate(
      (id) =>
        window.odmApp.state.events[id].events
          .filter((e) => e.hasOnset && e.whole![0] >= 8 && e.whole![0] < 9)
          .map((e) => e.whole![0] - 8),
      id,
    );
  async function rhythm(name: string) {
    await close();
    const r = await row(name);
    await selectNode(page, { nodeId: `${r.pattern.id}:rhythm` });
    return r;
  }
  async function fullCycle(id: string) {
    const boundary = await page.evaluate(() => {
      const b = window.odmApp.history.findLast((e) => e.type === 'swapped')!;
      return { revision: b.revision, from: Math.ceil(b.cycle) };
    });
    await appSignal(page, (to) => window.odmApp.engine!.now()! >= to, boundary.from + 1);
    const notes = await page.evaluate(
      ({ id, boundary }) =>
        window.odmApp.history
          .filter(
            (e) =>
              e.type === 'trigger' &&
              e.revision === boundary.revision &&
              e.instrument === id &&
              e.cycle >= boundary.from &&
              e.cycle < boundary.from + 1,
          )
          .map((e) => (e.type === 'trigger' ? e.cycle - boundary.from : -1)),
      { id, boundary },
    );
    console.log(
      `PHASE 4 MEASURED: ${id}, revision ${boundary.revision}, cycle ${boundary.from}: ${JSON.stringify(notes)}`,
    );
    return notes;
  }
  try {
    await load();
    original = await page.evaluate(() => JSON.stringify(window.odmApp.state.doc));
    originalEvents = await page.evaluate(() => JSON.stringify(window.odmApp.state.events));
    console.log(
      'PHASE 4: real house read in place; offline sample hosts; scheduled trigger checks, no audio in video.',
    );
    await step(
      1,
      'Delete kick during Play: row and planet disappear, a full cycle has no bd; Undo restores exactly.',
      'Load real house, select drop, Play, select kick, Delete instrument → Delete everywhere, then Undo.',
      async () => {
        const kick = await row('kick');
        await play(page);
        await selectNode(page, { nodeId: kick.id });
        await button('Delete instrument').click();
        await swap(page, () => button('Delete everywhere').click());
        await expect(page.locator(`tr[data-node-id="${kick.id}"]`)).toHaveCount(0);
        await expect(page.locator(`[data-live-id="${kick.id}"]`)).toHaveCount(0);
        expect(await fullCycle(kick.id)).toEqual([]);
        const observed = await page.evaluate(() => {
          const h = window.odmApp.history,
            b = h.findLast((e) => e.type === 'swapped')!;
          return h
            .filter(
              (e) =>
                e.type === 'trigger' &&
                e.revision === b.revision &&
                e.cycle >= Math.ceil(b.cycle) &&
                e.cycle < Math.ceil(b.cycle) + 1,
            )
            .map((e) => (e.type === 'trigger' ? (e.value as { s?: string }) : {}));
        });
        expect(observed.length).toBeGreaterThan(0);
        expect(observed.some((v) => v.s === 'bd')).toBe(false);
        await swap(page, () => button('Undo').click());
        expect(await page.evaluate(() => JSON.stringify(window.odmApp.state.doc))).toBe(original);
        await expect(page.locator(`[data-live-id="${kick.id}"]`)).toHaveCount(1);
        await expect(page.locator(`tr[data-node-id="${kick.id}"]`)).toHaveCount(1);
        await appSignal(
          page,
          (id) => {
            const h = window.odmApp.history,
              b = h.findLast((e) => e.type === 'swapped')!;
            return h.some(
              (e) =>
                e.type === 'trigger' &&
                e.revision === b.revision &&
                e.instrument === id &&
                (e.value as { s?: string }).s === 'bd',
            );
          },
          kick.id,
        );
      },
    );
    await reset();
    await step(
      2,
      'Rhythm: split, remove both parts, compare original onsets; Join back on another split.',
      'Real house drop → bass Rhythm → first box → Split in 2 → first child → Remove → Remove again; compare original onsets. On another split select its parent → Join back.',
      async () => {
        const bass = await rhythm('bass'),
          before = await starts(bass.id);
        await queried(bass.id, () => button('Split in 2').click());
        await page.locator('[data-path="0.0"]').click();
        await queried(bass.id, () => button('Remove').click());
        await waitForPending(page);
        await expect(page.locator('[data-path="0.0"]')).toHaveCount(0);
        expect(await starts(bass.id)).toEqual(before);
        await queried(bass.id, () => button('Remove').click());
        await waitForPending(page);
        try {
          expect(await starts(bass.id)).toEqual(before);
        } catch {
          limit(
            2,
            'After the first removal collapses the split, the second Remove deletes the original slot and redistributes the sequence. Original onsets are not restored. Reproduce: bass first box, Split in 2, select first child, Remove twice. Undo restores the original slot (asserted); no product fix in this demo.',
          );
        }
        await queried(bass.id, () => button('Undo').click());
        await waitForPending(page);
        expect(await starts(bass.id)).toEqual(before);
        await page.locator('[data-path="2"]').click();
        await queried(bass.id, () => button('Split in 2').click());
        await page.locator('[data-path="2"]').click();
        await queried(bass.id, () => button('Join back').click());
        await waitForPending(page);
        expect(await starts(bass.id)).toEqual(before);
      },
    );
    await reset();
    await step(
      3,
      'Faster ×2 on a bass step: twice its onsets within the same span, delivered while playing.',
      'Real house drop → bass Rhythm → first box → Speed and length → Faster ×n = 2 → Play.',
      async () => {
        const bass = await rhythm('bass');
        await page.locator('[data-path="0"]').click();
        await page.getByText('Speed and length', { exact: true }).click();
        const faster = page.getByLabel('Faster ×n', { exact: true });
        await faster.fill('2');
        await queried(bass.id, () => faster.press('Enter'));
        await waitForPending(page);
        expect(await starts(bass.id)).toEqual([0, 1 / 16, 1 / 4, 3 / 8, 5 / 8, 7 / 8]);
        await play(page);
        expect(await fullCycle(bass.id)).toEqual([0, 1 / 16, 1 / 4, 3 / 8, 5 / 8, 7 / 8]);
      },
    );
    await reset();
    await step(
      4,
      'Spread 3 hits out of 8 on a drum step: expected proportional trigger positions.',
      'Real house drop → percussion · cp Rhythm → second box → Spread hits evenly → hits = 3, out of = 8 → Play.',
      async () => {
        const drum = await rhythm('percussion · cp');
        await page.locator('[data-path="1"]').click();
        await button('Spread hits evenly…').click();
        const hits = page.getByLabel('hits', { exact: true });
        await hits.fill('3');
        await queried(drum.id, () => hits.press('Enter'));
        await expect(page.getByLabel('out of', { exact: true })).toHaveValue('8');
        await waitForPending(page);
        expect(await starts(drum.id)).toEqual([1 / 4, 11 / 32, 14 / 32, 3 / 4]);
        await play(page);
        expect(await fullCycle(drum.id)).toEqual([1 / 4, 11 / 32, 14 / 32, 3 / 4]);
      },
    );
    await reset();
    await step(
      5,
      'A nonanswering playback program is refused; page responds and a failed live swap retains the house for a full cycle.',
      'Paste new Pattern(state => { if (state.controls.cyclist) { while(true){} } return [] }); Load, Play. Then restore house/drop/Play and Load the same program.',
      async () => {
        const runaway =
          'new Pattern(state => { if (state.controls.cyclist) { while(true){} } return [] })';
        await button('Paste Strudel').click();
        await page.getByLabel('Your Strudel program').fill(runaway);
        await button('Load').click();
        await scoreReady(page);
        await button('Play').click();
        const clicked = Date.now();
        await button('Paste Strudel').click();
        await expect(page.getByLabel('Your Strudel program')).toBeHidden();
        expect(Date.now() - clicked).toBeLessThan(1000);
        await expect(page.locator('#message')).toHaveText(PREFLIGHT_TIMEOUT, { timeout: 7000 });
        expect(await page.evaluate(() => window.odmApp.engine!.playing)).toBe(false);
        await button('Paste Strudel').click();
        await page.getByLabel('Your Strudel program').fill(source);
        await button('Load').click();
        await scoreReady(page);
        await button('drop').first().click();
        await play(page);
        const bass = await row('bass');
        await page.getByLabel('Your Strudel program').fill(runaway);
        await button('Load').click();
        await scoreReady(page);
        await expect(page.locator('#message')).toHaveText(PREFLIGHT_TIMEOUT, { timeout: 7000 });
        expect(await fullCycle(bass.id)).toEqual([0, 1 / 4, 3 / 8, 5 / 8, 7 / 8]);
        expect(await page.evaluate(() => window.odmApp.engine!.playing)).toBe(true);
      },
    );
    await page.evaluate(() => window.odmApp.stop());
    await load();
    await step(
      6,
      'Watch View sliders change mark opacities and survive reload.',
      'Real house drop → Watch → View, adjust both sliders, close and reload, load house again and reopen Watch → View.',
      async () => {
        await button('Watch').click();
        await page.locator('.spiral-controls > summary').click();
        const sample = () =>
          page.evaluate(() => {
            const v = window.odmSpiral;
            v.update(window.odmApp.watchInput(8.5));
            return {
              past: v.marks.find((m) => m.turn === 7)!.opacity,
              future: v.marks.find((m) => m.turn === 10)!.opacity,
            };
          });
        const before = await sample();
        await page.getByRole('slider', { name: 'Keep what just played' }).press('Home');
        await page.getByRole('slider', { name: "Show what's coming" }).press('End');
        const after = await sample();
        expect(after.past).toBeLessThan(before.past);
        expect(after.future).toBeGreaterThan(before.future);
        await page.keyboard.press('Escape');
        await page.reload();
        await load();
        await button('Watch').click();
        await page.locator('.spiral-controls > summary').click();
        await expect(page.getByRole('slider', { name: 'Keep what just played' })).toHaveValue(
          '0.1',
        );
        await expect(page.getByRole('slider', { name: "Show what's coming" })).toHaveValue('4');
        expect(await sample()).toEqual(after);
        await page.keyboard.press('Escape');
      },
    );
    await step(
      7,
      'A sparse bass setting remains pending through busy triggers, then clears on its own changed note.',
      'Real house drop → bass lpf → Play, enter 900, observe pending until bass’s changed trigger.',
      async () => {
        await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
        await play(page);
        const capture = await page.evaluateHandle(() => {
          const app = window.odmApp,
            bass = app.state.rows.find((r) => r.name === 'bass')!.id;
          const revision = app.history.findLast((e) => e.type === 'swapped')!.revision + 1;
          const notes: { own: boolean; pending: boolean; value: unknown }[] = [];
          const off = app.engine!.subscribe((e) => {
            if (e.type === 'trigger' && e.revision === revision)
              notes.push({
                own: e.instrument === bass,
                pending: Object.values(app.editor!.state.entries).some(
                  (e) => e.status === 'pending',
                ),
                value: e.value,
              });
          });
          return { notes, off };
        });
        const field = page.locator('#editor').getByRole('spinbutton');
        await field.fill('900');
        await field.press('Enter');
        await waitForPending(page);
        const notes = await capture.evaluate((c) => {
          c.off();
          return c.notes;
        });
        await capture.dispose();
        expect(notes.some((n) => !n.own && n.pending)).toBe(true);
        const own = notes.find((n) => n.own)!;
        expect(own.value).toMatchObject({ cutoff: 900 });
        expect(own.pending).toBe(false);
        await expect(page.locator('#editor-status')).toHaveText('Changed');
      },
    );
    expect(captions).toHaveLength(7);
  } finally {
    await context.close();
    await rename(await page.video()!.path(), `${dir}/demo.webm`);
    console.log(
      `PHASE 4: ${dir}/demo.webm (NO AUDIO), captions.txt, limitations.txt, 01–07 PNGs; ${limitations.length} limitations.`,
    );
  }
}
