import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { boutState, fighterAt, indexBout } from '../../src/views/bout/model';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/bout`;
const themes = ['arcade', 'sunset', 'phosphor', 'riso', 'pocket'];
test('Bout: Studio mapping, five themes, reversibility and CPU cost', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'bout');
  const presented = () =>
    page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
  const at = async (now: number) => {
    await page.evaluate(async (now) => {
      window.odmStudio.pause();
      await window.odmStudio.seek(now);
    }, now);
    await page.waitForFunction((now) => window.viewProbe.frame?.now === now, now);
    await expect(page.locator('[data-region="stage-a"] .view-host')).toHaveAttribute(
      'data-score-ready',
      'true',
    );
    await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
      'data-score-ready',
      'true',
    );
    await expect(page.locator('[data-region="score"]')).toHaveAttribute('data-score-ready', 'true');
    await presented();
  };
  const chooseB = async (id: string) => {
    const stage = page.locator('[data-region="stage-b"]');
    const wide = (page.viewportSize()?.width ?? 0) >= 2200;
    if (!wide) await stage.getByRole('button', { name: 'Views', exact: true }).click();
    const choice = wide
      ? page.locator(`[data-region="view-shelf"] [data-view="${id}"] .view-to-b`)
      : stage.locator(`.shelf-popover [data-view="${id}"] .view-to-b`);
    await revealView(choice);
    await choice.click();
    await expect(stage.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
    await presented();
  };
  await chooseB('band');
  await page
    .getByRole('group', { name: 'Window', exact: true })
    .getByRole('button', { name: '1', exact: true })
    .click();
  await at(10.4);
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  const score = indexBout(frame.notes),
    state = boutState(score, frame);
  const mapping = {
    window: [state.from, state.to],
    total: state.total,
    round: state.round,
    fighters: state.fighters.map((f) => ({
      name: f.part.name,
      count: f.count,
      move: score.moves.get(f.part.id),
      pose: fighterAt(score, f.part.id, frame.now),
    })),
    arena: state.arena.map((a) => ({
      name: a.part.name,
      notes: a.notes.length,
      holds: a.holds.length,
      progress: a.progress,
    })),
  };
  expect(mapping.total).toBe(14);
  expect(mapping.fighters.map((f) => f.count)).toEqual([8, 2]);
  const measured = [];
  for (const theme of themes) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await presented();
    await page.screenshot({ path: `${shots}/${theme}-1920x1080.png` });
    await page
      .locator('[data-region="stage-a"] canvas')
      .screenshot({ path: `${shots}/${theme}-stage-a.png` });
    measured.push(
      await page.evaluate(async () => {
        const f = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1 };
        const el = document.createElement('div');
        document.body.append(el);
        const handle = await window.viewProbe.definition.mount(el);
        const texts: { text: string; size: number; ink: string }[] = [];
        const fill = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
          texts.push({ text, size: parseFloat(this.font), ink: String(this.fillStyle) });
          if (max === undefined) fill.call(this, text, x, y);
          else fill.call(this, text, x, y, max);
        };
        handle.frame(f);
        CanvasRenderingContext2D.prototype.fillText = fill;
        const canvas = el.querySelector('canvas')!;
        const before = canvas.toDataURL();
        handle.frame({ ...f, now: 13.7, width: 560, height: 675 });
        handle.frame({ ...f, now: 4.1 });
        handle.frame(f);
        const deterministic = canvas.toDataURL() === before;
        const freshEl = document.createElement('div');
        document.body.append(freshEl);
        const fresh = await window.viewProbe.definition.mount(freshEl);
        fresh.frame(f);
        const freshEqual = freshEl.querySelector('canvas')!.toDataURL() === before;
        fresh.dispose();
        freshEl.remove();
        const costs: number[] = [];
        for (let i = 0; i < 330; i++) {
          const start = performance.now();
          handle.frame({ ...f, now: 10.4 + i / 1000 });
          if (i >= 30) costs.push(performance.now() - start);
        }
        costs.sort((a, b) => a - b);
        const luminance = (hex: string) => {
          const rgb = hex
            .match(/[a-f\d]{2}/gi)!
            .map((v) => parseInt(v, 16) / 255)
            .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const a = luminance(f.theme.text),
          b = luminance(f.theme.panel);
        const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        handle.dispose();
        el.remove();
        return {
          theme: f.theme.name,
          deterministic,
          freshEqual,
          contrast,
          minLabelPx: Math.min(...texts.map((t) => t.size)),
          texts,
          width: 1300,
          height: 760,
          frames: costs.length,
          median: (costs[149] + costs[150]) / 2,
          p95: costs[285],
          max: costs[299],
        };
      }),
    );
  }
  for (const m of measured) {
    expect(m.deterministic).toBe(true);
    expect(m.freshEqual).toBe(true);
    expect(m.contrast).toBeGreaterThan(4.5);
    expect(m.minLabelPx).toBeGreaterThanOrEqual(11);
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  for (const now of [10.25, 10.375, 10.5, 8.1]) {
    await at(now);
    await page.screenshot({ path: `${shots}/pose-${String(now)}.png` });
  }
  await at(10.4);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.setViewportSize({ width: 2560, height: 1440 });
  await chooseB('bout');
  await at(10.4);
  for (const theme of themes) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await presented();
    await page
      .locator('[data-region="stage-b"]')
      .screenshot({ path: `${shots}/${theme}-stage-b-560.png` });
  }
  await chooseB('band');
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(0.4);
    },
    await readFile('corpus/programs/real-ambient.strudel', 'utf8'),
  );
  await page.waitForFunction(
    () => window.viewProbe.frame?.now === 0.4 && window.viewProbe.frame.sections.length === 0,
  );
  await expect(page.locator('[data-region="stage-a"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await expect(page.locator('[data-region="score"]')).toHaveAttribute('data-score-ready', 'true');
  await presented();
  await page.screenshot({ path: `${shots}/ambient-1920x1080.png` });
  await page
    .locator('[data-region="stage-a"] canvas')
    .screenshot({ path: `${shots}/ambient-stage-a.png` });
  const ambientFrame = await page.evaluate(() => window.viewProbe.frame!);
  const ambient = boutState(indexBout(ambientFrame.notes), ambientFrame);
  await at(4);
  await page.screenshot({ path: `${shots}/ambient-release.png` });
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify(
      {
        mapping,
        measured,
        ambient: {
          total: ambient.total,
          fighters: ambient.fighters.map((f) => ({
            name: f.part.name,
            count: f.count,
            pose: fighterAt(indexBout(ambientFrame.notes), f.part.id, 0.4).label,
          })),
        },
      },
      null,
      2,
    ),
  );
  console.log(
    'Bout evidence:',
    JSON.stringify({
      shots,
      mapping,
      measured: measured.map(({ texts, ...m }) => ({ ...m, labels: texts.length })),
    }),
  );
});
