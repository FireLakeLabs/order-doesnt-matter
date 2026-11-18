import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { formation } from '../../src/views/swarm/model';
import { prepare } from './view-evidence';
import { viewSmoke } from './view-smoke';
viewSmoke(test, 'swarm');

test('swarm: row names stay clear throughout the entry loop in every theme', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'swarm');
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.9);
    await document.fonts.ready;
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.9);
  const canvas = page.locator('[data-region="stage-a"] canvas');
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    const frame = await page.evaluate(() => window.viewProbe.frame!);
    const rows = formation(frame).rows.map((row) => ({
      y: row.y,
      name:
        row.crowded && row.enemies.length
          ? `${row.instrument.name} ×${String(row.enemies.length)}`
          : row.instrument.name,
    }));
    // Optional in-place Studio evidence, captured at the sweep's exact moment.
    if (process.env.ODM_SWARM_EVIDENCE_DIR) {
      await mkdir(process.env.ODM_SWARM_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: `${process.env.ODM_SWARM_EVIDENCE_DIR}/${theme}-10.9.png` });
    }
    const result = await canvas.evaluate(
      (canvas: HTMLCanvasElement, { frame, rows }) => {
        const c = canvas.getContext('2d')!;
        const clean = document.createElement('canvas');
        clean.width = canvas.width;
        clean.height = canvas.height;
        const reference = clean.getContext('2d')!;
        reference.scale(frame.dpr, frame.dpr);
        reference.fillStyle = frame.theme.ground;
        reference.fillRect(0, 0, frame.width, frame.height);
        reference.fillStyle = frame.theme.muted;
        reference.textAlign = 'right';
        reference.font = `10px "${frame.theme.fontMono}"`;
        const right = frame.width * 0.1;
        const regions = rows.map((row) => {
          const width = Math.min(reference.measureText(row.name).width, right - 10);
          reference.fillText(row.name, right, row.y + 4, right - 10);
          return {
            x: Math.floor((right - width - 1) * frame.dpr),
            y: Math.floor((row.y - 8) * frame.dpr),
            w: Math.ceil((width + 2) * frame.dpr),
            h: Math.ceil(14 * frame.dpr),
          };
        });
        let obscured = 0;
        // Include the reported crossing plus both sides of it; no playback clock involved.
        for (let step = 0; step < 50; step++) {
          window.viewProbe.handle!.frame({ ...frame, now: 10.5 + step / 100 });
          for (const r of regions) {
            const actual = c.getImageData(r.x, r.y, r.w, r.h).data;
            const expected = reference.getImageData(r.x, r.y, r.w, r.h).data;
            // Soft ground-coloured shadows can round an 8-bit channel by one level.
            if (actual.some((value, i) => Math.abs(value - expected[i]) > 1)) obscured++;
          }
        }
        window.viewProbe.handle!.frame(frame);
        return { obscured, samples: 50 };
      },
      { frame, rows },
    );
    expect(result, theme).toEqual({ obscured: 0, samples: 50 });
  }
});

for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket'])
  test(`swarm: ${theme} returns to identical pixels after other times`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepare(page, 'swarm');
    await page.evaluate(async () => {
      await window.odmStudio.seek(10.9);
    });
    await page.waitForFunction(() => window.viewProbe.frame?.now === 10.9);
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await page.evaluate(() => document.fonts.ready);
    const differentChannels = await page
      .locator('[data-region="stage-a"] canvas')
      .evaluate((canvas: HTMLCanvasElement) => {
        const frame = window.viewProbe.frame!,
          handle = window.viewProbe.handle!;
        const c = canvas.getContext('2d')!;
        // Exercise the reused raster context through an entry sequence first.
        for (let step = 0; step < 50; step++) {
          handle.frame({ ...frame, now: 10.5 + step / 100 });
          c.getImageData(0, 0, 120, 250);
        }
        handle.frame(frame);
        const forward = c.getImageData(0, 0, canvas.width, canvas.height).data;
        for (const now of [20, 0, frame.now]) handle.frame({ ...frame, now });
        const backward = c.getImageData(0, 0, canvas.width, canvas.height).data;
        return forward.reduce((count, value, i) => count + Number(value !== backward[i]), 0);
      });
    expect(differentChannels).toBe(0);
  });
