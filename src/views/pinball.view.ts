import type { ViewDefinition, ViewFrame } from './types';
import {
  flipperAt,
  indexPinball,
  pinballLayout,
  pinballState,
  captivePoint,
} from './pinball/model';
import type { PinballScore, PinballLayout, Point, Target } from './pinball/model';
import { previousOnset, noteProgress } from './shared/timing';
import { sectionAt } from './shared/ring-model';
import { clamp } from './shared/math';
import { assignFeatures } from './pinball/table';
import type { FeatureAssignments } from './pinball/table';

function path(c: CanvasRenderingContext2D, points: Point[]) {
  c.beginPath();
  points.forEach((p, i) => {
    if (i) c.lineTo(p.x, p.y);
    else c.moveTo(p.x, p.y);
  });
  c.stroke();
}
function circle(c: CanvasRenderingContext2D, p: Point, radius: number, fill = false) {
  c.beginPath();
  c.arc(p.x, p.y, radius, 0, Math.PI * 2);
  if (fill) c.fill();
  else c.stroke();
}
function ellipse(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill = false,
) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) c.fill();
  else c.stroke();
}
function fit(c: CanvasRenderingContext2D, value: string, width: number) {
  if (c.measureText(value).width <= width) return value;
  while (value && c.measureText(`${value}…`).width > width) value = value.slice(0, -1);
  return `${value}…`;
}
function text(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  value: string,
  x: number,
  y: number,
  width: number,
  size = 11,
  align: CanvasTextAlign = 'center',
) {
  c.font = `${String(size)}px "${f.theme.fontMono}"`;
  c.textAlign = align;
  const label = fit(c, value, width),
    measured = c.measureText(label).width;
  c.fillStyle = f.theme.panel;
  c.fillRect(
    x - (align === 'center' ? measured / 2 : align === 'right' ? measured : 0) - 3,
    y - size - 2,
    measured + 6,
    size + 5,
  );
  c.fillStyle = f.theme.text;
  c.fillText(label, x, y);
}
function rails(points: Point[], offset: number) {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)],
      b = points[Math.min(points.length - 1, i + 1)],
      length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: p.x - ((b.y - a.y) / length) * offset, y: p.y + ((b.x - a.x) / length) * offset };
  });
}
function feature(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  box: PinballLayout,
  t: Target,
  lit: boolean,
) {
  const { theme } = f,
    colour = t.instrument.colour,
    r = box.bumperRadius;
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.globalAlpha = t.instrument.muted ? 0.14 : lit ? 1 : 0.15;
  if (t.kind === 'ramp') {
    const bed = box.ballRadius * 2.15;
    c.strokeStyle = theme.ground;
    c.lineWidth = bed + 7;
    path(
      c,
      t.track.map((p) => ({ x: p.x + 3, y: p.y + 7 })),
    );
    // The deck stands on posts; two separate rails carry the captive ball.
    c.strokeStyle = theme.line;
    c.lineWidth = 3;
    for (const index of [14, 30, 45]) {
      const p = t.track[index];
      path(c, [p, { x: p.x + 3, y: p.y + 11 }]);
    }
    c.strokeStyle = theme.line;
    c.lineWidth = bed + 3;
    path(c, t.track);
    c.strokeStyle = theme.panel;
    c.lineWidth = bed;
    path(c, t.track);
    c.globalAlpha *= 0.65;
    c.strokeStyle = colour;
    c.lineWidth = bed - 5;
    path(c, t.track);
    c.globalAlpha = t.instrument.muted ? 0.14 : lit ? 1 : 0.15;
    c.strokeStyle = theme.text;
    c.lineWidth = 1.5;
    path(c, rails(t.track, bed / 2));
    path(c, rails(t.track, -bed / 2));
    c.strokeStyle = colour;
    c.lineWidth = 2;
    path(c, t.track);
    c.fillStyle = theme.ground;
    ellipse(c, t.x, t.y + 3, r * 0.65, r * 0.3, true);
    c.strokeStyle = colour;
    ellipse(c, t.x, t.y + 3, r * 0.65, r * 0.3);
  } else if (t.kind === 'bumper' && lit) {
    c.fillStyle = theme.ground;
    ellipse(c, t.x + 3, t.y + 8, r + 3, r * 0.7, true);
    c.fillStyle = theme.line;
    ellipse(c, t.x, t.y + 5, r, r * 0.74, true);
    const cap = c.createLinearGradient(t.x, t.y - r, t.x, t.y + r);
    cap.addColorStop(0, theme.text);
    cap.addColorStop(0.2, colour);
    cap.addColorStop(1, theme.ground);
    c.fillStyle = cap;
    ellipse(c, t.x, t.y, r, r * 0.73, true);
    c.strokeStyle = colour;
    c.lineWidth = 2;
    ellipse(c, t.x, t.y, r, r * 0.73);
    c.fillStyle = theme.panel;
    ellipse(c, t.x, t.y - 2, box.capRadius, box.capRadius * 0.72, true);
    c.strokeStyle = theme.text;
    c.lineWidth = 1;
    ellipse(c, t.x, t.y - 2, box.capRadius, box.capRadius * 0.72);
    c.fillStyle = colour;
    circle(c, { x: t.x, y: t.y - 2 }, 2, true);
  } else if (t.kind === 'rollover') {
    const lanes = box.targets.filter((v) => v.kind === 'rollover').length <= 2 ? 3 : 1;
    const gap = box.capRadius * 2.6,
      laneWidth = Math.min(
        r,
        (box.fieldWidth * 0.32) /
          Math.max(1, box.targets.filter((v) => v.kind === 'rollover').length),
      );
    for (let i = 0; i < lanes; i++) {
      const x = t.x + (i - (lanes - 1) / 2) * gap,
        y = t.y - box.fieldHeight * 0.075;
      c.strokeStyle = theme.text;
      c.lineWidth = 2;
      c.beginPath();
      c.roundRect(
        x - laneWidth * 0.45,
        y,
        laneWidth * 0.9,
        box.fieldHeight * 0.11,
        laneWidth * 0.45,
      );
      c.stroke();
      c.fillStyle = colour;
      ellipse(c, x, t.y, box.capRadius * 0.6, box.capRadius * 0.37, true);
      c.strokeStyle = colour;
      path(c, [
        { x, y: t.y - 8 },
        { x, y: t.y - 2 },
      ]);
    }
  } else if (t.kind === 'spinner' && lit) {
    c.strokeStyle = theme.text;
    c.lineWidth = 2;
    const h = box.fieldHeight * 0.065;
    for (const side of [-1, 1])
      path(c, [
        { x: t.x + side * r * 0.65, y: t.y - h },
        { x: t.x + side * r * 0.65, y: t.y + h },
      ]);
    c.strokeStyle = colour;
    c.lineWidth = 4;
    path(c, [
      { x: t.x, y: t.y - h },
      { x: t.x, y: t.y + h },
    ]);
    c.fillStyle = theme.panel;
    circle(c, t, r * 0.6, true);
    c.strokeStyle = colour;
    circle(c, t, r * 0.6);
  } else {
    // Resting parts leave an unlit playfield insert, with no label attached.
    c.strokeStyle = theme.text;
    c.lineWidth = 1;
    ellipse(c, t.x, t.y, r * 0.65, r * 0.36);
  }
  c.restore();
}
function cabinet(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  box: PinballLayout,
  lit: ReadonlySet<string>,
  light: string,
) {
  const { theme } = f,
    p = box.point;
  c.fillStyle = theme.ground;
  c.fillRect(0, 0, f.width, f.height);
  c.beginPath();
  const a = p(0.19, 0),
    b = p(0.81, 0),
    d = p(0, 1),
    e = p(1, 1);
  c.moveTo(a.x, a.y);
  c.quadraticCurveTo(f.width / 2, a.y - 12, b.x, b.y);
  c.lineTo(e.x, e.y);
  c.quadraticCurveTo(f.width / 2, e.y + 13, d.x, d.y);
  c.closePath();
  c.fillStyle = theme.panel;
  c.fill();
  c.strokeStyle = theme.line;
  c.lineWidth = 10;
  c.stroke();
  c.save();
  c.clip();
  const wash = c.createRadialGradient(
    f.width / 2,
    box.top,
    0,
    f.width / 2,
    box.top + box.fieldHeight / 2,
    box.fieldHeight,
  );
  wash.addColorStop(0, light);
  wash.addColorStop(1, theme.panel);
  c.globalAlpha = 0.13;
  c.fillStyle = wash;
  c.fillRect(box.left, box.top - 12, box.fieldWidth, box.fieldHeight + 32);
  c.restore();
  c.lineWidth = 2;
  c.strokeStyle = light;
  path(c, [p(0.2, 0.025), p(0.025, 0.975), p(0.42, 1)]);
  path(c, [p(0.8, 0.025), p(0.975, 0.975), p(0.58, 1)]);
  // Outlanes, wire return guides and the spring-loaded plunger occupy the cabinet edges.
  c.strokeStyle = theme.muted;
  c.lineWidth = 2.5;
  for (const side of [0, 1]) {
    const q = (x: number, y: number) => p(side ? 1 - x : x, y);
    path(c, [q(0.13, 0.54), q(0.1, 0.82), q(0.23, 0.96)]);
    path(c, [q(0.19, 0.59), q(0.17, 0.8), q(0.31, 0.9)]);
    for (const y of [0.6, 0.81]) {
      c.fillStyle = theme.text;
      circle(c, q(0.18, y), 3, true);
    }
    // A rubber-faced slingshot above each flipper.
    c.beginPath();
    const v = q(0.27, 0.72);
    c.moveTo(v.x, v.y);
    for (const pt of [q(0.38, 0.84), q(0.22, 0.85)]) c.lineTo(pt.x, pt.y);
    c.closePath();
    c.fillStyle = theme.ground;
    c.fill();
    c.strokeStyle = theme.accent;
    c.lineWidth = 4;
    c.stroke();
    c.strokeStyle = theme.text;
    c.lineWidth = 1;
    c.stroke();
    c.strokeStyle = theme.muted;
    c.lineWidth = 2.5;
  }
  path(c, [p(0.77, 0.04), p(0.945, 0.96)]);
  path(c, [p(0.8, 0.04), p(0.975, 0.96)]);
  const spring: Point[] = [];
  for (let i = 0; i < 13; i++)
    spring.push(p(0.932 + (i % 2) * 0.018 + i * 0.001, 0.83 + i * 0.009));
  c.strokeStyle = theme.text;
  c.lineWidth = 1.5;
  path(c, spring);
  c.fillStyle = theme.accent;
  ellipse(c, p(0.955, 0.96).x, p(0.955, 0.96).y, 7, 3, true);
  // A shallow chevron and inserts lead the eye toward the drain, not a score grid.
  c.globalAlpha = 0.12;
  c.strokeStyle = theme.accent;
  c.lineWidth = 2;
  path(c, [p(0.39, 0.68), p(0.5, 0.76), p(0.61, 0.68)]);
  c.globalAlpha = 1;
  for (const t of box.targets) feature(c, f, box, t, lit.has(t.instrument.id));
}
function ball(c: CanvasRenderingContext2D, f: ViewFrame, p: Point, radius: number, trail: Point[]) {
  c.save();
  const tail: Point[] = [p];
  let remaining = radius * 2.5,
    last = p;
  for (let i = trail.length - 1; i >= 0 && remaining > 0; i--) {
    const next = trail[i],
      distance = Math.hypot(next.x - last.x, next.y - last.y);
    if (!distance) continue;
    const t = Math.min(1, remaining / distance);
    tail.unshift({ x: last.x + (next.x - last.x) * t, y: last.y + (next.y - last.y) * t });
    remaining -= distance;
    last = next;
  }
  for (let i = 1; i < tail.length; i++) {
    c.globalAlpha = (i / tail.length) * 0.4;
    c.strokeStyle = f.theme.text;
    c.lineWidth = radius * 0.75;
    c.lineCap = 'round';
    path(c, [tail[i - 1], tail[i]]);
  }
  c.globalAlpha = 0.65;
  c.fillStyle = f.theme.ground;
  ellipse(c, p.x + radius * 0.3, p.y + radius * 0.85, radius * 0.9, radius * 0.4, true);
  c.globalAlpha = 1;
  const metal = c.createRadialGradient(
    p.x - radius * 0.35,
    p.y - radius * 0.45,
    0,
    p.x,
    p.y,
    radius,
  );
  metal.addColorStop(0, f.theme.text);
  metal.addColorStop(0.22, f.theme.muted);
  metal.addColorStop(0.4, f.theme.text);
  metal.addColorStop(0.78, f.theme.panel);
  metal.addColorStop(1, f.theme.muted);
  c.fillStyle = metal;
  circle(c, p, radius, true);
  c.strokeStyle = f.theme.text;
  c.lineWidth = 1;
  circle(c, p, radius);
  c.fillStyle = f.theme.text;
  ellipse(c, p.x - radius * 0.34, p.y - radius * 0.36, radius * 0.28, radius * 0.16, true);
  c.restore();
}
function live(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  score: PinballScore,
  box: PinballLayout,
  lit: ReadonlySet<string>,
  flipperId: string | undefined,
  mode: string,
) {
  const state = pinballState(score, box, f.now);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  for (const r of state.routes) {
    c.strokeStyle = f.theme.ground;
    c.lineWidth = 5;
    path(c, r.ahead);
    c.strokeStyle = r.target.instrument.colour;
    c.lineWidth = 2;
    c.setLineDash([2, 6]);
    path(c, r.ahead);
    c.setLineDash([]);
  }
  for (const t of box.targets) {
    const hit = previousOnset(f.notes, t.instrument.id, f.now),
      pulse = hit ? clamp(1 - (f.now - hit.start) / 0.12) : 0;
    if (pulse) {
      c.save();
      c.globalAlpha = pulse;
      c.strokeStyle = t.instrument.colour;
      c.lineWidth = 3;
      c.shadowColor = t.instrument.colour;
      c.shadowBlur = f.theme.glow ? pulse * 15 : 0;
      ellipse(c, t.x, t.y, t.radius * (1 + (1 - pulse) * 0.35), t.radius * 0.73);
      c.restore();
    }
    const hold = state.holds.find((h) => h.target === t);
    if (t.kind === 'spinner' && hold) {
      const angle = noteProgress(hold.notes[0], f.now) * Math.PI * 8;
      c.strokeStyle = t.instrument.colour;
      c.lineWidth = 4;
      path(c, [
        { x: t.x - Math.cos(angle) * t.radius, y: t.y - Math.sin(angle) * t.radius * 0.4 },
        { x: t.x + Math.cos(angle) * t.radius, y: t.y + Math.sin(angle) * t.radius * 0.4 },
      ]);
    }
  }
  for (const r of state.routes) {
    const end = r.points.length - r.ahead.length + 1;
    ball(c, f, r.position, box.ballRadius, [
      ...r.points.slice(Math.max(0, end - 5), end),
      r.position,
    ]);
  }
  for (const h of state.holds) {
    const seen = new Set<string>();
    h.notes.forEach((note, i) => {
      const p = h.positions[i],
        key = `${String(Math.round(p.x / 5))}:${String(Math.round(p.y / 5))}`;
      if (seen.has(key)) return;
      seen.add(key);
      const tail = Array.from({ length: 5 }, (_, n) =>
        captivePoint(h.target, note, f.now - (4 - n) * (note.end - note.start) * 0.006),
      );
      ball(c, f, p, box.ballRadius, tail);
    });
  }
  if (state.current)
    for (const id of new Set(state.current.notes.map((n) => n.instrument))) {
      const t = box.targets.find((t) => t.instrument.id === id);
      if (t) ball(c, f, t, box.ballRadius, []);
    }
  const hit = flipperId ? previousOnset(f.notes, flipperId, f.now) : undefined,
    flip = hit ? clamp(1 - (f.now - hit.start) / 0.16) : 0;
  c.lineWidth = box.ballRadius * 1.3;
  c.strokeStyle = f.theme.accent;
  for (const side of [0, 1]) {
    const a = box.point(side ? 0.7 : 0.3, 0.91),
      b = box.point(side ? 0.54 : 0.46, 0.955 - flip * 0.085);
    c.strokeStyle = f.theme.ground;
    c.lineWidth = box.ballRadius * 1.65;
    path(c, [
      { x: a.x + 2, y: a.y + 4 },
      { x: b.x + 2, y: b.y + 4 },
    ]);
    c.strokeStyle = f.theme.accent;
    c.lineWidth = box.ballRadius * 1.3;
    path(c, [a, b]);
    c.fillStyle = f.theme.text;
    circle(c, a, 3, true);
  }
  // Name tags and counts are outside the playfield; moving ink cannot reach them.
  for (const t of box.targets)
    if (lit.has(t.instrument.id)) {
      const label = `${String(t.slot + 1)} ${t.instrument.name}`;
      text(c, f, label, t.tag.x, t.tag.y, t.tag.width, 11, t.tag.align);
    }
  c.fillStyle = f.theme.panel;
  c.strokeStyle = f.theme.line;
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect(12, 7, f.width - 24, 58, 7);
  c.fill();
  c.stroke();
  text(c, f, 'PINBALL', 23, 30, f.width * 0.27, 20, 'left');
  text(
    c,
    f,
    `bar ${String(Math.floor(f.now) + 1)} · ${String(Math.round((f.now % 1) * 100))}%`,
    f.width - 23,
    29,
    f.width * 0.24,
    11,
    'right',
  );
  text(c, f, mode, f.width / 2, 27, f.width * 0.36, 12);
  text(
    c,
    f,
    `${String(state.reached)}/${String(state.barNotes)} onsets · ${String(state.travelling)} route + ${String(state.held)} held${state.fragments ? ` · ${String(state.fragments)} fragments` : ''}`,
    f.width / 2,
    51,
    f.width - 40,
  );
  const next = state.next
    ? `NEXT ${state.next.time.toFixed(3)} · ×${String(state.multiball)}`
    : 'NO NEXT ONSET';
  text(c, f, next, f.width / 2, f.height - 48, f.width - 30);
  const entries = box.targets
    .filter((t) => lit.has(t.instrument.id))
    .map((t) => {
      const h = state.holds.find((h) => h.target === t);
      const ahead = score.groups
        .filter((g) => g.time > f.now && (g.time < Math.floor(f.now) + 1 || g === state.next))
        .reduce((n, g) => n + g.notes.filter((n) => n.instrument === t.instrument.id).length, 0);
      return { name: t.instrument.name, slot: t.slot, count: h?.count ?? ahead, held: !!h };
    });
  const columns = Math.max(1, Math.floor((f.width - 24) / 150)),
    max = columns * 2;
  const visible = entries.length > max ? entries.slice(0, max - 1) : entries;
  const chips = visible.map(
    (e) =>
      `${String(e.slot + 1)} ${e.held ? '×' : '+'}${String(e.count)} ${e.count >= 8 ? 'JACKPOT ' : e.held ? 'HOLD ' : ''}${e.name}`,
  );
  if (entries.length > max)
    chips.push(
      `+${String(entries.length - visible.length)} parts · Σ${String(entries.slice(visible.length).reduce((n, e) => n + e.count, 0))}`,
    );
  chips.forEach((label, i) => {
    text(
      c,
      f,
      label,
      15 + (((i % columns) + 0.5) * (f.width - 30)) / columns,
      f.height - 27 + Math.floor(i / columns) * 17,
      (f.width - 30) / columns - 12,
    );
  });
}
const view: ViewDefinition = {
  id: 'pinball',
  name: 'Pinball',
  group: 'arcade',
  tag: 'flipper table',
  needs: 'score',
  span: 'song',
  mount(element) {
    const canvas = document.createElement('canvas'),
      backing = document.createElement('canvas');
    const c = canvas.getContext('2d'),
      base = backing.getContext('2d');
    if (!c || !base) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let notes: ViewFrame['notes'] | undefined,
      score: PinballScore | undefined,
      box: PinballLayout | undefined,
      assignments: FeatureAssignments | undefined;
    let geometryKey = '',
      key = '',
      sectionKey = '',
      flipperId: string | undefined;
    return {
      frame(f) {
        if (f.width <= 0 || f.height <= 0) return;
        const changed = notes !== f.notes;
        if (changed) {
          notes = f.notes;
          score = indexPinball(notes);
          assignments = assignFeatures(f.instruments, score.kinds);
          sectionKey = '';
        }
        if (!score) return;
        const section = sectionAt(f),
          period = f.sections.at(-1)?.to ?? 1;
        const offset = Math.floor(f.now / period) * period;
        const ordinal = section
          ? f.sections.findIndex((s) => Math.abs(s.from - (section.from - offset)) < 1e-9)
          : -1;
        const nextSection = JSON.stringify([section?.from, section?.to]);
        if (sectionKey !== nextSection) {
          flipperId = flipperAt(f);
          sectionKey = nextSection;
        }
        const active = new Set(
          score.spans
            .filter((n) => n.start < Math.floor(f.now) + 1 && n.end > Math.floor(f.now))
            .map((n) => n.instrument),
        );
        const order = f.instruments.slice().sort((a, b) => a.index - b.index);
        const light =
          order[Math.max(0, ordinal) % Math.max(1, order.length)]?.colour ?? f.theme.accent;
        const nextGeometry = JSON.stringify([
          f.width,
          f.height,
          f.dpr,
          order.map((i) => [i.id, i.index, i.name, i.colour, i.muted]),
          assignments?.map((a) => [a.instrument.id, a.kind, a.rank, a.total]),
        ]);
        const geometryChanged = geometryKey !== nextGeometry || !box;
        if (geometryChanged) {
          box = pinballLayout(f, score.kinds, assignments);
          canvas.width = backing.width = Math.max(1, Math.round(f.width * f.dpr));
          canvas.height = backing.height = Math.max(1, Math.round(f.height * f.dpr));
          canvas.style.width = `${String(f.width)}px`;
          canvas.style.height = `${String(f.height)}px`;
          geometryKey = nextGeometry;
        }
        if (!box) return;
        const nextKey = JSON.stringify([f.theme, ordinal, [...active].sort()]);
        if (geometryChanged || key !== nextKey) {
          base.reset();
          base.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
          cabinet(base, f, box, active, light);
          key = nextKey;
        }
        c.reset();
        c.drawImage(backing, 0, 0);
        c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
        live(
          c,
          f,
          score,
          box,
          active,
          flipperId,
          section ? `MODE ${String(ordinal + 1)} · ${section.name.toUpperCase()}` : 'OPEN TABLE',
        );
      },
      dispose() {
        canvas.remove();
        canvas.width = canvas.height = backing.width = backing.height = 0;
        notes = undefined;
        score = undefined;
        box = undefined;
        assignments = undefined;
      },
    };
  },
};
export default view;
