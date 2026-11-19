import { expect, test } from '@playwright/test';
import { viewSmoke } from './view-smoke';
import { prepare } from './view-evidence';
viewSmoke(test, 'light-rig');

test('light-rig: light themes keep a dark stage behind unlit fixtures', async ({ page }) => {
  await prepare(page, 'light-rig');
  await page.evaluate(() => window.odmStudio.pause());
  for (const theme of ['riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
    const contrast = await page.evaluate(async () => {
      const frame = {
        ...window.viewProbe.frame!,
        width: 1300,
        height: 760,
        dpr: 1,
        playing: false,
        instruments: window.viewProbe.frame!.instruments.map((i) => ({ ...i, muted: true })),
      };
      const el = document.createElement('div');
      document.body.append(el);
      const handle = await window.viewProbe.definition.mount(el);
      try {
        handle.frame(frame);
        const gl = el.querySelector('canvas')!.getContext('webgl2')!;
        const pixel = new Uint8Array(4);
        gl.readPixels(
          gl.drawingBufferWidth / 2,
          gl.drawingBufferHeight / 2,
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        );
        const luminance = (rgb: number[]) =>
          rgb
            .map((c) => {
              const s = c / 255;
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
        const ground = frame.theme.ground
          .slice(1)
          .match(/../g)!
          .map((c) => parseInt(c, 16));
        return (luminance(ground) + 0.05) / (luminance([...pixel].slice(0, 3)) + 0.05);
      } finally {
        handle.dispose();
        el.remove();
      }
    });
    expect(contrast).toBeGreaterThan(3);
  }
});
