import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { indexRelay, relayFocus, relayLayout } from '../../src/views/relay/model';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/relay`;
test('Relay: real Studio mapping, five themes, narrow lanes and pure-time CPU evidence', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  const ready = async () => {
    await page.waitForFunction(
      () =>
        window.odmStudio.app.canPlay &&
        document.querySelector('[data-region="score"]')?.getAttribute('data-score-ready') ===
          'true' &&
        Array.from(document.querySelectorAll('.view-host')).every(
          (el) => el.getAttribute('data-score-ready') === 'true',
        ),
    );
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
  };
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'relay');
  // A second view stays in Stage B in every full Studio capture.
  const stageB = page.locator('[data-region="stage-b"]');
  await stageB.getByRole('button', { name: 'Views', exact: true }).click();
  const companion = stageB.locator('.shelf-popover [data-view="quilt"] .view-to-b');
  await revealView(companion);
  await companion.click();
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await ready();
  const frame = await page.evaluate(() => window.viewProbe.frame!);
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const score = indexRelay(frame),
    focus = relayFocus(score, 10.4);
  const mapping = {
    records: frame.notes.length,
    attacks: frame.notes.filter((n) => n.hasOnset).length,
    phrases: score.phrases
      .filter((p) => p.shape)
      .map((p) => ({
        id: p.id,
        part: frame.instruments.find((i) => i.id === p.instrument)?.name,
        from: p.from,
        to: p.to,
        pitches: p.pitches,
        records: p.notes.length,
      })),
    returns: score.returns,
    current: [...focus.current],
    related: [...focus.related],
  };
  const measurements = [];
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await ready();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${shots}/dubstep-${theme}-1920x1080.png` });
    await page
      .locator('[data-region="stage-a"] canvas')
      .screenshot({ path: `${shots}/dubstep-${theme}-stage-a.png` });
    const measured = await page.evaluate(async () => {
      const source = { ...window.viewProbe.frame!, now: 10.4, width: 1300, height: 760, dpr: 1 };
      const el = document.createElement('div');
      document.body.append(el);
      const handle = await window.viewProbe.definition.mount(el);
      const canvas = el.querySelector('canvas')!;
      const run = (rebuilt: boolean) => {
        const times: number[] = [];
        for (let i = 0; i < 330; i++) {
          const f = {
            ...source,
            now: 10.4 + i / 1000,
            notes: rebuilt ? source.notes.slice() : source.notes,
          };
          const start = performance.now();
          handle.frame(f);
          if (i >= 30) times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        return { frames: times.length, median: (times[149] + times[150]) / 2, p95: times[285] };
      };
      const cached = run(false),
        rebuilt = run(true);
      handle.frame(source);
      const picture = canvas.toDataURL();
      handle.frame({ ...source, now: 22, width: 560, height: 469 });
      handle.frame({ ...source, now: 0.1 });
      handle.frame(source);
      const reversible = picture === canvas.toDataURL();
      const freshEl = document.createElement('div');
      document.body.append(freshEl);
      const fresh = await window.viewProbe.definition.mount(freshEl);
      fresh.frame(source);
      const freshEqual = picture === freshEl.querySelector('canvas')!.toDataURL();
      fresh.dispose();
      freshEl.remove();
      // Collect the actual painted text and verify font sizes, bounds and contrast.
      const labels: {
        text: string;
        x: number;
        y: number;
        width: number;
        size: number;
        colour: string;
      }[] = [];
      const fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
        const width = this.measureText(text).width;
        labels.push({
          text,
          x: this.textAlign === 'center' ? x - width / 2 : x,
          y,
          width,
          size: parseFloat(this.font),
          colour: String(this.fillStyle),
        });
        if (max === undefined) fill.call(this, text, x, y);
        else fill.call(this, text, x, y, max);
      };
      const sizes = [];
      for (const [width, height] of [
        [1300, 760],
        [560, 675],
        [487, 468],
      ]) {
        labels.length = 0;
        handle.frame({ ...source, width, height });
        const captured = labels.slice();
        const collisions = captured.flatMap((a, i) =>
          captured
            .slice(i + 1)
            .filter(
              (b) =>
                a.x < b.x + b.width &&
                a.x + a.width > b.x &&
                a.y - a.size < b.y &&
                a.y > b.y - b.size,
            )
            .map((b) => [a.text, b.text]),
        );
        sizes.push({ width, height, labels: captured, collisions });
      }
      labels.length = 0;
      const wobble = source.instruments.find((i) => i.name === 'wobbleBass')!.id;
      handle.frame({
        ...source,
        notes: source.notes.map((n) =>
          n.instrument === wobble && n.start === 10
            ? { ...n, value: { ...n.value, note: 'e2' } }
            : n,
        ),
      });
      const nearLabels = labels.map((l) => l.text);
      labels.length = 0;
      handle.frame({
        ...source,
        width: 487,
        height: 468,
        now: 2.6,
        sections: Array.from({ length: 28 }, (_, i) => ({ name: 'Block', from: i, to: i + 1 })),
        notes: source.notes.map((n) => ({ ...n, start: n.start / 4, end: n.end / 4 })),
      });
      const compacted = labels.some((l) => l.text === 'Current returns compacted to counts');
      CanvasRenderingContext2D.prototype.fillText = fill;
      const rgb = (hex: string) =>
        hex
          .match(/[\da-f]{2}/gi)!
          .map((n) => parseInt(n, 16) / 255)
          .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
      const lum = (hex: string) =>
        rgb(hex).reduce((s, n, i) => s + n * [0.2126, 0.7152, 0.0722][i], 0);
      const text = lum(source.theme.text);
      const contrast = Math.min(
        ...[source.theme.ground, source.theme.panel].map((bg) => {
          const b = lum(bg);
          return (Math.max(text, b) + 0.05) / (Math.min(text, b) + 0.05);
        }),
      );
      handle.dispose();
      el.remove();
      return {
        theme: source.theme.name,
        cached,
        rebuilt,
        reversible,
        freshEqual,
        sizes,
        contrast,
        nearLabels,
        compacted,
      };
    });
    expect(measured.nearLabels.some((text) => text.includes('near +12 st · d 0.2'))).toBe(true);
    expect(measured.compacted).toBe(true);
    expect(measured.reversible).toBe(true);
    expect(measured.freshEqual).toBe(true);
    expect(measured.contrast).toBeGreaterThanOrEqual(4.5);
    for (const size of measured.sizes) {
      expect(size.collisions).toEqual([]);
      const nameBoundary = relayLayout(size.width, size.height, frame.instruments.length).left - 24;
      const names = size.labels.filter(
        (l) => /^\d+ /.test(l.text) && l.y > 112 && l.y < size.height - 128,
      );
      expect(names.every((l) => l.x + l.width <= nameBoundary)).toBe(true);
      expect(
        size.labels.some(
          (l) =>
            l.text.includes('(40 notes, 88 records)') && l.text.endsWith('305 capsule records'),
        ),
      ).toBe(true);
      expect(
        size.labels.every(
          (l) => l.size >= 11 && l.x >= 0 && l.x + l.width <= size.width && l.y <= size.height,
        ),
      ).toBe(true);
    }
    measurements.push(measured);
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await ready();
  await page.screenshot({ path: `${shots}/playing-1920x1080.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.evaluate(async () => window.odmStudio.seek(10.4));
  await page.setViewportSize({ width: 2560, height: 1440 });
  const choice = page
    .locator('[data-region="view-shelf"]')
    .getByRole('button', { name: 'Relay on Stage B', exact: true });
  await revealView(choice);
  await choice.click();
  await expect(stageB.locator('.view-host')).toHaveAttribute('data-score-ready', 'true');
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  await ready();
  await stageB.screenshot({ path: `${shots}/stage-b-560.png` });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  await ready();
  await stageB.screenshot({ path: `${shots}/stage-b-narrow.png` });
  // Remove the second Relay mount so the probe follows Stage A again.
  await stageB.getByRole('button', { name: 'Views', exact: true }).click();
  const quilt = stageB.locator('.shelf-popover [data-view="quilt"] .view-to-b');
  await revealView(quilt);
  await quilt.click();
  await page.evaluate(
    async (source) => {
      await window.odmStudio.load(source);
      await window.odmStudio.seek(1.4);
    },
    await readFile('corpus/programs/real-techno.strudel', 'utf8'),
  );
  await page.waitForFunction(
    () =>
      window.viewProbe.frame?.now === 1.4 &&
      window.viewProbe.frame.sections.length === 0 &&
      window.viewProbe.frame.notes.length > 0,
  );
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((theme) => window.viewProbe.frame?.theme.name === theme, theme);
    await ready();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${shots}/techno-${theme}-1920x1080.png` });
  }
  const techno = await page.evaluate(() => window.viewProbe.frame!);
  const other = indexRelay(techno);
  const result = {
    mapping,
    techno: {
      records: techno.notes.length,
      attacks: techno.notes.filter((n) => n.hasOnset).length,
      returns: other.returns.length,
    },
    measurements,
  };
  await writeFile(`${shots}/measurements.json`, JSON.stringify(result, null, 2));
  console.log(
    'Relay mapping and frame cost:',
    JSON.stringify({
      records: mapping.records,
      returns: mapping.returns.length,
      techno: result.techno,
      measurements: measurements.map((m) => ({
        theme: m.theme,
        cached: m.cached,
        rebuilt: m.rebuilt,
        reversible: m.reversible,
        freshEqual: m.freshEqual,
        contrast: m.contrast,
      })),
    }),
  );
});
