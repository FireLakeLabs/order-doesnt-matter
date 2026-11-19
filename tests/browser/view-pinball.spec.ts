import { prepare } from './view-evidence';
import { expect, test } from '@playwright/test';
import { viewSmoke } from './view-smoke';
viewSmoke(test, 'pinball');

test('pinball: every active legend name fits in full in all five themes', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'pinball');
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const f = window.viewProbe.frame!;
      const labels: string[] = [];
      const fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (
        this: CanvasRenderingContext2D,
        text,
        x,
        y,
      ) {
        if (y > f.height - 65) labels.push(text);
        return fill.call(this, text, x, y);
      };
      try {
        window.viewProbe.handle!.frame({ ...f, notes: f.notes.slice() });
      } finally {
        CanvasRenderingContext2D.prototype.fillText = fill;
      }
      const ids = new Set(
        f.notes.filter((n) => n.start < 11 && n.end > 10).map((n) => n.instrument),
      );
      return { labels, names: f.instruments.filter((i) => ids.has(i.id)).map((i) => i.name) };
    });
    for (const name of result.names)
      expect(result.labels.some((label) => label.endsWith(name))).toBe(true);
    expect(result.labels.every((label) => !label.includes('…'))).toBe(true);
  }
});
