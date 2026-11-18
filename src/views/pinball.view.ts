import type { ViewDefinition, ViewFrame } from './types';
import { flipperAt, indexPinball, pinballLayout, pinballState } from './pinball/model';
import type { PinballScore, Point, Target } from './pinball/model';
import { previousOnset } from './shared/timing';
import { clamp } from './shared/math';

function path(c: CanvasRenderingContext2D, points: Point[]) {
  c.beginPath();
  points.forEach((p, i) => {
    if (i) c.lineTo(p.x, p.y);
    else c.moveTo(p.x, p.y);
  });
  c.stroke();
}
function circle(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill = false) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  if (fill) c.fill();
  else c.stroke();
}
function fit(c: CanvasRenderingContext2D, text: string, width: number) {
  if (c.measureText(text).width <= width) return text;
  while (text && c.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return `${text}…`;
}
function ball(c: CanvasRenderingContext2D, point: Point, frame: ViewFrame, radius = 6) {
  c.shadowColor = frame.theme.text;
  c.shadowBlur = frame.theme.glow ? 7 : 0;
  c.fillStyle = frame.theme.text;
  circle(c, point.x, point.y, radius, true);
  c.shadowBlur = 0;
  c.strokeStyle = frame.theme.ground;
  c.lineWidth = 1.5;
  circle(c, point.x, point.y, radius);
  c.fillStyle = frame.theme.panel;
  circle(c, point.x - radius * 0.2, point.y - radius * 0.25, radius * 0.24, true);
}
function target(c: CanvasRenderingContext2D, t: Target, score: PinballScore, frame: ViewFrame) {
  const kind = score.kinds.get(t.instrument.id) ?? 'bumper';
  const { x, y, radius: r } = t;
  const hit = previousOnset(frame.notes, t.instrument.id, frame.now);
  const pulse = hit ? clamp(1 - (frame.now - hit.start) / 0.12) : 0;
  const live = frame.notes.some(
    (n) => n.instrument === t.instrument.id && n.start <= frame.now && frame.now < n.end,
  );
  c.globalAlpha = t.instrument.muted ? 0.2 : live ? 1 : 0.36;
  c.strokeStyle = frame.theme.text;
  c.fillStyle = frame.theme.ground;
  c.lineWidth = 2.5;
  if (kind === 'ramp') {
    c.beginPath();
    c.roundRect(x - r, y - r, r * 2, r * 1.8, [r * 0.8, r * 0.8, 3, 3]);
    c.fill();
    c.stroke();
    c.strokeStyle = t.instrument.colour;
    path(c, [
      { x: x - r * 0.7, y: y + r * 0.7 },
      { x: x - r * 0.7, y: y - r * 0.5 },
      { x: x + r * 0.7, y: y - r * 0.5 },
      { x: x + r * 0.7, y: y + r * 0.7 },
    ]);
    c.lineWidth = 1;
    path(c, [
      { x: x - r, y: y + r },
      { x: x - r, y: y + r * 0.8 },
      { x: x + r, y: y + r * 0.8 },
      { x: x + r, y: y + r },
    ]);
  } else if (kind === 'rollover') {
    c.beginPath();
    c.roundRect(x - r * 0.7, y - r, r * 1.4, r * 1.9, r * 0.6);
    c.fill();
    c.stroke();
    c.fillStyle = t.instrument.colour;
    circle(c, x, y, 3 + pulse * 3, true);
  } else {
    circle(c, x, y, r, true);
    circle(c, x, y, r);
    c.strokeStyle = t.instrument.colour;
    circle(c, x, y, r * 0.65);
    if (kind === 'spinner') {
      const angle = frame.now * Math.PI * 2;
      path(c, [
        { x: x - Math.cos(angle) * r * 0.8, y: y - Math.sin(angle) * r * 0.8 },
        { x: x + Math.cos(angle) * r * 0.8, y: y + Math.sin(angle) * r * 0.8 },
      ]);
    } else {
      c.fillStyle = t.instrument.colour;
      circle(c, x, y, r * 0.33, true);
    }
  }
  if (pulse > 0) {
    c.globalAlpha *= pulse;
    circle(c, x, y, r + 4 + (1 - pulse) * 12);
  }
  c.globalAlpha = 1;
}
function draw(c: CanvasRenderingContext2D, f: ViewFrame, score: PinballScore) {
  const { width: w, height: h, theme } = f;
  const box = pinballLayout(f),
    state = pinballState(score, box, f.now);
  const period = f.sections.at(-1)?.to ?? 0;
  const phase = period ? ((f.now % period) + period) % period : f.now;
  const sectionIndex = f.sections.findIndex((s) => phase >= s.from && phase < s.to);
  const section = sectionIndex >= 0 ? f.sections.at(sectionIndex) : undefined;
  const light =
    f.instruments[Math.max(0, sectionIndex) % Math.max(1, f.instruments.length)]?.colour ??
    theme.accent;
  c.fillStyle = theme.ground;
  c.fillRect(0, 0, w, h);
  c.fillStyle = theme.panel;
  c.strokeStyle = theme.line;
  c.lineWidth = 5;
  c.beginPath();
  c.moveTo(box.left - 10, 80);
  c.quadraticCurveTo(w / 2, 55, box.right + 10, 80);
  c.lineTo(w - 24, h - 67);
  c.quadraticCurveTo(w / 2, h - 25, 24, h - 67);
  c.closePath();
  c.fill();
  c.stroke();
  c.save();
  c.clip();
  const wash = c.createRadialGradient(w / 2, 120, 0, w / 2, h / 2, h * 0.85);
  wash.addColorStop(0, light);
  wash.addColorStop(1, theme.panel);
  c.globalAlpha = 0.14;
  c.fillStyle = wash;
  c.fillRect(0, 70, w, h - 120);
  c.restore();
  c.strokeStyle = light;
  c.lineWidth = 1.5;
  path(c, [
    { x: box.left - 3, y: 89 },
    { x: 38, y: h - 78 },
    { x: w / 2 - 35, y: h - 55 },
  ]);
  path(c, [
    { x: box.right + 3, y: 89 },
    { x: w - 38, y: h - 78 },
    { x: w / 2 + 35, y: h - 55 },
  ]);
  // Route channels stop above the label bands. Dash gaps and a dark under-stroke separate crossings.
  for (const route of state.routes) {
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.strokeStyle = theme.panel;
    c.lineWidth = 6;
    path(c, route.ahead);
    c.strokeStyle = route.target.instrument.colour;
    c.lineWidth = 1.5;
    c.setLineDash([2, 7]);
    path(c, route.ahead);
    c.setLineDash([]);
  }
  box.targets.forEach((t) => {
    c.save();
    c.beginPath();
    c.rect(
      t.x - box.cellWidth / 2 + 8,
      t.channel - 5,
      box.cellWidth - 16,
      t.labelY - 17 - (t.channel - 5),
    );
    c.clip();
    target(c, t, score, f);
    c.restore();
  });
  state.routes.forEach((r) => {
    ball(c, r.position, f);
  });
  for (const hold of state.holds) {
    // Dense coincident holds are a counted jackpot; unique paths stay independent of sibling lifetime.
    const seen = new Set<string>();
    for (const p of hold.positions) {
      const key = `${String(Math.round(p.x / 5))},${String(Math.round(p.y / 5))}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ball(c, p, f, 5);
    }
  }
  // At the exact onset every destination has a ball, even when the next group is smaller.
  if (state.current)
    for (const id of new Set(state.current.notes.map((n) => n.instrument))) {
      const t = box.targets.find((t) => t.instrument.id === id);
      if (t) ball(c, t, f);
    }
  const flipperId = flipperAt(f);
  const flipNote = flipperId ? previousOnset(f.notes, flipperId, f.now) : undefined;
  const flip = flipNote ? clamp(1 - (f.now - flipNote.start) / 0.16) : 0;
  c.lineWidth = 12;
  c.lineCap = 'round';
  c.strokeStyle = theme.accent;
  const fy = h - 87,
    span = Math.min(90, w * 0.13);
  path(c, [
    { x: w / 2 - span - 24, y: fy },
    { x: w / 2 - 24, y: fy + 12 - flip * 28 },
  ]);
  path(c, [
    { x: w / 2 + span + 24, y: fy },
    { x: w / 2 + 24, y: fy + 12 - flip * 28 },
  ]);
  c.fillStyle = theme.text;
  circle(c, w / 2 - span - 24, fy, 3, true);
  circle(c, w / 2 + span + 24, fy, 3, true);
  // All text is last and on opaque token plates, including every dense count.
  const text = (
    value: string,
    x: number,
    y: number,
    max: number,
    size = 11,
    align: CanvasTextAlign = 'center',
  ) => {
    c.font = `${String(size)}px "${theme.fontMono}"`;
    c.textAlign = align;
    const fitted = fit(c, value, max),
      measured = c.measureText(fitted).width;
    c.fillStyle = theme.panel;
    c.fillRect(
      x - (align === 'center' ? measured / 2 : align === 'right' ? measured : 0) - 4,
      y - size - 2,
      measured + 8,
      size + 7,
    );
    c.fillStyle = theme.text;
    c.fillText(fitted, x, y);
  };
  for (const t of box.targets) {
    const hold = state.holds.find((v) => v.target === t);
    const ahead = score.groups
      .filter((g) => g.time > f.now && (g.time < Math.floor(f.now) + 1 || g === state.next))
      .reduce((n, g) => n + g.notes.filter((n) => n.instrument === t.instrument.id).length, 0);
    const kind = score.kinds.get(t.instrument.id) ?? 'unasked';
    const active = score.spans.filter(
      (n) => n.instrument === t.instrument.id && n.start <= f.now && f.now < n.end,
    ).length;
    if (t.compact) {
      text(
        hold
          ? `${String(t.slot + 1)}×${String(hold.count)}`
          : ahead
            ? `${String(t.slot + 1)} +${String(ahead)}`
            : String(t.slot + 1),
        t.x,
        t.labelY,
        t.labelWidth,
      );
      continue;
    }
    c.font = `11px "${theme.fontMono}"`;
    const name =
      c.measureText(t.instrument.name).width <= t.labelWidth
        ? t.instrument.name
        : (t.instrument.name.split(' · ').at(-1) ?? t.instrument.name);
    text(name, t.x, t.labelY, t.labelWidth);
    text(
      hold
        ? `${String(t.slot + 1)} ×${String(hold.count)} ${hold.count >= 8 ? 'JACKPOT' : 'HOLD'}`
        : ahead >= 8
          ? `${String(t.slot + 1)} ×${String(ahead)} JACKPOT`
          : active
            ? `${String(t.slot + 1)} ×${String(active)} LIVE`
            : `${String(t.slot + 1)} +${String(ahead)} ${kind}`,
      t.x,
      t.labelY + 16,
      t.labelWidth,
    );
  }
  text('PINBALL', 20, 29, w * 0.45, 20, 'left');
  text(
    `bar ${String(Math.floor(f.now) + 1)} · ${String(Math.round((f.now % 1) * 100))}%`,
    w - 20,
    27,
    w * 0.45,
    11,
    'right',
  );
  text(
    `${String(state.reached)}/${String(state.barNotes)} onsets · ${String(state.travelling)} route + ${String(state.held)} held${state.fragments ? ` · ${String(state.fragments)} fragments` : ''}`,
    w / 2,
    54,
    w - 40,
  );
  text(
    section
      ? `MODE ${String(sectionIndex + 1)} · ${section.name.toUpperCase()}`
      : 'OPEN TABLE · NO SECTIONS',
    w / 2,
    103,
    w - 90,
    13,
  );
  text(
    state.next
      ? `NEXT ${state.next.time.toFixed(3)} · MULTIBALL ×${String(state.multiball)}`
      : 'NO NEXT ONSET IN WINDOW',
    w / 2,
    h - 111,
    w - 70,
  );
  const flipper = f.instruments.find((i) => i.id === flipperId);
  text(
    flipper ? `FLIPPERS · ${flipper.name} (regular drum)` : 'FLIPPERS · no scored drum',
    w / 2,
    h - 48,
    w - 50,
  );
  text(
    w < 700
      ? 'NUMBER: PART ORDER · ×: HELD · +: AHEAD'
      : 'DOTTED: NEXT ONSETS · CAPTIVE: SCORED SPAN · NUMBERED JACKPOTS KEEP EVERY NOTE',
    w / 2,
    h - 18,
    w - 30,
  );
}
const view: ViewDefinition = {
  id: 'pinball',
  name: 'Pinball',
  group: 'arcade',
  tag: 'onset route',
  needs: 'score',
  span: 'window',
  mount(element) {
    const canvas = document.createElement('canvas'),
      c = canvas.getContext('2d');
    if (!c) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let notes: ViewFrame['notes'] | undefined, score: PinballScore | undefined;
    return {
      frame(f) {
        if (f.width <= 0 || f.height <= 0) return;
        if (notes !== f.notes) {
          notes = f.notes;
          score = indexPinball(notes);
        }
        if (!score) return;
        const width = Math.max(1, Math.round(f.width * f.dpr)),
          height = Math.max(1, Math.round(f.height * f.dpr));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        canvas.style.width = `${String(f.width)}px`;
        canvas.style.height = `${String(f.height)}px`;
        c.reset();
        c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
        draw(c, f, score);
      },
      dispose() {
        canvas.remove();
        canvas.width = canvas.height = 0;
        notes = undefined;
        score = undefined;
      },
    };
  },
};
export default view;
