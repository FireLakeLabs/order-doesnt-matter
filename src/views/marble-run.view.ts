import type { ViewDefinition, ViewFrame } from './types';
import { indexMarbles, machineLayout, machineState, runGeometry } from './marble-run/model';
import type { MarbleScore, Target } from './marble-run/model';
import { noteName } from './shared/pitch';
import { line } from './shared/retro-2d';

interface Label {
  text: string;
  x: number;
  y: number;
  width: number;
  complete?: boolean;
}
interface Surface {
  target: Target;
  colour: string;
  hit: number;
  members: number[];
}
function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
function drum(ctx: CanvasRenderingContext2D, surface: Surface, frame: ViewFrame, floor: number) {
  const { target: t, colour, hit } = surface,
    r = t.length / 2;
  const depth = Math.min(58, (floor - t.y) * 0.8);
  ctx.strokeStyle = frame.theme.muted;
  ctx.lineWidth = 2;
  line(ctx, t.x, t.y + depth, t.x, floor);
  line(ctx, t.x, t.y + depth, t.x - r * 0.55, floor);
  line(ctx, t.x, t.y + depth, t.x + r * 0.55, floor);
  ctx.fillStyle = frame.theme.panel;
  ellipse(ctx, t.x, t.y + depth, r, Math.min(12, r * 0.16));
  ctx.fillRect(t.x - r, t.y, r * 2, depth);
  ctx.strokeRect(t.x - r, t.y, r * 2, depth);
  ctx.strokeStyle = frame.theme.line;
  for (const dx of [-0.76, -0.3, 0.3, 0.76])
    line(ctx, t.x + dx * r, t.y + 5, t.x + dx * r, t.y + depth - 3);
  ctx.fillStyle = hit ? colour : frame.theme.panel;
  ctx.strokeStyle = frame.theme.muted;
  ctx.lineWidth = 2;
  ellipse(ctx, t.x, t.y, r, Math.min(14, r * 0.19));
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(t.x, t.y, r - 4, Math.min(11, r * 0.15), 0, 0, Math.PI * 2);
  ctx.stroke();
}
function cymbal(ctx: CanvasRenderingContext2D, surface: Surface, frame: ViewFrame, floor: number) {
  const { target: t, colour, hit } = surface,
    r = t.length / 2;
  ctx.strokeStyle = frame.theme.muted;
  ctx.lineWidth = 2;
  line(ctx, t.x, t.y - 9, t.x, floor);
  for (const dx of [-0.48, 0.48]) line(ctx, t.x, floor - 18, t.x + dx * r, floor);
  ctx.fillStyle = hit ? colour : frame.theme.panel;
  ctx.beginPath();
  ctx.moveTo(t.x - r, t.y + 2);
  ctx.quadraticCurveTo(t.x - r * 0.3, t.y - 3, t.x, t.y - 9);
  ctx.quadraticCurveTo(t.x + r * 0.3, t.y - 3, t.x + r, t.y + 2);
  ctx.quadraticCurveTo(t.x, t.y + 12, t.x - r, t.y + 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(t.x, t.y + 2, r * 0.82, 3, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = frame.theme.text;
  ellipse(ctx, t.x, t.y - 7, 3, 2);
}
function draw(ctx: CanvasRenderingContext2D, frame: ViewFrame, score: MarbleScore) {
  const { width, height, theme } = frame,
    box = runGeometry(frame);
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  const motions = machineLayout(frame, score).map((machine) => ({
    machine,
    part: frame.instruments.find((p) => p.id === machine.id),
    state: machineState(machine, score, frame),
  }));
  const visible = motions.filter(
    (m) => m.part && (m.part.inSection || m.state.marks.length || m.state.hits.size),
  );
  const surfaces = new Map<string, Surface>();
  for (const { machine, part, state } of visible) {
    if (!part) continue;
    for (const target of machine.targets) {
      const key =
        target.kind === 'bar' ? `pitch/${target.key}` : `${target.kind}/${String(target.station)}`;
      const hit = state.hits.get(target.key) ?? 0,
        old = surfaces.get(key);
      if (old) {
        old.members.push(part.index + 1);
        if (hit > old.hit) {
          old.hit = hit;
          old.colour = part.colour;
        }
      } else surfaces.set(key, { target, colour: part.colour, hit, members: [part.index + 1] });
    }
  }
  // Solid, paired rails lead from the funnel to each physical surface.
  for (const { target: t } of surfaces.values()) {
    ctx.beginPath();
    ctx.moveTo(box.hopperX, box.hopperY);
    ctx.quadraticCurveTo((box.hopperX + t.x) / 2, Math.max(18, box.hopperY - 76), t.x, t.y - 8);
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // The bench and the rack's bolted supports tie the machine together.
  ctx.fillStyle = theme.panel;
  ctx.fillRect(14, box.floor, width - 28, 8);
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = 2;
  line(ctx, 14, box.floor, width - 14, box.floor);
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 5;
  line(ctx, 14, box.floor + 9, width - 14, box.floor + 9);
  const bars = [...surfaces.values()]
    .filter((s) => s.target.kind === 'bar')
    .sort((a, b) => a.target.y - b.target.y);
  if (bars.length) {
    const first = bars[0].target,
      last = bars[bars.length - 1].target;
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 8;
    line(ctx, box.rackX + 10, first.y - 15, box.rackX + 10, box.floor);
    ctx.beginPath();
    ctx.moveTo(first.x + first.length - 10, first.y - 15);
    for (const { target: t } of bars) ctx.lineTo(t.x + t.length - 10, t.y);
    ctx.lineTo(last.x + last.length - 10, box.floor);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.muted;
    line(ctx, box.rackX + 10, last.y + 15, last.x + last.length - 10, box.floor);
    line(ctx, box.rackX + 10, box.floor, last.x + last.length - 10, last.y + 15);
  }
  const labels: Label[] = [];
  const stationMembers = new Map<number, Set<number>>();
  for (const surface of surfaces.values()) {
    const { target: t, colour, hit } = surface;
    if (t.kind === 'bar') {
      ctx.fillStyle = theme.line;
      ctx.fillRect(t.x, t.y + 2, t.length, t.thickness + 2);
      ctx.fillStyle = colour;
      ctx.globalAlpha = hit ? 1 : 0.65;
      ctx.beginPath();
      ctx.roundRect(t.x, t.y, t.length, t.thickness, Math.min(2, t.thickness / 2));
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.fillStyle = theme.ground;
      for (const x of [t.x + 8, t.x + t.length - 8]) {
        ctx.beginPath();
        ctx.arc(x, t.y + t.thickness / 2, Math.min(1, t.thickness * 0.24), 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      if (t.kind === 'drum') drum(ctx, surface, frame, box.floor);
      else cymbal(ctx, surface, frame, box.floor);
      const ids = stationMembers.get(t.station ?? 0) ?? new Set<number>();
      surface.members.forEach((id) => ids.add(id));
      stationMembers.set(t.station ?? 0, ids);
    }
    if (hit > 0) {
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 2;
      ctx.globalAlpha = hit;
      ctx.shadowColor = colour;
      ctx.shadowBlur = theme.glow ? hit * 18 : 0;
      ctx.beginPath();
      ctx.ellipse(t.x, t.y, 13 + (1 - hit) * 18, 8 + (1 - hit) * 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }
  // No moving marble is painted behind hardware, or over a label.
  for (const { part, state, machine } of motions) {
    if (!part) continue;
    if (state.merged) {
      ctx.strokeStyle = part.colour;
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.45;
      for (const target of machine.targets) {
        const marks = state.marks
          .filter((m) => m.flying && m.target === target)
          .sort((a, b) => a.y - b.y);
        ctx.beginPath();
        marks.forEach((m, i) => {
          if (i) ctx.lineTo(m.x, m.y);
          else ctx.moveTo(m.x, m.y);
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    for (const m of state.marks) {
      if (!m.flying && m.target.kind === 'bar') {
        ctx.strokeStyle = part.colour;
        ctx.lineWidth = 2;
        line(ctx, m.target.x, m.target.y - 2, m.x, m.target.y - 2);
      }
      const r = m.radius + Math.min(4, Math.log2(m.count));
      ctx.fillStyle = m.carried ? theme.panel : part.colour;
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = m.count > 1 ? 2 : 1;
      ellipse(ctx, m.x, m.y, r, r);
      if (!m.carried) {
        ctx.fillStyle = theme.text;
        ctx.beginPath();
        ctx.arc(m.x - r * 0.25, m.y - r * 0.3, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // The hopper has a lip, funnel walls, outlet and loose stock inside it.
  const hx = box.hopperX,
    hy = box.hopperY,
    rim = Math.min(48, width * 0.065);
  ctx.fillStyle = theme.panel;
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hx - rim, hy - 43);
  ctx.lineTo(hx + rim, hy - 43);
  ctx.lineTo(hx + 10, hy - 5);
  ctx.lineTo(hx + 10, hy);
  ctx.lineTo(hx - 10, hy);
  ctx.lineTo(hx - 10, hy - 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = theme.line;
  ctx.fillRect(hx - rim - 4, hy - 47, rim * 2 + 8, 5);
  for (const [dx, dy] of [
    [-rim * 0.35, -30],
    [rim * 0.2, -32],
    [0, -16],
  ]) {
    ctx.fillStyle = theme.accent;
    ctx.strokeStyle = theme.text;
    ctx.lineWidth = 1;
    ellipse(ctx, hx + dx, hy + dy, 5, 5);
  }
  ctx.font = `11px "${theme.fontMono}"`;
  ctx.textAlign = 'left';
  // A separate label column clears the longest bar and the marble beyond its end.
  let lastY = -Infinity;
  for (const { target: t } of bars) {
    if (t.y - lastY < 15) continue;
    labels.push({
      text: noteName(t.pitch ?? 0),
      x: box.labelX,
      y: t.y + 4,
      width: box.labelWidth,
      complete: true,
    });
    lastY = t.y;
  }
  const stations = motions.flatMap((m) => m.machine.targets).filter((t) => t.station !== null);
  for (const [station, ids] of stationMembers) {
    const t = stations.find((t) => t.station === station);
    if (t) {
      const text = [...ids].join('·');
      labels.push({
        text,
        x: t.x - Math.min(50, ctx.measureText(text).width) / 2,
        y: box.floor + 24,
        width: 50,
      });
    }
  }
  const columns = Math.max(1, Math.floor((width - 32) / 200)),
    rows = width < 700 ? 3 : 2,
    limit = columns * rows;
  const legend = visible.length > limit ? visible.slice(0, limit - 1) : visible;
  legend.forEach(({ part, state }, i) => {
    if (!part) return;
    const x = 20 + ((i % columns) * (width - 40)) / columns,
      y = box.floor + 43 + Math.floor(i / columns) * 17;
    ctx.fillStyle = part.colour;
    ctx.beginPath();
    ctx.arc(x, y - 4, 3, 0, Math.PI * 2);
    ctx.fill();
    labels.push({
      text: `${String(part.index + 1)} · ${String(state.flying + state.rolling + state.carried)}${state.merged ? ' stream' : ''} · ${part.name}`,
      x: x + 8,
      y,
      width: (width - 40) / columns - 20,
    });
  });
  if (visible.length > legend.length) {
    const i = legend.length;
    labels.push({
      text: `+${String(visible.length - legend.length)} parts`,
      x: 28 + ((i % columns) * (width - 40)) / columns,
      y: box.floor + 43 + Math.floor(i / columns) * 17,
      width: (width - 40) / columns - 20,
    });
  }
  const total = motions.reduce((n, m) => n + m.state.flying, 0),
    landed = motions.reduce((n, m) => n + m.state.rolling, 0),
    carried = motions.reduce((n, m) => n + m.state.carried, 0);
  labels.push({
    text: `bar ${String(Math.floor(frame.now) + 1)} · ${String(Math.round((frame.now % 1) * 100))}% · window ${String(frame.lookAhead)}`,
    x: 20,
    y: 49,
    width: width - 40,
  });
  labels.push({
    text: 'Gain → size · Window → flight · roll → real span',
    x: 20,
    y: height - 28,
    width: width - 40,
  });
  labels.push({
    text: `${String(total)} flying · ${String(landed)} landed · ${String(carried)} carried · ${String(bars.length)} bars`,
    x: 20,
    y: height - 11,
    width: width - 40,
  });
  ctx.fillStyle = theme.text;
  ctx.font = `22px "${theme.fontDisplay}"`;
  ctx.fillText('Marble run', 20, 30);
  ctx.font = `11px "${theme.fontMono}"`;
  for (const l of labels) {
    const text = l.complete
      ? ctx.measureText(l.text).width <= l.width
        ? l.text
        : ''
      : fit(ctx, l.text, l.width);
    if (!text) continue;
    ctx.fillStyle = theme.ground;
    ctx.fillRect(l.x - 2, l.y - 11, ctx.measureText(text).width + 4, 14);
    ctx.fillStyle = theme.text;
    ctx.fillText(text, l.x, l.y);
  }
}
const view: ViewDefinition = {
  id: 'marble-run',
  name: 'Marble run',
  group: 'rhythm',
  tag: 'landing',
  needs: 'score',
  span: 'window',
  mount(element) {
    const canvas = document.createElement('canvas'),
      ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let notes: ViewFrame['notes'] | undefined,
      score: MarbleScore = new Map();
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const width = Math.max(1, Math.round(frame.width * frame.dpr)),
          height = Math.max(1, Math.round(frame.height * frame.dpr));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        canvas.style.width = `${String(frame.width)}px`;
        canvas.style.height = `${String(frame.height)}px`;
        ctx.reset();
        ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
        if (notes !== frame.notes) {
          notes = frame.notes;
          score = indexMarbles(notes);
        }
        draw(ctx, frame, score);
      },
      dispose() {
        canvas.remove();
        canvas.width = canvas.height = 0;
        notes = undefined;
        score.clear();
      },
    };
  },
};
export default view;
