import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { barCounts, compareScores } from '../../src/views/tracing-paper/model';
import type { Doc, Pattern, Step } from '../../src/document/types';
import type { ViewHistoryScore } from '../../src/views/types';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/tracing-paper`;

test('Tracing paper: real session edits, peel, themes, deterministic pixels and CPU', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'tracing-paper');
  const stage = page.locator('[data-region="stage-a"]');
  const canvas = stage.locator('canvas');
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await expect(canvas).toHaveAttribute('data-state', 'empty');
  // Keep a second live view in the actual Stage B.
  const b = page.locator('[data-region="stage-b"]');
  await b.getByRole('button', { name: 'Views', exact: true }).click();
  const band = b.getByRole('button', { name: 'The band on Stage B', exact: true });
  await revealView(band);
  await band.click();
  await expect(b.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await page.screenshot({ path: `${shots}/no-edits-yet.png` });
  // One stored version per invented action, using the actual editor and retained document ids.
  for (const step of [0, 1, 2, 3]) {
    await page.evaluate(async (step) => {
      const editor = window.odmStudio.app.editor!;
      const doc = structuredClone(editor.state.doc);
      const patterns: Pattern[] = [];
      function visit(value: unknown) {
        if (!value || typeof value !== 'object') return;
        if ('core' in value && 'layers' in value) patterns.push(value as Pattern);
        for (const v of Object.values(value)) visit(v);
      }
      visit(doc);
      const hat = patterns.find(
        (p) =>
          p.core.kind === 'generator' &&
          p.core.name === 's' &&
          JSON.stringify(p.core).includes(step === 0 ? 'hh*8' : 'hh hh ~ hh'),
      )!;
      if (!hat) throw Error('No hat definition');
      if (step < 3) {
        const rhythm = patterns.find(
          (p) =>
            p.core.kind === 'sequence' &&
            (p.core.notation === 'hh*8' || p.core.notation.startsWith('[hh hh ~ hh')),
        )!;
        const hit = (): Step => ({ kind: 'value', value: 'hh' }),
          rest = (): Step => ({ kind: 'rest' });
        const steps: Step[] = [
          hit(),
          hit(),
          rest(),
          hit(),
          hit(),
          step > 0 ? { kind: 'sub', steps: [rest(), hit()] } : hit(),
          hit(),
          step > 1 ? { kind: 'sub', steps: [hit(), hit()] } : hit(),
        ];
        const notation =
          step === 0
            ? '[hh hh ~ hh hh hh hh hh]'
            : step === 1
              ? '[hh hh ~ hh hh [~ hh] hh hh]'
              : '[hh hh ~ hh hh [~ hh] hh [hh hh]]';
        rhythm.core = { kind: 'sequence', steps: [{ kind: 'sub', steps }], notation };
      } else {
        let changed = false;
        for (const layer of hat.layers)
          if (layer.kind === 'settings')
            for (const setting of layer.settings)
              if (setting.name === 'gain')
                for (const l of setting.value.layers)
                  if (l.kind === 'rewrite' && l.name === 'range') {
                    l.args = [
                      { kind: 'literal', value: 0.25 },
                      { kind: 'literal', value: 0.55 },
                    ];
                    changed = true;
                  }
        if (!changed) throw Error('No hat gain range');
      }
      editor.apply(doc);
      await editor.settle();
    }, step);
    await page.waitForFunction(
      (count) => window.viewProbe.frame?.history?.versions.length === count,
      step + 2,
    );
    await expect(canvas).toHaveAttribute('data-state', 'ready');
  }
  const pencil = stage.getByLabel('Peel pencil version'),
    ink = stage.getByLabel('Peel ink version');
  const versions = await page.evaluate(() => window.viewProbe.frame!.history!.versions);
  expect(versions).toHaveLength(5);
  // Default is immediately previous versus present, so only the gain setting changes.
  expect(await pencil.inputValue()).toBe(versions[3].id);
  await page.screenshot({ path: `${shots}/default-previous.png` });
  await pencil.selectOption(versions[0].id);
  await expect(canvas).toHaveAttribute('data-state', 'ready');
  const scores = await page.evaluate(async () => {
    const selects = document.querySelectorAll<HTMLSelectElement>('[data-region="stage-a"] select');
    const answers = await Promise.all(
      Array.from(selects).map((s) => window.viewProbe.frame!.history!.score(s.value)),
    );
    return answers.map((a) => {
      if (a.status !== 'available') throw Error(a.reason);
      return a.score;
    });
  });
  const diff = compareScores(scores[0], scores[1]);
  expect(barCounts(diff, 10)).toEqual({ added: 1, removed: 1, moved: 1, settings: 1 });
  await writeFile(`${shots}/scores.json`, JSON.stringify(scores));
  const themeMeasures: unknown[] = [];
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${shots}/${theme}-1920x1080.png` });
    await canvas.screenshot({ path: `${shots}/${theme}-stage-a.png` });
    const measured = await page.evaluate(
      async ({ scores, theme }) => {
        const source = { ...window.viewProbe.frame!, width: 1300, height: 760, dpr: 1, now: 10.4 };
        const realVersions = source.history!.versions;
        const asked: string[] = [];
        // Controlled delivery of the real scores proves pending, pair-only queries, and stale-answer rejection.
        const deliveries: ((value: { status: 'available'; score: ViewHistoryScore }) => void)[] =
          [];
        const pending = {
          versions: realVersions,
          score: (id: string) => {
            asked.push(id);
            return new Promise<{ status: 'available'; score: ViewHistoryScore }>((resolve) =>
              deliveries.push(resolve),
            );
          },
        };
        const el = document.createElement('div');
        document.body.append(el);
        const handle = await window.viewProbe.definition.mount(el);
        const freshHistory = {
          versions: realVersions.filter((v) => v.position === 'present'),
          score: () => {
            throw Error('Fresh sessions must not query history');
          },
        };
        handle.frame({ ...source, history: freshHistory });
        handle.frame({ ...source, now: 38.4, from: 28, to: 56, history: freshHistory });
        const freshWrapState = el.querySelector('canvas')!.dataset.state;
        handle.frame({ ...source, history: pending });
        const initialState = el.querySelector('canvas')!.dataset.state;
        const selects = el.querySelectorAll('select');
        selects[0].value = realVersions[0].id;
        selects[0].dispatchEvent(new Event('change'));
        // Resolve the superseded pair with a different score after the chosen pair.
        deliveries[2]({ status: 'available', score: scores[0] });
        deliveries[3]({ status: 'available', score: scores[1] });
        await Promise.resolve();
        await Promise.resolve();
        const current = el.querySelector('canvas')!.toDataURL();
        deliveries[0]({ status: 'available', score: scores[1] });
        deliveries[1]({ status: 'available', score: scores[1] });
        await Promise.resolve();
        await Promise.resolve();
        const staleIgnored = current === el.querySelector('canvas')!.toDataURL();
        const stable = { ...source, history: pending };
        handle.frame(stable);
        const picture = el.querySelector('canvas')!.toDataURL();
        handle.frame({ ...stable, now: 22, width: 560, height: 675 });
        handle.frame({ ...stable, now: 4 });
        handle.frame(stable);
        const deterministic = picture === el.querySelector('canvas')!.toDataURL();
        const times: number[] = [];
        for (let i = 0; i < 330; i++) {
          const start = performance.now();
          handle.frame({ ...stable, now: 10.4 + i / 10000 });
          if (i >= 30) times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        // Unknown future ranges retain only the labelled, unshifted prior sheet.
        const wrapTexts: string[] = [];
        const fill = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
          wrapTexts.push(text);
          if (max === undefined) fill.call(this, text, x, y);
          else fill.call(this, text, x, y, max);
        };
        handle.frame({ ...stable, now: 38.4, from: 28, to: 56 });
        CanvasRenderingContext2D.prototype.fillText = fill;
        const wrapState = el.querySelector('canvas')!.dataset.state;
        const previewFrom = el.querySelector('canvas')!.dataset.sheetFrom;
        selects[0].value = realVersions[1].id;
        selects[0].dispatchEvent(new Event('change'));
        const peelState = el.querySelector('canvas')!.dataset.state;
        // Measure label contrast on the actual composited top sheet, plus the theme ground.
        const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
        const lum = (v: number[]) =>
          v
            .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
            .reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
        const foreground = lum(rgb(source.theme.text)),
          panel = rgb(source.theme.panel),
          text = rgb(source.theme.text);
        const sheet = lum(panel.map((v, i) => v * 0.88 + text[i] * 0.12)),
          ground = lum(rgb(source.theme.ground));
        const contrast = (b: number) =>
          (Math.max(foreground, b) + 0.05) / (Math.min(foreground, b) + 0.05);
        handle.dispose();
        for (const deliver of deliveries.slice(4))
          deliver({ status: 'available', score: scores[0] });
        await Promise.resolve();
        await Promise.resolve();
        const released = el.childElementCount === 0;
        el.remove();
        return {
          theme,
          initialState,
          freshWrapState,
          wrapState,
          previewFrom,
          wrapTexts,
          peelState,
          released,
          asked,
          staleIgnored,
          deterministic,
          frames: 300,
          median: (times[149] + times[150]) / 2,
          p95: times[285],
          contrast: Math.min(contrast(sheet), contrast(ground)),
        };
      },
      { scores, theme },
    );
    expect(measured.freshWrapState).toBe('empty');
    expect(measured.initialState).toBe('pending');
    expect(measured.asked).toHaveLength(8);
    expect(measured.wrapState).toBe('pending-preview');
    expect(measured.previewFrom).toBe('0');
    expect(
      measured.wrapTexts.some((t) => t.startsWith('Loading bars 29–56 · previous bars 1–28')),
    ).toBe(true);
    expect(measured.wrapTexts.some((t) => t.startsWith('BAR 11'))).toBe(true);
    expect(measured.peelState).toBe('pending');
    expect(measured.released).toBe(true);
    expect(measured.staleIgnored).toBe(true);
    expect(measured.deterministic).toBe(true);
    expect(measured.contrast).toBeGreaterThanOrEqual(4.5);
    themeMeasures.push(measured);
  }
  await page.evaluate(async () => {
    await window.odmStudio.seek(38.4);
  });
  await expect(canvas).toHaveAttribute('data-state', 'pending-preview');
  await expect(canvas).toHaveAttribute('data-sheet-from', '0');
  await page.screenshot({ path: `${shots}/wrap-pending-previous-range.png` });
  await expect(canvas).toHaveAttribute('data-state', 'ready');
  await expect(canvas).toHaveAttribute('data-sheet-from', '28');
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.4);
  });
  await expect(canvas).toHaveAttribute('data-state', 'ready');
  await expect(canvas).toHaveAttribute('data-sheet-from', '0');
  await pencil.selectOption(versions[2].id);
  await expect(canvas).toHaveAttribute('data-state', 'ready');
  await page.screenshot({ path: `${shots}/peel-two-versions-back.png` });
  // Double-click on the paper resets view-only state without touching history.
  await canvas.dblclick({ position: { x: 60, y: 110 } });
  expect(await pencil.inputValue()).toBe(versions[3].id);
  expect(await ink.inputValue()).toBe(versions[4].id);
  await pencil.selectOption(versions[0].id);
  await expect(canvas).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.evaluate(async () => {
    await window.odmStudio.seek(10.4);
  });
  // Actual narrow Stage B, with the same real history and peel interaction.
  await page.setViewportSize({ width: 2560, height: 1440 });
  const choice = page
    .locator('[data-region="view-shelf"]')
    .getByRole('button', { name: 'Tracing paper on Stage B', exact: true });
  await revealView(choice);
  await choice.click();
  await expect(b.locator('canvas')).toHaveAttribute('data-state', 'ready');
  await b.getByLabel('Peel pencil version').selectOption(versions[0].id);
  await expect(b.locator('canvas')).toHaveAttribute('data-state', 'ready');
  await b.screenshot({ path: `${shots}/stage-b-560.png` });
  // A no-op document edit is honestly identical in score.
  await page.evaluate(async () => {
    const e = window.odmStudio.app.editor!;
    e.apply(structuredClone(e.state.doc));
    await e.settle();
  });
  await canvas.dblclick({ position: { x: 60, y: 110 } });
  await expect(canvas).toHaveAttribute('data-state', 'identical');
  await page.screenshot({ path: `${shots}/identical-score.png` });
  const bandAgain = page
    .locator('[data-region="view-shelf"]')
    .getByRole('button', { name: 'The band on Stage B', exact: true });
  await revealView(bandAgain);
  await bandAgain.click();
  // Loading a different corpus piece replaces the editing session.
  const replacement = await page.evaluateHandle(
    (source) => ({ completion: window.odmStudio.load(source) }),
    await readFile('corpus/programs/real-techno.strudel', 'utf8'),
  );
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await replacement.evaluate(async (value) => {
    await value.completion;
  });
  await replacement.dispose();
  await page.evaluate(async () => {
    await window.odmStudio.seek(1.4);
  });
  await expect(canvas).toHaveAttribute('data-state', 'empty');
  await page.screenshot({ path: `${shots}/real-techno-no-edits.png` });
  await page.evaluate(async () => {
    const e = window.odmStudio.app.editor!;
    const doc = structuredClone(e.state.doc);
    function visit(v: unknown) {
      if (!v || typeof v !== 'object') return;
      if ('name' in v && v.name === 'shape' && 'value' in v) {
        const p = v.value as Pattern;
        p.core = { kind: 'constant', value: 0.2 };
      }
      for (const x of Object.values(v)) visit(x);
    }
    visit(doc);
    e.apply(doc as Doc);
    await e.settle();
  });
  await expect(canvas).toHaveAttribute('data-state', 'ready');
  await page.screenshot({ path: `${shots}/real-techno-edited.png` });
  const mapping = {
    bar11: barCounts(diff, 10),
    song: {
      added: diff.added.length,
      removed: diff.removed.length,
      moved: diff.moved.length,
      settings: diff.settings,
      spans: diff.resized.length,
    },
    themeMeasures,
  };
  await writeFile(`${shots}/measurements.json`, JSON.stringify(mapping, null, 2));
  console.log('TRACING PAPER MEASURED', JSON.stringify(mapping));
});
