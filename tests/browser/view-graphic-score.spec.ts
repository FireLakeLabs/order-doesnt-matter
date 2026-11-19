import { prepare } from './view-evidence';
import { expect, test } from '@playwright/test';
import { viewSmoke } from './view-smoke';
viewSmoke(test, 'graphic-score');

test('graphic score: row names fit inside the gutter in all five themes', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'graphic-score');
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await page.evaluate(() => document.fonts.ready);
    const labels = await page.evaluate(() => {
      const f = window.viewProbe.frame!;
      const labels: { text: string; left: number }[] = [];
      const fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (
        this: CanvasRenderingContext2D,
        text,
        x,
        y,
      ) {
        if (this.textAlign === 'right' && y > 110 && y < f.height - 100)
          labels.push({ text, left: x - this.measureText(text).width });
        return fill.call(this, text, x, y);
      };
      try {
        window.viewProbe.handle!.frame({ ...f, notes: f.notes.slice() });
      } finally {
        CanvasRenderingContext2D.prototype.fillText = fill;
      }
      return labels;
    });
    for (const name of ['vocalAtmos', 'sd · buildSection', 'hh · intro', 'sd · drop', 'hh · drop'])
      expect(labels.find((label) => label.text === name)?.left).toBeGreaterThanOrEqual(30);
  }
});
