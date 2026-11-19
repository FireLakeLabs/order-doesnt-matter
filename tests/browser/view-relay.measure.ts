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
      const heads: { x: number; y: number; radius: number; alpha: number }[] = [];
      const curves: {
        strong: boolean;
        dashed: boolean;
        from: number[];
        control: number[];
        to: number[];
      }[] = [];
      const arrows: number[][][] = [];
      const batons: { x: number; y: number; width: number; height: number }[] = [];
      let points: number[][] = [];
      const begin = CanvasRenderingContext2D.prototype.beginPath;
      const pathMove = CanvasRenderingContext2D.prototype.moveTo;
      const pathLine = CanvasRenderingContext2D.prototype.lineTo;
      const pathFill = CanvasRenderingContext2D.prototype.fill;
      const pathRound = CanvasRenderingContext2D.prototype.roundRect;
      CanvasRenderingContext2D.prototype.beginPath = function () {
        points = [];
        return begin.call(this);
      };
      CanvasRenderingContext2D.prototype.moveTo = function (x, y) {
        points.push([x, y]);
        return pathMove.call(this, x, y);
      };
      CanvasRenderingContext2D.prototype.lineTo = function (x, y) {
        points.push([x, y]);
        return pathLine.call(this, x, y);
      };
      CanvasRenderingContext2D.prototype.fill = function () {
        if (points.length === 3 && this.globalAlpha === 1) arrows.push(points.slice());
        Reflect.apply(pathFill, this, []);
      };
      CanvasRenderingContext2D.prototype.roundRect = function (x, y, width, height, radii) {
        if (height <= 22) batons.push({ x, y, width, height });
        return pathRound.call(this, x, y, width, height, radii);
      };
      const circle = CanvasRenderingContext2D.prototype.arc;
      const curve = CanvasRenderingContext2D.prototype.bezierCurveTo;
      CanvasRenderingContext2D.prototype.arc = function (x, y, radius, start, end, ccw) {
        heads.push({ x, y, radius, alpha: this.globalAlpha });
        return circle.call(this, x, y, radius, start, end, ccw);
      };
      CanvasRenderingContext2D.prototype.bezierCurveTo = function (a, b, d, e, x, y) {
        curves.push({
          strong: this.globalAlpha === 1,
          dashed: this.getLineDash().length > 0,
          from: points[0],
          control: [d, e],
          to: [x, y],
        });
        return curve.call(this, a, b, d, e, x, y);
      };
      const sizes = [];
      for (const [width, height] of [
        [1300, 760],
        [560, 675],
        [487, 468],
      ]) {
        labels.length = 0;
        heads.length = 0;
        curves.length = 0;
        arrows.length = 0;
        batons.length = 0;
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
        sizes.push({
          width,
          height,
          labels: captured,
          collisions,
          heads: heads.slice(),
          curves: curves.slice(),
          arrows: arrows.slice(),
          batons: batons.slice(),
        });
      }
      CanvasRenderingContext2D.prototype.beginPath = begin;
      CanvasRenderingContext2D.prototype.moveTo = pathMove;
      CanvasRenderingContext2D.prototype.lineTo = pathLine;
      CanvasRenderingContext2D.prototype.fill = pathFill;
      CanvasRenderingContext2D.prototype.roundRect = pathRound;
      heads.length = 0;
      handle.frame({
        ...source,
        instruments: source.instruments.map((i) => ({ ...i, muted: i.name === 'wobbleBass' })),
      });
      const mutedRunner =
        heads.length === 2 && heads[0].alpha === 1 && Math.abs(heads[1].alpha - 0.3) < 1e-6;
      CanvasRenderingContext2D.prototype.arc = circle;
      labels.length = 0;
      curves.length = 0;
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
      const nearDashed = curves.some((c) => c.dashed);
      CanvasRenderingContext2D.prototype.bezierCurveTo = curve;
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
      labels.length = 0;
      handle.frame({
        ...source,
        notes: source.notes.map((n) => ({ ...n, end: Math.min(n.end, n.start + 1 / 8) })),
      });
      const throughRest =
        labels.some((l) => l.text.includes('13 current returns · 4 bundles')) &&
        labels.some((l) => l.text.includes('exact +12 st · subBass → wobbleBass'));
      const sub = source.instruments.find((i) => i.name === 'subBass')!.id;
      labels.length = 0;
      handle.frame({
        ...source,
        instruments: source.instruments.filter((i) => i.id === sub),
        notes: source.notes.filter((n) => n.instrument === sub),
      });
      const samePart =
        labels.some((l) => l.text.includes('exact 0 st · subBass → subBass')) &&
        !labels.some((l) => l.text.includes('compacted'));
      labels.length = 0;
      handle.frame({
        ...source,
        now: 1.4,
        instruments: source.instruments.filter((i) => i.id === sub || i.id === wobble),
        notes: source.notes
          .filter(
            (n) => (n.instrument === sub || n.instrument === wobble) && n.start >= 8 && n.end <= 12,
          )
          .map((n) => ({ ...n, start: n.start - 8, end: n.end - 8 })),
      });
      const localTag = labels.find((l) => l.text === '+12 ×1');
      const localTagCentre = localTag ? localTag.x + localTag.width / 2 : Infinity;
      const localBundleTag =
        localTagCentre >= 150 && localTagCentre <= 150 + ((1300 - 38 - 150) * 4) / 28;
      const boxes: {
        left: number;
        right: number;
        top: number;
        bottom: number;
        height: number;
      }[] = [];
      const ticks: { left: number; right: number; y: number }[] = [];
      const move = CanvasRenderingContext2D.prototype.moveTo;
      const line = CanvasRenderingContext2D.prototype.lineTo;
      let pen = [0, 0];
      CanvasRenderingContext2D.prototype.moveTo = function (x, y) {
        pen = [x, y];
        return move.call(this, x, y);
      };
      CanvasRenderingContext2D.prototype.lineTo = function (x, y) {
        if (Math.abs(this.globalAlpha - 0.22) < 1e-6 && this.lineWidth === 2)
          ticks.push({ left: Math.min(pen[0], x), right: Math.max(pen[0], x), y });
        return line.call(this, x, y);
      };
      const round = CanvasRenderingContext2D.prototype.roundRect;
      CanvasRenderingContext2D.prototype.roundRect = function (x, y, width, height, radii) {
        boxes.push({
          left: Math.min(x, x + width),
          right: Math.max(x, x + width),
          top: Math.min(y, y + height),
          bottom: Math.max(y, y + height),
          height: Math.abs(height),
        });
        return round.call(this, x, y, width, height, radii);
      };
      let mixedClear = true;
      for (const width of [1300, 487]) {
        boxes.length = 0;
        ticks.length = 0;
        handle.frame({
          ...source,
          width,
          notes: [
            ...source.notes,
            { instrument: sub, start: 7.9, end: 8, hasOnset: true, value: { note: 'g1' } },
          ],
        });
        const batonBoxes = boxes.filter((b) => b.height <= 22);
        const subBoxes = batonBoxes.slice(0, 4);
        const subY = (subBoxes[0].top + subBoxes[0].bottom) / 2;
        const subTicks = ticks.filter((tick) => Math.abs(tick.y - subY) < 1e-6);
        mixedClear =
          mixedClear &&
          batonBoxes.length === 8 &&
          subTicks.length > 0 &&
          subTicks.every((tick) =>
            subBoxes.every((b) => tick.right <= b.left || tick.left >= b.right),
          );
      }
      CanvasRenderingContext2D.prototype.moveTo = move;
      CanvasRenderingContext2D.prototype.lineTo = line;
      CanvasRenderingContext2D.prototype.roundRect = round;
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
        nearDashed,
        compacted,
        throughRest,
        samePart,
        mixedClear,
        mutedRunner,
        localBundleTag,
      };
    });
    expect(measured.nearLabels.some((text) => text.includes('near +12 st · d 0.2'))).toBe(true);
    expect(measured.nearDashed).toBe(true);
    expect(measured.compacted).toBe(true);
    expect(measured.throughRest).toBe(true);
    expect(measured.mixedClear).toBe(true);
    expect(measured.samePart).toBe(true);
    expect(measured.reversible).toBe(true);
    expect(measured.freshEqual).toBe(true);
    expect(measured.contrast).toBeGreaterThanOrEqual(4.5);
    for (const size of measured.sizes) {
      expect(size.collisions).toEqual([]);
      const nameBoundary = relayLayout(size.width, size.height, frame.instruments.length).left - 24;
      const names = size.labels.filter((l) => l.x === 12);
      expect(names.every((l) => l.x + l.width <= nameBoundary)).toBe(true);
      expect(size.heads).toHaveLength(2);
      expect(size.heads.every((head) => head.radius >= 4)).toBe(true);
      expect(size.curves).toHaveLength(mapping.returns.length);
      expect(size.curves.every((curve) => !curve.dashed)).toBe(true);
      expect(size.curves.filter((curve) => curve.strong)).toHaveLength(13);
      expect(size.arrows).toHaveLength(13);
      let upward = 0;
      for (const curve of size.curves
        .filter((c) => c.strong)
        .sort((a, b) => a.to[1] - b.to[1] || b.from[1] - a.from[1])) {
        const target = size.batons.find(
          (b) =>
            Math.abs(b.x + b.width / 2 - curve.to[0]) < 1e-6 &&
            (Math.abs(b.y - curve.to[1]) < 1e-6 || Math.abs(b.y + b.height - curve.to[1]) < 1e-6),
        )!;
        expect(target).toBeDefined();
        const up = target.y + target.height / 2 < curve.from[1];
        if (up) upward++;
        expect(curve.to[1]).toBeCloseTo(up ? target.y + target.height : target.y, 6);
        const arrow = size.arrows.find(
          (a) => Math.abs(a[0][0] - curve.to[0]) < 1e-6 && Math.abs(a[0][1] - curve.to[1]) <= 1.1,
        )!;
        expect(arrow).toBeDefined();
        // The curve and arrow approach the receiving surface from the same side.
        expect(up ? curve.control[1] > curve.to[1] : curve.control[1] < curve.to[1]).toBe(true);
        expect(up ? arrow[1][1] > arrow[0][1] : arrow[1][1] < arrow[0][1]).toBe(true);
      }
      expect(upward).toBe(3);
      const left = relayLayout(size.width, size.height, frame.instruments.length).left;
      // Numeric labels belong to the lane paint or distance markers, never to unmatched dashes.
      expect(
        size.labels.filter((l) => /^\d+$/.test(l.text)).every((l) => l.x < left || l.y < 104),
      ).toBe(true);
      expect(size.labels.some((l) => l.text === '+12 ×4')).toBe(true);
      expect(size.labels.some((l) => l.text === '−12 ×3')).toBe(true);
      expect(
        size.labels.some(
          (l) =>
            l.text.includes('(40 notes, 88 records)') && l.text.endsWith('305 unmatched records'),
        ),
      ).toBe(true);
      expect(
        size.labels.every(
          (l) => l.size >= 11 && l.x >= 0 && l.x + l.width <= size.width && l.y <= size.height,
        ),
      ).toBe(true);
    }
    expect(measured.mutedRunner).toBe(true);
    expect(measured.localBundleTag).toBe(true);
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
