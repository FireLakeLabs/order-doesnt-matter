import type { ViewDefinition, ViewFrame } from './types';
import {
  corridorOffset,
  indexSlalom,
  pitchX,
  readPitch,
  routeAt,
  slalomState,
} from './slalom/model';
import type { SlalomScore } from './slalom/model';
import { random } from './shared/particles';
import { clamp } from './shared/math';
import { sectionAt } from './shared/ring-model';

type Point = [number, number];
const racerScale = (width: number) => (width < 700 ? 0.76 : 1.05);
function line(c: CanvasRenderingContext2D, points: Point[], ink: string, width = 2) {
  c.strokeStyle = ink;
  c.lineWidth = width;
  c.beginPath();
  points.forEach(([x, y], i) => {
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  });
  c.stroke();
}
function disc(c: CanvasRenderingContext2D, x: number, y: number, r: number, ink: string) {
  c.fillStyle = ink;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}
function shape(c: CanvasRenderingContext2D, points: Point[], ink: string, edge: string) {
  c.beginPath();
  points.forEach(([x, y], i) => {
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  });
  c.closePath();
  c.fillStyle = ink;
  c.fill();
  c.strokeStyle = edge;
  c.lineWidth = 2;
  c.stroke();
}
function fit(c: CanvasRenderingContext2D, value: string, width: number) {
  if (c.measureText(value).width <= width) return value;
  let low = 0,
    high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (c.measureText(`${value.slice(0, mid)}…`).width <= width) low = mid;
    else high = mid - 1;
  }
  return low ? `${value.slice(0, low)}…` : '';
}
/** Original alpine racer seen from above/behind: two parallel edged skis,
 * crouched knees, separate boots, articulated arms, pole baskets and goggles. */
function skier(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  x: number,
  y: number,
  angle: number,
  turn: number,
  ink: string,
) {
  const t = f.theme,
    scale = racerScale(f.width);
  const lean = clamp(turn * 15, -15, 15);
  c.save();
  c.translate(x, y);
  c.rotate(angle);
  c.scale(scale, scale);
  c.fillStyle = t.line;
  c.globalAlpha = 0.35;
  c.beginPath();
  c.ellipse(10, 10, 39, 49, -0.2, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;
  for (const side of [-1, 1]) {
    const foot = side * 12;
    // Curved shovel tips and dark metal edges.
    c.beginPath();
    c.moveTo(foot - 4, -38);
    c.lineTo(foot - 5, 38);
    c.quadraticCurveTo(foot, 57, foot + 5, 38);
    c.lineTo(foot + 4, -38);
    c.closePath();
    c.fillStyle = t.text;
    c.fill();
    c.strokeStyle = t.ground;
    c.lineWidth = 2;
    c.stroke();
    line(
      c,
      [
        [foot, -32],
        [foot, 35],
      ],
      ink,
      2,
    );
    line(
      c,
      [
        [lean * 0.3 + side * 8, -17],
        [lean + side * 17, 3],
        [foot, 16],
      ],
      t.ground,
      14,
    );
    line(
      c,
      [
        [lean * 0.3 + side * 8, -17],
        [lean + side * 17, 3],
        [foot, 16],
      ],
      t.accent,
      10,
    );
    disc(c, lean + side * 17, 3, 5, t.panel);
    line(
      c,
      [
        [foot, 11],
        [foot, 22],
      ],
      t.text,
      8,
    );
    line(
      c,
      [
        [foot, 11],
        [foot, 22],
      ],
      t.panel,
      4,
    );
    const hand: Point = [lean + side * 36, -15];
    line(c, [[lean + side * 17, -32], [lean + side * 30, -29], hand], t.ground, 11);
    line(c, [[lean + side * 17, -32], [lean + side * 30, -29], hand], ink, 7);
    line(c, [hand, [side * 47, -53]], t.text, 2);
    disc(c, side * 47, -53, 4, t.text);
    disc(c, side * 47, -53, 2, t.panel);
    disc(c, hand[0], hand[1], 5, t.text);
  }
  shape(
    c,
    [
      [lean - 17, -37],
      [lean + 15, -37],
      [lean + 20, -19],
      [lean * 0.3 + 11, -8],
      [lean * 0.3 - 12, -8],
      [lean - 20, -23],
    ],
    ink,
    t.ground,
  );
  shape(
    c,
    [
      [lean - 8, -32],
      [lean + 7, -32],
      [lean + 8, -15],
      [lean - 7, -14],
    ],
    t.panel,
    t.ground,
  );
  line(
    c,
    [
      [lean - 3, -28],
      [lean + 3, -19],
    ],
    t.text,
    2,
  );
  disc(c, lean, -41, 13, t.ground);
  disc(c, lean, -42, 11, t.text);
  line(
    c,
    [
      [lean - 8, -38],
      [lean + 8, -38],
    ],
    ink,
    6,
  );
  line(
    c,
    [
      [lean - 6, -37],
      [lean + 6, -37],
    ],
    t.panel,
    3,
  );
  line(
    c,
    [
      [lean, -51],
      [lean, -45],
    ],
    ink,
    3,
  );
  c.restore();
}
function draw(c: CanvasRenderingContext2D, f: ViewFrame, score: SlalomScore) {
  const t = f.theme,
    s = slalomState(score, f),
    b = s.box;
  const part = (id?: string) => f.instruments.find((i) => i.id === id);
  const ink = part(score.melody)?.colour ?? t.accent;
  c.fillStyle = t.ground;
  c.fillRect(0, 0, f.width, f.height);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  // Entire snow bowl is the course; asymmetric ridges change at section boundaries.
  const seed = (score.section?.from ?? 0) * 97;
  c.fillStyle = t.panel;
  c.beginPath();
  c.moveTo(b.left, b.top);
  for (let i = 0; i <= 12; i++)
    c.lineTo(b.left - 20 - random(seed + i) * b.left * 0.5, b.top + ((b.bottom - b.top) * i) / 12);
  c.lineTo(f.width - b.left + 30, b.bottom);
  for (let i = 12; i >= 0; i--)
    c.lineTo(
      f.width - b.left + 20 + random(seed + i, 1) * b.left * 0.5,
      b.top + ((b.bottom - b.top) * i) / 12,
    );
  c.closePath();
  c.fill();
  // Ridge hatching, trees and the rope boundary are features, never label rows.
  for (const side of [-1, 1]) {
    const x = side < 0 ? b.left : f.width - b.left;
    line(
      c,
      [
        [x, b.top],
        [x + side * 18, b.bottom],
      ],
      t.muted,
      1,
    );
    for (let i = 0; i < 14; i++) {
      const y = b.top + (i / 13) * (b.bottom - b.top),
        xx = x + side * (24 + random(seed + i, 2) * 30);
      shape(
        c,
        [
          [xx, y - 13],
          [xx - 8, y + 6],
          [xx + 8, y + 6],
        ],
        t.line,
        t.line,
      );
      line(
        c,
        [
          [xx, y],
          [xx, y + 12],
        ],
        t.muted,
        1,
      );
    }
  }
  c.save();
  c.beginPath();
  c.rect(b.left - 6, b.top, b.width + 12, b.bottom - b.top);
  c.clip();
  // Wind-scoured snow and local moguls: bass pitch changes their height,
  // while their identity fixes their place on the slope.
  c.globalAlpha = 0.18;
  for (let i = 0; i < 110; i++) {
    const time = Math.floor(b.from) + random(i, 4) * (Math.ceil(b.to) - Math.floor(b.from));
    disc(c, b.x(random(i, 3)), b.y(time), 0.7 + random(i, 5), t.muted);
  }
  c.globalAlpha = 1;
  for (const n of s.terrain) {
    const p = readPitch(n) ?? 36;
    const y = b.y(n.start + Math.min(0.15, (n.end - n.start) * 0.4));
    const x = b.x(0.15 + ((p % 24) / 24) * 0.7);
    const depth = 6 + clamp((p - 24) / 48) * 17;
    const wide = Math.min(90, b.width * 0.16);
    c.globalAlpha = 0.42;
    c.fillStyle = t.line;
    c.beginPath();
    c.ellipse(x, y, wide, depth, -0.12, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = part(n.instrument)?.colour ?? t.muted;
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(x - wide, y);
    c.bezierCurveTo(x - wide * 0.4, y - depth * 1.6, x + wide * 0.5, y - depth, x + wide, y);
    c.stroke();
    c.globalAlpha = 1;
  }
  // Lights/flags have fixed identity-derived positions; crowded marks are counted below.
  for (const n of s.sides) {
    const index = part(n.instrument)?.index ?? 0,
      p = readPitch(n),
      side = index % 2 ? 1 : 0;
    const xx =
      b.x(side ? 0.97 : 0.03) +
      (p === undefined ? 0 : (side ? -1 : 1) * ((p % 24) / 24) * Math.min(80, b.width * 0.15));
    const yy = b.y(Math.max(n.start, b.from)) + (n.start < b.from ? 20 : 0);
    const colour = part(n.instrument)?.colour ?? t.text;
    line(
      c,
      [
        [xx, yy],
        [xx, b.y(Math.min(n.end, b.to))],
      ],
      colour,
      p === undefined ? 4 : 2,
    );
    if (p !== undefined) {
      disc(c, xx, yy, 6, t.line);
      disc(c, xx, yy, 3.5, colour);
    } else {
      line(
        c,
        [
          [xx, yy],
          [xx, yy - 18],
        ],
        t.text,
        1.5,
      );
      shape(
        c,
        [
          [xx, yy - 18],
          [xx + (side ? -12 : 12), yy - 13],
          [xx, yy - 8],
        ],
        colour,
        t.panel,
      );
    }
  }
  for (const bundle of s.bundles) {
    const gate = bundle.gates[0],
      x1 = b.x(bundle.low) - 23,
      x2 = b.x(bundle.high) + 23;
    const end = Math.min(b.to, Math.max(...bundle.gates.map((g) => g.end)));
    const y = bundle.y,
      ey = b.y(end);
    c.globalAlpha = gate.start <= f.now ? 0.45 : 1;
    const start = Math.max(b.from, gate.start);
    const shiftAt = (time: number) => b.width * corridorOffset(score.gates, bundle, time);
    for (const x of [x1, x2]) {
      const rail: Point[] = [];
      const steps = Math.max(1, Math.ceil((ey - y) / 10));
      for (let i = 0; i <= steps; i++) {
        const time = start + ((end - start) * i) / steps;
        rail.push([x + shiftAt(time), b.y(time)]);
      }
      line(c, rail, ink, 1);
    }
    // Repeat pole pairs along long spans: a held corridor, with a real end cap.
    const pairs = Math.max(1, Math.ceil((ey - y) / 30));
    for (let i = 0; i <= pairs; i++) {
      const time = start + ((end - start) * i) / pairs;
      const gy = b.y(time),
        shift = shiftAt(time);
      for (const [xx, sign] of [
        [x1 + shift, 1],
        [x2 + shift, -1],
      ]) {
        line(
          c,
          [
            [xx, gy + 6],
            [xx, gy - 17],
          ],
          t.text,
          2,
        );
        shape(
          c,
          [
            [xx, gy - 17],
            [xx + sign * 13, gy - 13],
            [xx, gy - 7],
          ],
          ink,
          t.panel,
        );
      }
    }
    // Fixed pitch entrance marks; the span end follows the corridor.
    for (const g of bundle.gates)
      for (const n of g.notes) {
        const midi = readPitch(n);
        if (midi === undefined) continue;
        const xx = b.x(pitchX(midi));
        for (const time of [n.start, n.end]) {
          const yy = b.y(time);
          const offset = time === n.start ? 0 : shiftAt(time);
          line(
            c,
            [
              [xx + offset - 3, yy],
              [xx + offset + 3, yy],
            ],
            t.text,
            1.5,
          );
        }
      }
    c.globalAlpha = 1;
  }
  const sy = b.y(f.now),
    sx = b.x(s.x);
  const angleAt = (time: number) =>
    Math.atan2(
      b.width * (routeAt(score.gates, time + 0.0001) - routeAt(score.gates, time - 0.0001)),
      ((b.bottom - b.top) / (b.to - b.from)) * 0.0002,
    );
  // Twin tracks are sampled from the very same exact-onset route as the skier.
  const trackFrom = Math.max(b.from, score.gates[0]?.start ?? f.now);
  const skiOffset = 12 * racerScale(f.width);
  for (const offset of trackFrom <= f.now ? [-skiOffset, skiOffset] : []) {
    const points: Point[] = [];
    for (let i = 0; i <= 180; i++) {
      const time = trackFrom + ((f.now - trackFrom) * i) / 180;
      const a = angleAt(time);
      points.push([
        b.x(routeAt(score.gates, time)) + Math.cos(a) * offset,
        b.y(time) - Math.sin(a) * offset,
      ]);
    }
    line(c, points, t.muted, 2.4);
  }
  // A faint upcoming line guides the eye into the next opening.
  c.setLineDash([3, 8]);
  const preview: Point[] = [];
  for (let i = 0; i <= 90; i++) {
    const time = f.now + ((b.to - f.now) * i) / 90;
    preview.push([b.x(routeAt(score.gates, time)), b.y(time)]);
  }
  line(c, preview, t.muted, 1);
  c.setLineDash([]);
  const angle = angleAt(f.now);
  for (let i = 0; i < 35; i++) {
    const age = ((((f.now * 3 + random(i, 2)) % 1) + 1) % 1) * 0.13,
      time = f.now - age,
      a = angleAt(time);
    const drift = (random(i, 1) - 0.5) * 40 * (age / 0.13);
    const xx = b.x(routeAt(score.gates, time)) + drift - Math.sin(a) * age * 90;
    const yy = b.y(time) - age * 95;
    c.globalAlpha = (1 - age / 0.13) * Math.min(1, Math.abs(a) + 0.15);
    disc(c, xx, yy, 0.7 + random(i) * 1.8, t.text);
  }
  c.globalAlpha = 1;
  skier(c, f, sx, sy, -angle, (angleAt(f.now + 0.008) - angleAt(f.now - 0.008)) * 4, ink);
  c.restore();
  // All typography is drawn last, on opaque theme plates, outside the racer.
  const label = (
    value: string,
    x: number,
    y: number,
    width: number,
    size = 11,
    align: CanvasTextAlign = 'left',
  ) => {
    c.font = `${String(size)}px "${size > 16 ? t.fontDisplay : t.fontMono}"`;
    c.textAlign = align;
    const text = fit(c, value, width),
      w = c.measureText(text).width;
    c.fillStyle = t.panel;
    c.fillRect(
      x - (align === 'center' ? w / 2 : align === 'right' ? w : 0) - 4,
      y - size - 3,
      w + 8,
      size + 8,
    );
    c.fillStyle = t.text;
    c.fillText(text, x, y);
  };
  label('Slalom', 20, 32, f.width * 0.4, 23);
  label(
    `BAR ${String(Math.floor(f.now) + 1)} · ${String(Math.round((f.now % 1) * 100))}%`,
    f.width - 20,
    30,
    f.width * 0.45,
    11,
    'right',
  );
  label(
    `${score.section?.name ?? 'Open mountain'} · ${part(score.melody)?.name ?? 'No pitched gates'}`,
    20,
    61,
    f.width - 40,
    13,
  );
  label('DOWNHILL ↓', f.width - 20, 84, 110, 11, 'right');
  let last = -Infinity,
    hidden = 0;
  for (const bundle of s.bundles) {
    const g = bundle.gates[0],
      next = bundle.gates.includes(s.next ?? g) && !!s.next;
    let x = b.x((bundle.low + bundle.high) / 2);
    const y = bundle.y - 24;
    if (next && Math.abs(y - sy) < 83) x = clamp(sx + 155, 85, f.width - 85);
    const text = next
      ? `${s.next?.label ?? ''} · next${bundle.count > 1 ? ` ×${String(bundle.count)}` : ''}`
      : bundle.count > 1
        ? `×${String(bundle.count)} gates`
        : `${g.label} · ${g.start <= f.now ? 'passed' : 'ahead'}`;
    if (
      y < b.top + 15 ||
      y > b.bottom - 8 ||
      y - last < 25 ||
      (Math.abs(y - sy) < 83 &&
        Math.abs(x - sx) <
          (f.width < 700 ? 62 : 85) + Math.min(180, c.measureText(text).width) / 2 + 6)
    ) {
      hidden += bundle.count;
      continue;
    }
    label(text, x, y, Math.min(180, b.width * 0.7), 11, 'center');
    last = y;
  }
  const footer = f.height - 76;
  const named = f.width < 700 ? 2 : 4;
  const passedNames =
    s.passed
      .slice(-named)
      .map((g) => g.label)
      .join(' · ') || '—';
  label(
    `Next: ${s.next?.label ?? '—'} · passed ${String(s.passed.reduce((count, g) => count + g.notes.length, 0))}: ${s.passed.length > named ? '… ' : ''}${passedNames}`,
    20,
    footer,
    f.width - 40,
    12,
  );
  label(
    `${String(s.gates.length)} gate notes · ${String(s.terrain.length)} terrain · ${String(s.sides.length)} side lights / flags`,
    20,
    footer + 25,
    f.width - 40,
  );
  label(
    `${String(hidden)} tags folded · ${part(score.terrain)?.name ?? 'No pitched part'} → terrain / ridge lights`,
    20,
    footer + 49,
    f.width - 40,
  );
}
const view: ViewDefinition = {
  id: 'slalom',
  name: 'Slalom',
  group: 'arcade',
  tag: 'downhill',
  needs: 'score',
  span: 'window',
  mount(element) {
    const canvas = document.createElement('canvas'),
      c = canvas.getContext('2d');
    if (!c) throw Error('Canvas 2D unavailable');
    element.append(canvas);
    let notes: ViewFrame['notes'] | undefined,
      key = '',
      score: SlalomScore | undefined;
    return {
      frame(f) {
        if (f.width <= 0 || f.height <= 0) return;
        const next = JSON.stringify([sectionAt(f), f.from, f.to]);
        if (notes !== f.notes || key !== next || !score) {
          score = indexSlalom(f);
          notes = f.notes;
          key = next;
        }
        const w = Math.round(f.width * f.dpr),
          h = Math.round(f.height * f.dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        canvas.style.width = `${String(f.width)}px`;
        canvas.style.height = `${String(f.height)}px`;
        c.reset();
        c.scale(f.dpr, f.dpr);
        draw(c, f, score);
      },
      dispose() {
        canvas.remove();
      },
    };
  },
};
export default view;
