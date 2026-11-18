import type { ViewDefinition, ViewFrame } from './types';
import { indexMarbles, machineLayout, machineState } from './marble-run/model';
import type { Machine, MarbleScore } from './marble-run/model';
import { noteName } from './shared/pitch';
import { line } from './shared/retro-2d';

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function draw(ctx: CanvasRenderingContext2D, frame: ViewFrame, score: MarbleScore) {
  const { width, height, theme, now } = frame;
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  const machines = machineLayout(frame, score);
  const labels: { text: string; x: number; y: number; width: number }[] = [];
  const motion: { colour: string; state: ReturnType<typeof machineState>; machine: Machine }[] = [];
  let total = 0,
    rolling = 0,
    carried = 0;
  for (const machine of machines) {
    const part = frame.instruments.find((p) => p.id === machine.id);
    if (!part) continue;
    const colour = part.colour;
    const state = machineState(machine, score, frame);
    motion.push({ colour, state, machine });
    total += state.flying;
    rolling += state.rolling;
    carried += state.carried;
    ctx.fillStyle = theme.panel;
    ctx.fillRect(machine.x + 3, machine.y, machine.width - 6, machine.height - 4);
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1;
    line(
      ctx,
      machine.x + 10,
      machine.y + machine.height - 39,
      machine.x + machine.width - 10,
      machine.y + machine.height - 39,
    );
    for (const target of machine.targets) {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = colour;
      ctx.setLineDash([2, 7]);
      ctx.beginPath();
      ctx.moveTo(width / 2, 92);
      ctx.quadraticCurveTo(
        (width / 2 + target.x) / 2,
        Math.min(60, height * 0.12),
        target.x,
        target.y,
      );
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      const hit = state.hits.get(target.key)?.strength ?? 0;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.fillStyle = hit > 0 ? colour : theme.panel;
      ctx.shadowColor = colour;
      ctx.shadowBlur = theme.glow ? hit * 18 : 0;
      if (target.kind === 'bar') {
        ctx.fillRect(target.x, target.y, target.length, 2);
        ctx.strokeRect(target.x, target.y, target.length, 2);
      } else {
        const r = target.length / 2;
        if (target.kind === 'drum') {
          ctx.fillStyle = theme.panel;
          ctx.fillRect(target.x - r, target.y, r * 2, 18);
          ctx.strokeRect(target.x - r, target.y, r * 2, 18);
          ctx.fillStyle = hit > 0 ? colour : theme.panel;
        } else {
          ctx.strokeStyle = theme.line;
          line(ctx, target.x, target.y, target.x, machine.y + machine.height - 42);
          ctx.strokeStyle = colour;
        }
        ctx.beginPath();
        ctx.ellipse(target.x, target.y, r, target.kind === 'drum' ? 8 : 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      if (hit > 0) {
        ctx.strokeStyle = theme.text;
        ctx.lineWidth = 2;
        ctx.globalAlpha = hit;
        ctx.beginPath();
        ctx.ellipse(target.x, target.y, 13 + (1 - hit) * 20, 8 + (1 - hit) * 9, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // Every text plate is painted after every moving mark, below.
    const pitchTargets = machine.targets.filter((t) => t.pitch !== undefined);
    let lastY = -Infinity;
    for (const target of [...pitchTargets].sort((a, b) => a.y - b.y)) {
      if (target.y - lastY < 15 || target.y > machine.y + machine.height - 43) continue;
      labels.push({
        text: noteName(target.pitch ?? 0),
        x: target.x + target.length + 4,
        y: target.y + 4,
        width: Math.max(0, machine.x + machine.width - target.x - target.length - 10),
      });
      lastY = target.y;
    }
    labels.push({
      text: part.name,
      x: machine.x + 10,
      y: machine.y + machine.height - 24,
      width: machine.width - 20,
    });
    const count = state.flying + state.rolling + state.carried;
    labels.push({
      text: state.merged
        ? `${String(count)} in stream`
        : `${String(count)} · ${pitchTargets.length ? `${String(pitchTargets.length)} bars` : (machine.targets[0]?.kind ?? 'rest')}`,
      x: machine.x + 10,
      y: machine.y + machine.height - 9,
      width: machine.width - 20,
    });
  }
  // Hardware first, all marbles next, all label plates last. A later part's
  // target panel must never erase a marble crossing it on the way down.
  for (const { colour, state, machine } of motion) {
    if (state.merged) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 5;
      for (const target of machine.targets) {
        const marks = state.marks
          .filter((m) => m.flying && m.target === target)
          .sort((a, b) => a.y - b.y);
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        marks.forEach((m, i) => {
          if (i) ctx.lineTo(m.x, m.y);
          else ctx.moveTo(m.x, m.y);
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // Coincident continuation records must not cover an onset-bearing marble.
    for (const marble of [...state.marks].sort((a, b) => Number(b.carried) - Number(a.carried))) {
      ctx.fillStyle = marble.carried ? theme.panel : colour;
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = marble.count > 1 ? 2.5 : 1;
      const r = marble.radius + Math.min(4, Math.log2(marble.count));
      ctx.beginPath();
      ctx.arc(marble.x, marble.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (!marble.carried) {
        ctx.fillStyle = theme.text;
        ctx.beginPath();
        ctx.arc(marble.x - r * 0.25, marble.y - r * 0.3, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // The hopper and the header have their own clean space above the flights.
  ctx.fillStyle = theme.panel;
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 28, 65);
  ctx.lineTo(width / 2 + 28, 65);
  ctx.lineTo(width / 2 + 10, 92);
  ctx.lineTo(width / 2 - 10, 92);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = theme.accent;
  for (const [dx, dy] of [
    [-12, 73],
    [5, 73],
    [-2, 85],
  ]) {
    ctx.beginPath();
    ctx.arc(width / 2 + dx, dy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = `22px "${theme.fontDisplay}"`;
  ctx.fillStyle = theme.text;
  ctx.fillText('Marble run', 20, 30);
  ctx.font = `11px "${theme.fontMono}"`;
  labels.push({
    text: `bar ${String(Math.floor(now) + 1)} · ${String(Math.round((now % 1) * 100))}% · window ${String(frame.lookAhead)}`,
    x: 20,
    y: 49,
    width: width - 40,
  });
  labels.push({
    text: `${String(total)} flying · ${String(rolling)} landed · ${String(carried)} carried`,
    x: 20,
    y: height - 32,
    width: width - 40,
  });
  labels.push({
    text: 'Gain → size · count = marbles · hollow = carried',
    x: 20,
    y: height - 14,
    width: width - 40,
  });
  ctx.textAlign = 'left';
  for (const label of labels) {
    const text = fit(ctx, label.text, label.width);
    if (!text) continue;
    ctx.fillStyle = theme.ground;
    ctx.fillRect(label.x - 2, label.y - 11, ctx.measureText(text).width + 4, 14);
    ctx.fillStyle = theme.text;
    ctx.fillText(text, label.x, label.y);
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
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let notes: ViewFrame['notes'] | undefined,
      score: MarbleScore = new Map();
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const width = Math.max(1, Math.round(frame.width * frame.dpr));
        const height = Math.max(1, Math.round(frame.height * frame.dpr));
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
