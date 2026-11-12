import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { build, preview, type PreviewServer } from 'vite';
import { describeTarget, type Target } from '../../src/document/edit';
import { openProgram, play, selectNode, signal } from './helpers';

// Opt-in only. The real score is read by openProgram from disk, never imported.
// Baseline sources come from git; only the two project originals enter its bundle.
const enabled = process.env.ODM_EDITOR_SHOTS === '1';
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
const stages = process.env.ODM_POLISH_STAGE ? [process.env.ODM_POLISH_STAGE] : ['before', 'after'];
async function targets(page: Page): Promise<Target[]> {
  const { doc, ids } = await page.evaluate(() => ({
    doc: window.odmApp.state.doc!,
    ids: Array.from(document.querySelectorAll<HTMLElement>('[data-editor-target]')).map(
      (n) => n.dataset.editorTarget!,
    ),
  }));
  return [...new Set(ids)].map((id) => describeTarget(doc, id));
}
for (const stage of stages)
  test.describe(stage, () => {
    let server: PreviewServer | undefined, outDir: string, url: string;
    test.skip(!enabled, 'Run npm run shots:editors.');
    test.beforeAll(async () => {
      outDir = await mkdtemp('.browser-build-polish-');
      let root = process.cwd();
      if (stage === 'before') {
        const ref =
          process.env.ODM_POLISH_REF ??
          execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }).trim();
        const archive = execFileSync('git', [
          'archive',
          ref,
          '--',
          'src',
          'index.html',
          'harness',
          'corpus/programs/piece-kiln.strudel',
          'corpus/programs/piece-lichen.strudel',
        ]);
        execFileSync('tar', ['-x', '-C', outDir], { input: archive });
        await symlink(resolve('node_modules'), `${outDir}/node_modules`, 'dir');
        root = resolve(outDir);
      }
      const buildDir = stage === 'before' ? `${root}/dist` : resolve(outDir, 'dist');
      await build({ root, configFile: false, build: { outDir: buildDir } });
      server = await preview({
        root,
        configFile: false,
        build: { outDir: buildDir },
        preview: { host: '127.0.0.1', port: 0, open: false },
      });
      const address = server.httpServer.address();
      if (!address || typeof address === 'string') throw Error('No preview address');
      url = `http://127.0.0.1:${address.port}`;
    });
    test.afterAll(async () => {
      if (server) await new Promise<void>((resolve) => server!.httpServer.close(() => resolve()));
      if (outDir) await rm(outDir, { recursive: true, force: true });
    });
    test.use({
      baseURL: async ({ defaultBrowserType }, use) => {
        void defaultBrowserType;
        await use(url);
      },
    });
    for (const piece of ['house', 'Kiln'] as const)
      for (const size of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ])
        test(`${piece} editors ${size.width}`, async ({ page }) => {
          test.setTimeout(120000);
          await page.setViewportSize(size);
          await openProgram(
            page,
            piece === 'house'
              ? { path: 'corpus/programs/real-house-arranged.strudel' }
              : { example: piece },
          );
          await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
          await page
            .getByRole('button', { name: piece === 'house' ? 'drop' : 'Section 3', exact: true })
            .first()
            .click();
          await play(page);
          await page.getByRole('button', { name: 'Stop', exact: true }).click();
          const dir = `test-results/polish/${stage}`;
          await mkdir(dir, { recursive: true });
          await page.locator('.topbar').evaluate((n) => n.scrollIntoView());
          await page.screenshot({ path: `${dir}/${piece}-notice-${size.width}.png` });
          if (stage === 'after') {
            await expect(page.locator('#sound-notice')).toBeVisible();
            await page.getByRole('button', { name: 'Dismiss sound notice' }).click();
            await expect(page.locator('#sound-notice')).toBeHidden();
          }
          const evidence: unknown[] = [];
          for (const kind of [
            'constant',
            'readonly',
            'instrument',
            'values',
            'signal',
            'rewrite',
          ]) {
            if (await page.locator('#editor').isVisible()) await page.keyboard.press('Escape');
            const available = await targets(page);
            const target = available.find((t) =>
              kind === 'readonly'
                ? t.kind === 'rhythm'
                : kind === 'rewrite'
                  ? t.kind === 'rewrite' && !t.nodeId.endsWith(':rewrites')
                  : t.kind === (kind === 'instrument' ? kind : `setting-${kind}`) &&
                    (kind !== 'values' || !['s', 'sound', 'note'].includes(t.control)),
            );
            if (target) await selectNode(page, { nodeId: target.nodeId });
            else {
              const constant = available.find(
                (t) => t.kind === 'setting-constant' && typeof t.value === 'number' && !t.use,
              )!;
              await selectNode(page, { nodeId: constant.nodeId });
              await page
                .getByRole('button', {
                  name: kind === 'signal' ? 'Drive with a signal' : 'Change over time',
                  exact: true,
                })
                .click();
            }
            await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', kind);
            if (kind === 'rewrite') {
              await signal(() => page.locator('#editor figure').count()).toBe(2);
              await expect(page.locator('#editor figure')).toHaveCount(2);
            }
            // Reset panel scroll without moving the selected cell's horizontal position.
            await page.locator('#editor').evaluate((n) => {
              n.scrollTop = 0;
              n.querySelector('.editor-body')?.scrollTo(0, 0);
            });
            if (stage === 'after') {
              await expect(
                page.getByRole('button', { name: 'Done', exact: true }),
              ).toBeInViewport();
              expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              ).toBe(true);
              if (size.width === 390) {
                const panelTop = await page
                  .locator('#editor')
                  .evaluate((n) => n.getBoundingClientRect().top);
                const selected = await page
                  .locator('[data-section][aria-pressed="true"]')
                  .evaluate((n) => n.getBoundingClientRect().toJSON());
                expect(selected.bottom).toBeLessThanOrEqual(panelTop);
              } else if (target?.kind.startsWith('setting-')) {
                const selected = page.locator('[data-editor-selected="true"]').first();
                await expect(selected).toBeInViewport();
                const geometry = await selected.evaluate((n) => {
                  const rect = n.getBoundingClientRect(),
                    scroller = n.closest('.sheet-scroll')!,
                    heading = scroller.querySelector('thead')!.getBoundingClientRect();
                  return {
                    cellBottom: rect.bottom,
                    headingBottom: heading.bottom,
                    scrollerTop: scroller.getBoundingClientRect().top,
                  };
                });
                expect(geometry.cellBottom).toBeGreaterThan(geometry.headingBottom);
              }
            }
            await page.locator('.sheet-song').evaluate((n) => n.scrollIntoView({ block: 'start' }));
            await page.screenshot({ path: `${dir}/${piece}-${kind}-${size.width}.png` });
            evidence.push(
              await page.locator('#editor').evaluate((n) => ({
                kind: (n as HTMLElement).dataset.editorKind,
                text: (n as HTMLElement).innerText,
                rect: n.getBoundingClientRect().toJSON(),
                controls: Array.from(n.querySelectorAll('input,button,select,summary')).map(
                  (e) => ({
                    label: e.getAttribute('aria-label') ?? e.textContent,
                    rect: e.getBoundingClientRect().toJSON(),
                  }),
                ),
              })),
            );
          }
          await writeFile(`${dir}/${piece}-${size.width}.json`, JSON.stringify(evidence, null, 2));
        });
    test('nested values, focus and unchanged rewrite', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openProgram(page, {
        source: 'note("c4 e4 g4 c5").s("sine").gain(".8 [.3 .9]").slow(1)',
      });
      await page.getByRole('button', { name: 'Paste Strudel', exact: true }).click();
      await selectNode(page, { breadcrumb: ['Instrument 1', 'gain'] });
      const dir = `test-results/polish/${stage}`;
      await mkdir(dir, { recursive: true });
      if (stage === 'before') {
        await page.getByRole('spinbutton', { name: 'Value 2.1 (×)', exact: true }).focus();
        await page.keyboard.press('Tab');
      }
      if (stage === 'after') {
        const field = page.getByRole('spinbutton', { name: '2nd value, first half', exact: true });
        await field.focus();
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const n = document.activeElement!;
          return {
            visible: n.matches(':focus-visible'),
            style: getComputedStyle(n).outlineStyle,
            width: parseFloat(getComputedStyle(n).outlineWidth),
          };
        });
        expect(focus.visible).toBe(true);
        expect(focus.style).not.toBe('none');
        expect(focus.width).toBeGreaterThanOrEqual(2);
        await expect(page.locator('#editor')).not.toContainText('×');
      }
      await page.screenshot({ path: `${dir}/nested-values-390.png` });
      await page.keyboard.press('Escape');
      const rewrite = (await targets(page)).find(
        (t) => t.kind === 'rewrite' && !t.nodeId.endsWith(':rewrites'),
      )!;
      await selectNode(page, { nodeId: rewrite.nodeId });
      await signal(() => page.locator('#editor figure').count()).toBe(2);
      await expect(page.locator('#editor figure')).toHaveCount(2);
      if (stage === 'after')
        await expect(page.locator('#editor')).toContainText(
          'Both show the same notes in this window.',
        );
      if (stage === 'after')
        await page
          .getByText('Both show the same notes in this window.', { exact: true })
          .scrollIntoViewIfNeeded();
      else await page.locator('#editor figure').last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${dir}/unchanged-rewrite-390.png` });
    });
  });
