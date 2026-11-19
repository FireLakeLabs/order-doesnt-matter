import type { ViewDefinition, ViewFrame } from './types';
import {
  gateRails,
  routeAngle,
  snowSpecks,
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
import { gatePosition, snowPaint } from './slalom/drawing';

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
    b = s.box,
    paint = snowPaint(t);
  const part = (id?: string) => f.instruments.find((i) => i.id === id);
  const ink = part(score.melody)?.colour ?? t.accent;
  c.fillStyle = t.ground;
  c.fillRect(0, 0, f.width, f.height);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  // Entire snow bowl is the course; asymmetric ridges change at section boundaries.
  const seed = (score.section?.from ?? 0) * 97;
  const snow = c.createLinearGradient(b.left, b.top, f.width - b.left, b.bottom);
  snow.addColorStop(0, paint.shade);
  snow.addColorStop(0.36, paint.light);
  snow.addColorStop(0.7, paint.snow);
  snow.addColorStop(1, paint.shade);
  c.fillStyle = snow;
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
      paint.groove,
      1,
    );
    for (let i = 0; i < 14; i++) {
      const y = b.top + (i / 13) * (b.bottom - b.top),
        xx = x + side * (24 + random(seed + i, 2) * 30);
      shape(
        c,
        [
          [xx, y - 17],
          [xx - 6, y - 5],
          [xx - 3, y - 6],
          [xx - 10, y + 8],
          [xx + 10, y + 8],
          [xx + 3, y - 6],
          [xx + 6, y - 5],
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
  c.globalAlpha = 0.22;
  for (const speck of snowSpecks(b.from, b.to)) {
    const x = b.x(speck.x),
      y = b.y(speck.time);
    line(
      c,
      [
        [x - speck.radius * 2, y],
        [x + speck.radius, y - 0.6],
      ],
      paint.groove,
      0.6,
    );
    disc(c, x + 1, y + 1, speck.radius * 0.5, paint.light);
  }
  c.globalAlpha = 1;
  for (const n of s.terrain) {
    const p = readPitch(n) ?? 36;
    const y = b.y(n.start + Math.min(0.15, (n.end - n.start) * 0.4));
    const x = b.x(0.15 + ((p % 24) / 24) * 0.7);
    const depth = 6 + clamp((p - 24) / 48) * 17;
    const wide = Math.min(90, b.width * 0.16);
    c.save();
    c.translate(x, y);
    c.rotate(-0.12);
    c.scale(wide, depth * 1.5);
    const mound = c.createRadialGradient(-0.25, -0.55, 0.05, 0, 0, 1);
    mound.addColorStop(0, paint.light);
    mound.addColorStop(0.4, paint.snow);
    mound.addColorStop(0.78, paint.shade);
    mound.addColorStop(1, paint.snow);
    c.fillStyle = mound;
    c.beginPath();
    c.arc(0, 0, 1, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  // Ridge floodlights and short pennants: no duration-length poles on the course.
  for (const n of s.sides) {
    const index = part(n.instrument)?.index ?? 0,
      p = readPitch(n),
      right = index % 2 === 1;
    const xx =
      b.x(right ? 0.99 : 0.01) +
      (p === undefined ? 0 : (right ? -1 : 1) * ((p % 24) / 24) * Math.min(50, b.width * 0.12));
    const yy = b.y(Math.max(n.start, b.from)) + (n.start < b.from ? 18 : 0);
    const colour = part(n.instrument)?.colour ?? t.accent;
    const active = n.start <= f.now && n.end > f.now;
    if (p !== undefined) {
      const reach = right ? -1 : 1;
      const glow = c.createRadialGradient(xx + reach * 22, yy + 7, 0, xx + reach * 22, yy + 7, 42);
      glow.addColorStop(0, `${colour}50`);
      glow.addColorStop(1, `${colour}00`);
      c.fillStyle = glow;
      c.globalAlpha = active ? 0.85 : 0.4;
      c.beginPath();
      c.ellipse(xx + reach * 24, yy + 8, 44, 22, 0, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      line(
        c,
        [
          [xx - 4, yy + 7],
          [xx + 4, yy + 7],
        ],
        paint.groove,
        2,
      );
      line(
        c,
        [
          [xx, yy + 7],
          [xx, yy - 2],
        ],
        paint.groove,
        2,
      );
      c.save();
      c.translate(xx, yy - 3);
      c.rotate(right ? -0.25 : 0.25);
      c.fillStyle = paint.groove;
      c.fillRect(-7, -4, 14, 8);
      c.fillStyle = active ? paint.light : colour;
      c.fillRect(-5, -2, 10, 4);
      c.restore();
    } else {
      line(
        c,
        [
          [xx, yy + 4],
          [xx, yy - 12],
        ],
        paint.groove,
        1.5,
      );
      shape(
        c,
        [
          [xx, yy - 12],
          [xx + (right ? -10 : 10), yy - 8],
          [xx, yy - 4],
        ],
        colour,
        paint.groove,
      );
    }
  }
  const sy = b.y(f.now),
    sx = b.x(s.x);
  const angleAt = (time: number) => routeAngle(score.gates, b, time);
  // Twin tracks are sampled from the very same exact-onset route as the skier.
  const trackFrom = Math.max(b.from, score.gates[0]?.start ?? f.now);
  const skiOffset = 12 * racerScale(f.width);
  for (const offset of trackFrom <= f.now ? [-skiOffset, skiOffset] : []) {
    const points: Point[] = [];
    for (let i = 0; i <= 180; i++) {
      const time = trackFrom + ((f.now - trackFrom) * i) / 180;
      points.push([b.x(routeAt(score.gates, time)) + offset, b.y(time)]);
    }
    line(
      c,
      points.map(([x, y]) => [x + 1.5, y + 1.5]),
      paint.light,
      4,
    );
    line(c, points, paint.shade, 4);
    line(c, points, paint.groove, 1.5);
  }
  // A faint upcoming line guides the eye into the next opening.
  c.setLineDash([3, 8]);
  const preview: Point[] = [];
  for (let i = 0; i <= 90; i++) {
    const time = f.now + ((b.to - f.now) * i) / 90;
    preview.push([b.x(routeAt(score.gates, time)), b.y(time)]);
  }
  line(c, preview, paint.groove, 1);
  c.setLineDash([]);
  for (const [gateIndex, gate] of score.gates.entries()) {
    if (gate.start >= b.to || gate.end <= b.from) continue;
    const start = Math.max(b.from, gate.start),
      end = Math.min(b.to, gate.end);
    const colour = gateIndex % 2 ? paint.blue : paint.red;
    // A corridor is a run of panel gates anchored to its own onset, with its scored end cap.
    const interval = (40 * (b.to - b.from)) / (b.bottom - b.top);
    const times = [];
    for (let i = Math.ceil((start - gate.start) / interval); gate.start + i * interval < end; i++)
      times.push(gate.start + i * interval);
    if (gate.end <= b.to && b.y(gate.end) - b.y(gate.start) >= 40) times.push(gate.end);
    for (const time of times) {
      const gy = b.y(time),
        rails = gateRails(score.gates, gate, b, time),
        passed = time <= f.now,
        knock = passed ? 5 : 0;
      c.globalAlpha = passed ? 0.45 : 1;
      // Soft footprints, flexible poles and a cloth panel between them.
      for (const xx of rails) {
        c.fillStyle = paint.shade;
        c.beginPath();
        c.ellipse(xx + 4, gy + 3, 8, 2.5, -0.2, 0, Math.PI * 2);
        c.fill();
        line(
          c,
          [
            [xx, gy + 3],
            [xx + knock, gy - 21],
          ],
          paint.groove,
          3.8,
        );
        line(
          c,
          [
            [xx, gy + 3],
            [xx + knock, gy - 21],
          ],
          colour,
          2.3,
        );
        disc(c, xx + knock, gy - 21, 1.7, paint.light);
      }
      shape(
        c,
        [
          [rails[0] + knock, gy - 18],
          [rails[1] + knock, gy - 18],
          [rails[1] + knock, gy - 7],
          [(rails[0] + rails[1]) / 2 + knock, gy - 5],
          [rails[0] + knock, gy - 7],
        ],
        colour,
        colour,
      );
      line(
        c,
        [
          [rails[0] + knock + 4, gy - 15],
          [rails[1] + knock - 4, gy - 15],
        ],
        paint.light,
        1,
      );
      c.globalAlpha = 1;
    }
    // Tiny snow marks keep each note entrance and scored end visible without rail ladders.
    for (const n of gate.notes) {
      const midi = readPitch(n);
      if (midi === undefined) continue;
      for (const time of [n.start, n.end]) {
        const rails = gateRails(score.gates, gate, b, time);
        const shift = time === n.start ? 0 : rails[0] - (b.x(gate.low) - 23);
        const xx = b.x(pitchX(midi)) + shift;
        line(
          c,
          [
            [xx - 3, b.y(time)],
            [xx + 3, b.y(time)],
          ],
          paint.groove,
          1,
        );
      }
    }
  }
  const angle = angleAt(f.now);
  for (let i = 0; i < 35; i++) {
    const age = ((((f.now * 3 + random(i, 2)) % 1) + 1) % 1) * 0.13,
      time = f.now - age,
      a = angleAt(time);
    const drift = (random(i, 1) - 0.5) * 40 * (age / 0.13);
    const xx = b.x(routeAt(score.gates, time)) + drift - Math.sin(a) * age * 90;
    const yy = b.y(time) - age * 95;
    c.globalAlpha = (1 - age / 0.13) * Math.min(1, Math.abs(a) + 0.15);
    disc(c, xx, yy, 0.7 + random(i) * 1.8, paint.light);
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
    `BAR ${String(Math.floor(f.now) + 1)} · ${String(Math.min(99, Math.floor((f.now % 1) * 100 + 1e-8)))}%`,
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
    const y = (next && s.next ? b.y(s.next.start) : bundle.y) - 24;
    const text = next
      ? `${s.next?.label ?? ''} @${gatePosition(s.next?.start ?? g.start)} · next${bundle.count > 1 ? ` ×${String(bundle.count)}` : ''}`
      : bundle.count > 1
        ? `×${String(bundle.count)} gates`
        : `${g.label} @${gatePosition(g.start)} · ${g.start <= f.now ? 'passed' : 'ahead'}`;
    c.font = `11px "${t.fontMono}"`;
    if (next && s.next && Math.abs(y - sy) < 83) {
      const half = Math.min(180, c.measureText(text).width) / 2 + 10;
      const rails = gateRails(score.gates, s.next, b, s.next.start);
      const candidates = [rails[0] - half, rails[1] + half];
      x =
        candidates
          .filter((x) => x - half >= 0 && x + half <= f.width)
          .sort((a, b) => Math.abs(b - sx) - Math.abs(a - sx))[0] ?? x;
    }
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
    `${String(hidden)} tags folded · ${part(score.terrain)?.name ?? 'No pitched part'} → moguls + floods; others → pennants`,
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
