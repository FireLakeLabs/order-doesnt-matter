import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { prepare } from './view-evidence';
import type { Pattern, Step } from '../../src/document/types';

declare global {
  interface Window {
    traceTexts: WeakMap<HTMLCanvasElement, string[]>;
  }
}
async function setup(page: Page) {
  await page.addInitScript(() => {
    window.traceTexts = new WeakMap();
    const reset = CanvasRenderingContext2D.prototype.reset;
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.reset = function () {
      window.traceTexts.set(this.canvas, []);
      reset.call(this);
    };
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      window.traceTexts.get(this.canvas)?.push(text);
      if (maxWidth === undefined) fill.call(this, text, x, y);
      else fill.call(this, text, x, y, maxWidth);
    };
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'tracing-paper');
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
}
async function edit(page: Page, notation: string, steps: Step[], count: number) {
  await page.evaluate(
    async ({ notation, steps }) => {
      const editor = window.odmStudio.app.editor!;
      const doc = structuredClone(editor.state.doc);
      function visit(value: unknown) {
        if (!value || typeof value !== 'object') return;
        if ('core' in value) {
          const p = value as Pattern;
          if (
            p.core.kind === 'sequence' &&
            (p.core.notation === 'hh*8' || p.core.notation.startsWith('hh hh ~'))
          )
            p.core = { kind: 'sequence', notation, steps };
        }
        for (const v of Object.values(value)) visit(v);
      }
      visit(doc);
      editor.apply(doc);
      await editor.settle();
    },
    { notation, steps },
  );
  await page.waitForFunction(
    (count) => window.viewProbe.frame?.history?.versions.length === count,
    count,
  );
  const stage = page.locator('[data-region="stage-a"]');
  await expect(stage.locator('canvas')).toHaveAttribute('data-state', 'ready');
  await expect(stage.getByLabel('Peel ink version')).toHaveValue(
    await page.evaluate(() => window.viewProbe.frame!.history!.versions.at(-1)!.id),
  );
}
async function texts(page: Page) {
  return page
    .locator('[data-region="stage-a"] canvas')
    .evaluate((canvas) => window.traceTexts.get(canvas as HTMLCanvasElement) ?? []);
}
async function shot(page: Page, name: string) {
  const dir = process.env.ODM_SWEEP_EVIDENCE_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png` });
}
const hit = (): Step => ({ kind: 'value', value: 'hh' });
const rest = (): Step => ({ kind: 'rest' });

test('Tracing paper keeps historical names after replacing hats and names both versions', async ({
  page,
}) => {
  await setup(page);
  await edit(page, 'sd*8', [{ kind: 'value', value: 'sd', repeat: 8 }], 2);
  await shot(page, 'renamed-part');
  expect(await texts(page)).toContain('hh · drop → sd · drop 2');
  const stage = page.locator('[data-region="stage-a"]');
  const oldest = await page.evaluate(() => window.viewProbe.frame!.history!.versions[0].id);
  await stage.getByLabel('Peel ink version').selectOption(oldest);
  await expect(stage.locator('canvas')).toHaveAttribute('data-state', 'identical');
  await shot(page, 'historical-peel');
  expect(await texts(page)).toContain('hh · drop');
  expect(await texts(page)).not.toContain('sd · drop 2');
  expect(
    await page.evaluate(() => {
      const frame = window.viewProbe.frame!,
        handle = window.viewProbe.handle!;
      const canvas = document.querySelector<HTMLCanvasElement>('[data-region="stage-a"] canvas')!;
      handle.frame(frame);
      const picture = canvas.toDataURL();
      handle.frame({ ...frame, now: 22.4 });
      handle.frame({ ...frame, now: 4 });
      handle.frame(frame);
      return canvas.toDataURL() === picture;
    }),
  ).toBe(true);
});

test('Tracing paper explains changed samples when the displayed gain range is unchanged', async ({
  page,
}) => {
  await setup(page);
  await edit(
    page,
    'hh hh ~ hh hh hh hh hh',
    [hit(), hit(), rest(), hit(), hit(), hit(), hit(), hit()],
    2,
  );
  await edit(
    page,
    'hh hh ~ hh hh [~ hh] hh hh',
    [hit(), hit(), rest(), hit(), hit(), { kind: 'sub', steps: [rest(), hit()] }, hit(), hit()],
    3,
  );
  await shot(page, 'equal-range');
  const margin = (await texts(page)).find((text) => text.includes('gain:'));
  expect(margin).toContain('matched values changed');
  expect(margin).not.toContain('0.35–0.638 → 0.35–0.638');
});
