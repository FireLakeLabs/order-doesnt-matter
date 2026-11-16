import type { ViewDefinition, ViewFrame, ViewNote } from './types';
import { clamp } from './shared/retro-2d';
import {
  analyse,
  cameraKick,
  characterHeight,
  coinCount,
  groundHeight,
  impact,
  sectionIndex,
  upperBound,
  type Part,
} from './runner/model';
import { cloud, coin, courier, sprite } from './runner/sprites';

/** Integer-pixel world. No sprite or effect depends on a previous frame. */
function drawRunner(c: CanvasRenderingContext2D, f: ViewFrame, parts: Map<string, Part>) {
  const w = c.canvas.width,
    h = c.canvas.height,
    t = f.theme;
  const pocket = t.name === 'pocket';
  // Pocket deliberately uses just these four inks, including for all sprites.
  const paper = t.ground,
    ink = t.text,
    middle = t.muted,
    pale = t.panel;
  const accent = pocket ? paper : t.accent;
  const colour = (p: Part) =>
    pocket
      ? (f.instruments.find((i) => i.id === p.id)?.index ?? 0) % 2
        ? middle
        : ink
      : (f.instruments.find((i) => i.id === p.id)?.colour ?? accent);
  const active = (p: Part) => f.instruments.some((i) => i.id === p.id && i.inSection);
  const ground = [...parts.values()].find((p) => p.role === 'ground' && active(p));
  const blocks = [...parts.values()].find(
    (p) => p.role === 'block' && active(p) && !f.instruments.find((i) => i.id === p.id)?.muted,
  );
  const pitchFloor = [...parts.values()].find((p) => p.role === 'ground')?.low ?? 24;
  const base = Math.round(h * 0.76),
    gate = Math.round(w / 3);
  const speed = (w - gate) / Math.max(0.001, f.lookAhead);
  const from = f.now - gate / speed,
    to = f.now + f.lookAhead;
  const xAt = (time: number) => Math.round(gate + (time - f.now) * speed);
  const floor = (time: number) => base - groundHeight(ground, time);
  const zone = Math.max(0, sectionIndex(f, f.now));
  const zoneColour =
    zone % 3 === 0
      ? t.accent
      : zone % 3 === 1
        ? t.muted
        : (f.instruments[zone % Math.max(1, f.instruments.length)]?.colour ?? accent);
  c.imageSmoothingEnabled = false;
  c.globalAlpha = 1;
  c.fillStyle = paper;
  c.fillRect(0, 0, w, h);
  // Section-dependent bands change the whole skyline, with no added palette inks.
  c.fillStyle = pocket ? [paper, pale, middle][zone % 3] : zoneColour;
  c.globalAlpha = pocket ? 1 : 0.12;
  c.fillRect(0, 28, w, base - 28);
  c.globalAlpha = 1;
  for (let layer = 0; layer < 2; layer++) {
    const stride = 48 + layer * 29;
    const drift = f.now * speed * (layer ? 0.22 : 0.09);
    c.fillStyle = layer
      ? pocket
        ? zone % 3 === 2
          ? ink
          : middle
        : t.line
      : pocket
        ? pale
        : t.panel;
    for (let n = Math.floor(drift / stride) - 1; n < (drift + w) / stride + 1; n++) {
      const x = Math.round(n * stride - drift);
      const top = base - 22 - ((((n * n + zone * 7 + layer * 13) % 5) + 5) % 5) * 8 - layer * 6;
      c.fillRect(x, top + 12, stride + 1, base - top);
      c.fillRect(x + 8, top + 4, stride - 16, base - top);
      c.fillRect(x + 16, top, stride - 32, base - top);
    }
  }
  // Squared-off constellations/clouds travel more slowly than the terrain.
  c.fillStyle = pocket ? paper : t.muted;
  const drift = f.now * speed * 0.05;
  for (let i = 0; i < 12; i++) {
    const x = Math.round(((((i * 47 - drift) % (w + 40)) + w + 40) % (w + 40)) - 20);
    const y = 38 + ((i * 29 + zone * 11) % Math.max(1, Math.round(h * 0.35)));
    c.fillRect(x, y, i % 3 ? 1 : 7, 1);
    if (i % 3 === 0) c.fillRect(x + 3, y - 3, 1, 7);
  }
  c.save();
  // Kick remains crisp: integer camera motion, strongest exactly on the hit.
  c.translate(0, Math.round(cameraKick(parts, f) * 2));
  // Terrain sampled on the pixel grid retains even subpixel steps as occupancy.
  for (let x = 0; x < w; x++) {
    const y = floor(f.now + (x - gate) / speed);
    c.fillStyle = pocket ? middle : t.line;
    c.fillRect(x, y, 1, h - y);
    c.fillStyle = ground
      ? f.instruments.find((i) => i.id === ground.id)?.muted
        ? middle
        : colour(ground)
      : accent;
    c.fillRect(x, y, 1, 2);
  }
  // Running stitch and scattered stone pixels make the ground a place, not a chart.
  const tile = 12,
    scroll = f.now * speed;
  for (let n = Math.floor((scroll - gate) / tile); n < (scroll + w) / tile; n++) {
    const x = Math.round(n * tile - scroll + gate);
    const y = floor((n * tile) / speed) + 9;
    c.fillStyle = pocket ? paper : t.panel;
    c.fillRect(x + (n % 2 ? 3 : 0), y, 5, 2);
    c.fillRect(x + 2, y + 15, 2, 2);
  }
  // Flags are planted at actual section starts, including subsequent song passes.
  const length = f.sections.at(-1)?.to ?? 0;
  if (length > 0) {
    for (let loop = Math.floor(from / length); loop <= Math.floor(to / length); loop++) {
      for (const s of f.sections) {
        const time = s.from + loop * length,
          x = xAt(time);
        if (x < -50 || x > w + 50) continue;
        const y = floor(time);
        c.fillStyle = ink;
        c.fillRect(x, y - 64, 1, 64);
        c.fillStyle = accent;
        c.fillRect(x + 1, y - 64, 33, 13);
        c.fillRect(x + 1, y - 51, 25, 3);
        c.font = `5px "${t.fontDisplay}"`;
        c.fillStyle = pocket ? ink : paper;
        c.fillText(s.name.toUpperCase(), x + 3, y - 55, 29);
      }
    }
  }
  for (const p of parts.values()) {
    if (!active(p) || p.role === 'ground') continue;
    const muted = f.instruments.find((i) => i.id === p.id)?.muted;
    const col = muted
      ? middle
      : pocket && (p.role === 'coin' || p.role === 'crate')
        ? p.role === 'coin'
          ? paper
          : pale
        : colour(p);
    const instrument = f.instruments.find((i) => i.id === p.id);
    const normalPalette = [col, paper];
    const litPalette = [ink, paper];
    const coinPalette = [col, ink];
    c.globalAlpha = muted && !pocket ? 0.3 : 1;
    const first = 0,
      last = upperBound(p.events, to + 0.3);
    // At high density, every onset still contributes to a counted ribbon.
    const dense = p.density * f.lookAhead > (w - gate) / 8;
    const ribbonY =
      base -
      20 -
      Math.round(
        (instrument?.index ?? 0) * Math.min(5, (base - 50) / Math.max(1, f.instruments.length)),
      );
    for (let i = first; i < last; i++) {
      const e = p.events[i],
        n = e.note;
      if (n.end < from || n.start > to) continue;
      const x = xAt(n.start),
        y = floor(n.start);
      const hit = n.hasOnset && !muted ? impact(n.start, f.now, f.cps) : 0;
      if (p.role === 'platform') {
        const py = Math.round(
          base -
            47 -
            clamp(((e.pitch ?? p.low) - pitchFloor) * 2, 0, Math.max(1, base - 95)) -
            ((instrument?.index ?? 0) % 3) * 12,
        );
        const end = xAt(n.end),
          held = n.hasOnset && n.start <= f.now && n.end > f.now && !muted;
        c.fillStyle = held ? ink : col;
        c.fillRect(
          Math.max(0, x),
          py + 5,
          Math.max(1, Math.min(w, end) - Math.max(0, x)),
          held ? 3 : 1,
        );
        if (!dense && n.hasOnset) sprite(c, cloud, x, py - 1, held ? litPalette : normalPalette);
        continue;
      }
      if (!n.hasOnset) continue;
      if (dense) {
        c.fillStyle = n.start <= f.now ? middle : col;
        c.fillRect(x, ribbonY, Math.max(1, xAt(n.end) - x), 3);
        continue;
      }
      if (p.role === 'coin') {
        // The coin reaches the courier's visor at its exact onset.
        const cy = base - characterHeight(ground, blocks, n.start, f.cps) - 10;
        if (n.start > f.now) sprite(c, coin, x - 3, cy - 3, coinPalette);
        else if (hit) {
          const age = 1 - hit;
          c.fillStyle = accent;
          for (let bit = 0; bit < 4; bit++)
            c.fillRect(
              gate + (bit - 2) * (2 + Math.round(age * 10)),
              cy - Math.round(age * 18) + (bit % 2) * 3,
              2,
              2,
            );
        } else {
          c.fillStyle = middle;
          c.fillRect(x, cy, 1, 1);
        }
      } else if (p.role === 'block') {
        const bump = Math.round(Math.sin((1 - hit) * Math.PI) * hit * 3);
        c.fillStyle = ink;
        c.fillRect(x - 6, y - 18 - bump, 12, 18);
        c.fillStyle = pocket ? (muted ? middle : hit ? paper : pale) : hit ? ink : col;
        c.fillRect(x - 5, y - 17 - bump, 10, 16);
        c.fillStyle = pocket ? ink : paper;
        c.fillRect(x - 1, y - 14 - bump, 2, 6);
        c.fillRect(x - 1, y - 5 - bump, 2, 2);
        if (hit) {
          c.fillStyle = accent;
          c.fillRect(gate - 11, y - 21, 4, 2);
          c.fillRect(gate + 8, y - 21, 4, 2);
        }
      } else {
        if (n.start > f.now) {
          c.fillStyle = ink;
          c.fillRect(x - 5, y - 10, 11, 10);
          c.fillStyle = col;
          c.fillRect(x - 4, y - 9, 9, 8);
          c.fillStyle = pocket ? ink : paper;
          for (let k = 0; k < 7; k++) {
            c.fillRect(x - 3 + k, y - 8 + k, 1, 1);
            c.fillRect(x + 3 - k, y - 8 + k, 1, 1);
          }
        } else if (hit) {
          c.fillStyle = col;
          const age = 1 - hit;
          for (let k = 0; k < 6; k++)
            c.fillRect(
              gate + Math.round((k - 2.5) * (3 + age * 12)),
              y - 9 - Math.round(Math.sin(age * Math.PI) * (14 + (k % 3) * 6)),
              3,
              3,
            );
        }
      }
    }
  }
  c.globalAlpha = 1;
  const feet = Math.round(base - characterHeight(ground, blocks, f.now, f.cps));
  const run = ((Math.floor(f.now * 16) % 4) + 4) % 4;
  const body = feet - 18;
  // Speed lines, little dust squares and asymmetric boots give the courier life.
  c.fillStyle = middle;
  for (let i = 0; i < 3; i++)
    c.fillRect(gate - 23 - ((i + run) % 3) * 3, body + 4 + i * 4, 6 - i, 1);
  sprite(
    c,
    courier,
    gate - 8,
    body,
    pocket ? [paper, ink, pale, middle] : [accent, ink, paper, middle],
  );
  c.fillStyle = ink;
  c.fillRect(gate - 5 - (run % 2) * 2, feet - 4, 4, 4);
  c.fillRect(gate + 2 + (run % 2) * 2, feet - (run % 2 ? 3 : 4), 4, run % 2 ? 2 : 4);
  c.fillStyle = paper;
  c.fillRect(gate + 1, body + 6, 1, 1);
  if (feet >= floor(f.now) - 2) {
    c.fillStyle = middle;
    c.fillRect(gate - 13 - run * 2, feet - 1, 3, 1);
  }
  c.restore();
}
function drawHud(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  parts: Map<string, Part>,
  scale: number,
) {
  const { width: w, height: h, theme: t } = f;
  const pocket = t.name === 'pocket',
    paper = t.ground,
    ink = t.text,
    middle = t.muted;
  const accent = pocket ? ink : t.accent;
  const headerScale = Math.max(1.5, scale);
  const zone = sectionIndex(f, f.now);
  const coins = [...parts.values()].find((p) => p.role === 'coin');
  c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  c.fillStyle = paper;
  c.fillRect(0, 0, w, 28 * headerScale);
  c.fillStyle = accent;
  c.font = `bold ${String(8 * headerScale)}px "${t.fontDisplay}"`;
  c.fillText(
    `WORLD ${String(Math.floor(f.now) + 1)}-${String(Math.floor((((f.now % 1) + 1) % 1) * 4) + 1)}`,
    8 * scale,
    12 * headerScale,
  );
  c.textAlign = 'right';
  c.fillText(
    `COINS ×${String(coinCount(coins, f.now, f.from)).padStart(3, '0')}`,
    w - 8 * scale,
    12 * headerScale,
  );
  c.fillStyle = middle;
  c.font = `${String(Math.max(10, 6 * scale))}px "${t.fontDisplay}"`;
  c.textAlign = 'left';
  c.fillText(
    (f.sections[zone]?.name ?? 'FREE RUN').toUpperCase(),
    8 * scale,
    23 * headerScale,
    w * 0.5,
  );
  c.textAlign = 'right';
  c.fillText(f.from <= 0 ? 'COINS FROM START' : 'COINS THIS PASS', w - 8 * scale, 23 * headerScale);
  c.textAlign = 'left';
  const rows = Math.ceil(
    f.instruments.length / Math.max(1, Math.floor(w / Math.max(130, 76 * scale))),
  );
  const rowHeight = Math.max(14, 10 * scale);
  const fontSize = Math.max(10, 5 * scale);
  const top = h - Math.max(18 * scale, rows * rowHeight + 6 * scale);
  c.fillStyle = paper;
  c.fillRect(0, top, w, h - top);
  const cols = Math.max(1, Math.ceil(f.instruments.length / Math.max(1, rows)));
  const cell = (w - 12 * scale) / cols;
  c.font = `${String(fontSize)}px "${t.fontDisplay}"`;
  for (const [i, inst] of f.instruments.entries()) {
    const x = 6 * scale + (i % cols) * cell,
      y = top + Math.max(fontSize + 2, 8 * scale) + Math.floor(i / cols) * rowHeight;
    const p = parts.get(inst.id),
      resting = inst.muted || !inst.inSection;
    c.globalAlpha = resting && !pocket ? 0.5 : 1;
    c.fillStyle = pocket ? (resting ? middle : ink) : inst.colour;
    c.fillRect(x, y - 4 * scale, 3 * scale, 3 * scale);
    c.globalAlpha = 1;
    c.fillStyle = resting ? middle : ink;
    const visible =
      p && inst.inSection
        ? upperBound(p.hits, f.now + f.lookAhead) -
          upperBound(p.hits, f.now - f.lookAhead / 2 - 1e-9)
        : 0;
    c.fillText(
      `${inst.name} / ${(inst.inSection ? (p?.role ?? 'rest') : 'rest').toUpperCase()} ×${String(visible)}`,
      x + 5 * scale,
      y,
      cell - 8 * scale,
    );
  }
  c.globalAlpha = 1;
}

const view: ViewDefinition = {
  id: 'runner',
  name: 'Runner',
  tag: 'game',
  span: 'song',
  mount(element) {
    const canvas = document.createElement('canvas'),
      pixels = document.createElement('canvas');
    const c = canvas.getContext('2d'),
      p = pixels.getContext('2d');
    if (!c || !p) throw Error('Canvas 2D is unavailable');
    canvas.style.imageRendering = 'pixelated';
    element.append(canvas);
    let membership = '';
    let source: ViewNote[] | undefined,
      parts = new Map<string, Part>();
    return {
      frame(f) {
        if (f.width <= 0 || f.height <= 0) return;
        const scale = Math.max(1, Math.round(Math.min(f.width / 400, f.height / 240)));
        const w = Math.ceil(f.width / scale),
          h = Math.ceil(f.height / scale);
        if (pixels.width !== w || pixels.height !== h) {
          pixels.width = w;
          pixels.height = h;
        }
        const pw = Math.round(f.width * f.dpr),
          ph = Math.round(f.height * f.dpr);
        if (canvas.width !== pw || canvas.height !== ph) {
          canvas.width = pw;
          canvas.height = ph;
        }
        canvas.style.width = `${String(f.width)}px`;
        canvas.style.height = `${String(f.height)}px`;
        const current = f.instruments
          .filter((i) => i.inSection)
          .map((i) => i.id)
          .join('|');
        if (source !== f.notes || membership !== current) {
          source = f.notes;
          membership = current;
          parts = analyse(
            source,
            new Set(f.instruments.filter((i) => i.inSection).map((i) => i.id)),
          );
        }
        drawRunner(p, f, parts);
        c.imageSmoothingEnabled = false;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.drawImage(pixels, 0, 0, w, h, 0, 0, pw, ph);
        drawHud(c, f, parts, scale);
      },
      dispose() {
        canvas.remove();
        canvas.width = pixels.width = 0;
        canvas.height = pixels.height = 0;
        source = undefined;
        parts.clear();
      },
    };
  },
};
export default view;
