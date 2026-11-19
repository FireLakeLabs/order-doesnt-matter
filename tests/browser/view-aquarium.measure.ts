import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { prepare } from './view-evidence';
import { revealView } from './shelf';
import { aquarium } from '../../src/views/aquarium/model';
import { indexStage } from '../../src/views/soundstage/model';

const shots = `${process.env.ODM_VIEW_MEASURE_DIR}/aquarium`;
const mapping = (frame: Parameters<typeof aquarium>[0]) => {
  const model = aquarium(frame, indexStage(frame.notes));
  return {
    tanks: model.tanks.map((t) => ({
      orbit: t.orbit,
      fish: t.fish.map((p) => p.instrument.name),
      contested: t.contested,
      requests: t.requests.map((r) => ({
        name: r.instrument.name,
        start: r.start,
        setting: r.setting,
        value: r.value,
      })),
      onsets: t.bubbles.length,
      bubbles: t.bubbles.reduce((n, b) => n + b.count, 0),
    })),
    dry: model.dry.fish.map((p) => p.instrument.name),
  };
};
test('Aquarium: Studio themes, actual rooms, reversible pixels and frame submission', async ({
  page,
}) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, 'aquarium');
  await page.setViewportSize({ width: 2560, height: 1440 });
  const choice = page.locator('[data-region="view-shelf"] [data-view="loom"] .view-to-b');
  await revealView(choice);
  await choice.click();
  await page.evaluate(async () => {
    window.odmStudio.pause();
    await window.odmStudio.seek(10.4);
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForFunction(() => window.viewProbe.frame?.now === 10.4);
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  const frames = [];
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    frames.push(await page.evaluate(() => window.viewProbe.frame!));
    await page.screenshot({ path: `${shots}/${theme}-1920x1080.png` });
  }
  const frame = frames[0],
    real = mapping(frame);
  expect(real.tanks).toHaveLength(1);
  expect(real.tanks[0].fish).toEqual(['sd · drop', 'wobbleBass']);
  expect(real.dry).toHaveLength(4);
  await writeFile(`${shots}/frame.json`, JSON.stringify(frame, null, 2));
  const measured = await page.evaluate(async (frames) => {
    const el = document.createElement('div');
    document.body.append(el);
    const handle = await window.viewProbe.definition.mount(el);
    const results = [];
    const luminance = (hex: string) =>
      hex
        .match(/[a-f\d]{2}/gi)!
        .map((v) => {
          const n = parseInt(v, 16) / 255;
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        })
        .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: string, b: string) =>
      (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    for (const source of frames) {
      const frame = { ...source, width: 1300, height: 760, dpr: 1 };
      handle.frame(frame);
      const before = el.querySelector('canvas')!.toDataURL();
      handle.frame({ ...frame, now: 1.2, width: 560, height: 675 });
      handle.frame({ ...frame, now: 22 });
      handle.frame(frame);
      const reversible = before === el.querySelector('canvas')!.toDataURL();
      const sizes = [];
      const scenarios = [
        frame,
        {
          ...frame,
          rooms: Array.from({ length: 7 }, (_, orbit) => ({
            orbit,
            members: frame.instruments.map((i) => i.id),
          })),
          notes: frame.instruments.map((p, i) => ({
            instrument: p.id,
            start: 10,
            end: 11,
            hasOnset: true,
            value: { orbit: i % 7, room: 0.8, size: i % 2 },
          })),
        },
        {
          ...frame,
          rooms: [{ orbit: 0, members: frame.instruments.map((i) => i.id) }],
          notes: frame.instruments.slice(0, 2).map((p, i) => ({
            instrument: p.id,
            start: 10,
            end: 11,
            hasOnset: true,
            value: { orbit: 0, room: 0.8, size: i ? 8 : 2 },
          })),
        },
        { ...frame, now: 10.996, rooms: [], notes: frame.notes.map((n) => ({ ...n, value: {} })) },
      ];
      for (const [scenario, source] of scenarios.entries())
        for (const [width, height] of [
          [1300, 760],
          [560, 675],
          [frame.width === 1300 ? 1131 : frame.width, 469],
        ]) {
          const labels: {
            text: string;
            left: number;
            right: number;
            top: number;
            bottom: number;
            size: number;
          }[] = [];
          const original = CanvasRenderingContext2D.prototype.fillText;
          CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
            const m = this.measureText(text);
            labels.push({
              text,
              left: x - m.actualBoundingBoxLeft,
              right: x + m.actualBoundingBoxRight,
              top: y - m.actualBoundingBoxAscent,
              bottom: y + m.actualBoundingBoxDescent,
              size: Number(this.font.match(/([\d.]+)px/)?.[1]),
            });
            if (maxWidth === undefined) original.call(this, text, x, y);
            else original.call(this, text, x, y, maxWidth);
          };
          try {
            handle.frame({ ...source, width, height });
          } finally {
            CanvasRenderingContext2D.prototype.fillText = original;
          }
          const overlaps = labels.flatMap((a, i) =>
            labels
              .slice(i + 1)
              .filter(
                (b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom,
              )
              .map((b) => [a.text, b.text]),
          );
          sizes.push({
            scenario,
            width,
            height,
            labels: labels.length,
            minFont: Math.min(...labels.map((l) => l.size)),
            hundredPercent: labels.some((l) => l.text.includes('100%')),
            overlaps,
          });
        }
      results.push({
        theme: frame.theme.name,
        reversible,
        contrastGround: ratio(frame.theme.text, frame.theme.ground),
        contrastPanel: ratio(frame.theme.text, frame.theme.panel),
        sizes,
      });
    }
    const times = [];
    const source = { ...frames[0], width: 1300, height: 760, dpr: 1 };
    for (let i = 0; i < 330; i++) {
      const start = performance.now();
      handle.frame({ ...source, now: 10.4 + i / 1000 });
      if (i >= 30) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    handle.dispose();
    el.remove();
    return {
      themes: results,
      cpu: {
        frames: times.length,
        median: (times[149] + times[150]) / 2,
        p95: times[285],
        max: times[299],
        width: 1300,
        height: 760,
        dpr: 1,
      },
      notes: source.notes.length,
      userAgent: navigator.userAgent,
    };
  }, frames);
  for (const theme of measured.themes) {
    expect(theme.reversible).toBe(true);
    expect(theme.contrastGround).toBeGreaterThanOrEqual(4.5);
    expect(theme.contrastPanel).toBeGreaterThanOrEqual(4.5);
    for (const size of theme.sizes) {
      expect(size.minFont).toBeGreaterThanOrEqual(11);
      expect(size.hundredPercent).toBe(false);
      expect(size.overlaps).toEqual([]);
    }
  }
  for (const width of [1300, 560]) {
    const picture = await page.evaluate(
      async ({ frame, width }) => {
        const el = document.createElement('div');
        document.body.append(el);
        const handle = await window.viewProbe.definition.mount(el);
        const instruments = Array.from({ length: 7 }, (_, index) => ({
          ...frame.instruments[index % frame.instruments.length],
          id: String(index),
          index,
          name: `part ${String(index + 1)}`,
          inSection: true,
        }));
        handle.frame({
          ...frame,
          width,
          height: 675,
          instruments,
          rooms: instruments.map((i) => ({ orbit: i.index, members: [i.id] })),
          notes: instruments.map((i) => ({
            instrument: i.id,
            start: 10,
            end: 11,
            hasOnset: true,
            value: { orbit: i.index, room: 0.8, size: 0.7 },
          })),
        });
        const picture = el.querySelector('canvas')!.toDataURL();
        handle.dispose();
        el.remove();
        return picture;
      },
      { frame, width },
    );
    await writeFile(
      `${shots}/shelf-${String(width)}.png`,
      Buffer.from(picture.split(',')[1], 'base64'),
    );
  }
  await page.setViewportSize({ width: 2560, height: 1440 });
  const aquariumB = page.locator('[data-region="view-shelf"] [data-view="aquarium"] .view-to-b');
  await revealView(aquariumB);
  await aquariumB.click();
  await expect(page.locator('[data-region="stage-b"] .view-host')).toHaveAttribute(
    'data-score-ready',
    'true',
  );
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  await page.locator('[data-region="stage-b"]').screenshot({ path: `${shots}/stage-b-560.png` });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(
    () => !!window.viewProbe.frame?.playing && window.viewProbe.frame.now > 10.4,
  );
  await page.screenshot({ path: `${shots}/playing-2560x1440.png` });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  // The probe is now Stage B; both stages show the same score and view.
  const corpus = [];
  for (const file of ['real-techno', 'micro-orbit-conflict', 'micro-tree-stack']) {
    await page.evaluate(
      async (source) => {
        await window.odmStudio.load(source);
        await window.odmStudio.seek(0.4);
      },
      await readFile(`corpus/programs/${file}.strudel`, 'utf8'),
    );
    await page.waitForFunction(
      () => window.viewProbe.frame?.now === 0.4 && window.viewProbe.frame.notes.length > 0,
    );
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    const f = await page.evaluate(() => window.viewProbe.frame!);
    corpus.push({ file, ...mapping(f) });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: `${shots}/${file}-1920x1080.png` });
  }
  expect(corpus[1].tanks[0].contested).toBe(true);
  expect(corpus[2].tanks).toEqual([]);
  expect(corpus[2].dry).toHaveLength(3);
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify({ ...measured, real, corpus }, null, 2),
  );
  console.log('Aquarium measured:', JSON.stringify({ ...measured, real, corpus }));
});

for (const [piece, now] of [
  ['real-dubstep-arranged', 10.4],
  ['real-techno', 1.4],
] as const)
  test(`Aquarium: dry bowl separation on ${piece}`, async ({ page }) => {
    await mkdir(shots, { recursive: true });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepare(page, 'aquarium', piece);
    await page.evaluate(async (now) => {
      await window.odmStudio.seek(now);
    }, now);
    await page.waitForFunction((now) => window.viewProbe.frame?.now === now, now);
    const frame = await page.evaluate(() => window.viewProbe.frame!);
    const dryCount = mapping(frame).dry.length;
    expect(dryCount).toBe(piece === 'real-dubstep-arranged' ? 4 : 3);
    for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
      await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
      await page.waitForFunction((name) => window.viewProbe.frame?.theme.name === name, theme);
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      });
      // Capture in the Studio at the sweep's exact piece, time and viewport.
      await page.screenshot({ path: `${shots}/${piece}-${theme}-sweep.png` });
      await page.locator('[data-region="stage-a"] canvas').screenshot({
        path: `${shots}/${piece}-${theme}-sweep-stage-a.png`,
      });
      const drawn = await page.evaluate((dryCount) => {
        const frame = window.viewProbe.frame!;
        const fish: { x: number; y: number; sx: number; sy: number }[] = [];
        const outlines: { x: number; y: number; width: number; height: number }[] = [];
        const labels: { text: string; y: number }[] = [];
        const proto = CanvasRenderingContext2D.prototype;
        const ellipse = proto.ellipse,
          roundRect = proto.roundRect,
          fillText = proto.fillText;
        proto.ellipse = function (...args) {
          if (args[2] === 26 && args[3] === 13) {
            const m = this.getTransform();
            fish.push({
              x: m.e / frame.dpr,
              y: m.f / frame.dpr,
              sx: Math.abs(m.a) / frame.dpr,
              sy: Math.abs(m.d) / frame.dpr,
            });
          }
          return ellipse.apply(this, args);
        };
        proto.roundRect = function (x, y, width, height, radii) {
          outlines.push({ x, y, width, height });
          return roundRect.call(this, x, y, width, height, radii);
        };
        proto.fillText = function (text, x, y, maxWidth) {
          labels.push({ text, y });
          if (maxWidth === undefined) fillText.call(this, text, x, y);
          else fillText.call(this, text, x, y, maxWidth);
        };
        try {
          window.viewProbe.handle!.frame(frame);
        } finally {
          proto.ellipse = ellipse;
          proto.roundRect = roundRect;
          proto.fillText = fillText;
        }
        const bowl = outlines.at(-1)!;
        const dry = fish.slice(-dryCount).map((p) => ({
          left: p.x - 38 * p.sx,
          right: p.x + 38 * p.sx,
          top: p.y - 28 * p.sy,
          bottom: p.y + 28 * p.sy,
        }));
        const overlaps = dry.flatMap((a, i) =>
          dry
            .slice(i + 1)
            .filter(
              (b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom,
            ),
        );
        const summary = labels.find((l) => l.text.startsWith(`${String(dryCount)} fish`))!;
        const canvas = document.querySelector<HTMLCanvasElement>('[data-region="stage-a"] canvas')!;
        const pixels = canvas.toDataURL();
        window.viewProbe.handle!.frame({ ...frame, now: 2 });
        window.viewProbe.handle!.frame({ ...frame, now: 17 });
        window.viewProbe.handle!.frame(frame);
        return { overlaps, dry, bowl, summary, reversible: pixels === canvas.toDataURL() };
      }, dryCount);
      expect(drawn.overlaps).toEqual([]);
      expect(drawn.summary.y - 12).toBeGreaterThan(drawn.bowl.y + drawn.bowl.height);
      expect(drawn.reversible).toBe(true);
      for (const fish of drawn.dry) {
        expect(fish.left).toBeGreaterThan(drawn.bowl.x);
        expect(fish.right).toBeLessThan(drawn.bowl.x + drawn.bowl.width);
        expect(fish.top).toBeGreaterThan(drawn.bowl.y);
        expect(fish.bottom).toBeLessThan(drawn.bowl.y + drawn.bowl.height);
      }
    }
  });
