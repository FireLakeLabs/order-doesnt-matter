import type { ViewDefinition, ViewFrame } from './types';
import { mount2d, line } from './shared/retro-2d';
import { burst, type Particle } from './shared/particles';
import { clamp } from './shared/math';
import {
  analyse,
  depth,
  enemyRadius,
  geometry,
  laneFor,
  lanePoint,
  latestTargets,
  layout,
  sectionAt,
  tubePoint,
  type Geometry,
} from './rimshot/model';

function ring(c: CanvasRenderingContext2D, g: Geometry, d: number) {
  c.beginPath();
  for (let i = 0; i < g.lanes; i++) {
    const p = tubePoint(g, i, d);
    if (i) c.lineTo(p.x, p.y);
    else c.moveTo(p.x, p.y);
  }
  c.closePath();
  c.stroke();
}
function quad(c: CanvasRenderingContext2D, g: Geometry, lane: number, end: number) {
  const points = [
    tubePoint(g, lane, 0),
    tubePoint(g, lane + 1, 0),
    tubePoint(g, lane + 1, end),
    tubePoint(g, lane, end),
  ];
  c.beginPath();
  c.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) c.lineTo(p.x, p.y);
  c.closePath();
  c.fill();
}
function enemy(c: CanvasRenderingContext2D, x: number, y: number, r: number, variant: number) {
  // Folded vector packets, with a separate central aperture; no borrowed ships.
  c.beginPath();
  c.moveTo(x - r, y - r * 0.45);
  c.lineTo(x - r * 0.25, y - r);
  c.lineTo(x + r, y - r * 0.25);
  c.lineTo(x + r * 0.25, y + r);
  c.lineTo(x - r, y + r * 0.45);
  c.closePath();
  c.stroke();
  if (variant % 2) line(c, x - r, y - r * 0.45, x + r * 0.25, y + r);
  else c.strokeRect(x - r * 0.22, y - r * 0.22, r * 0.44, r * 0.44);
}
function draw(c: CanvasRenderingContext2D, f: ViewFrame, parts: ReturnType<typeof analyse>) {
  const t = f.theme,
    tube = layout(f, parts),
    section = sectionAt(f);
  const g = geometry(f, tube.lanes, section.index);
  const duration = Math.max(0.001, f.cps) * (f.trails === 2 ? 0.35 : f.trails === 1 ? 0.18 : 0.045);
  let incoming = 0;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  // Every run owns a contiguous coloured wall, including unoccupied lanes.
  for (const run of tube.runs) {
    const col = run.instrument.muted ? t.muted : run.instrument.colour;
    c.fillStyle = col;
    c.globalAlpha = run.instrument.muted ? 0.025 : 0.07;
    for (let lane = run.start; lane < run.start + run.count; lane++) quad(c, g, lane, 1);
    c.globalAlpha = 0.65;
    c.strokeStyle = col;
    c.lineWidth = 1.2;
    for (let lane = run.start; lane < run.start + run.count; lane++) {
      const a = tubePoint(g, lane, 0),
        b = tubePoint(g, lane, 1);
      line(c, a.x, a.y, b.x, b.y);
    }
    const p = lanePoint(g, run.start + (run.count - 1) / 2, 0);
    const dx = p.x - g.cx,
      dy = p.y - g.cy,
      length = Math.hypot(dx, dy) || 1;
    c.globalAlpha = run.instrument.muted ? 0.45 : 1;
    c.font = `10px "${t.fontMono}"`;
    c.fillStyle = col;
    c.textAlign = 'center';
    c.fillText(
      run.instrument.name,
      p.x + (dx / length) * 18,
      p.y + (dy / length) * 18 + 4,
      Math.max(30, Math.min(100, f.width / 6)),
    );
  }
  c.globalAlpha = 0.65;
  c.lineWidth = 1;
  c.strokeStyle = t.muted;
  for (const d of [0.12, 0.3, 0.55, 1]) ring(c, g, d);
  c.globalAlpha = 1;
  c.strokeStyle = t.accent;
  c.lineWidth = 2.5;
  c.shadowColor = t.accent;
  c.shadowBlur = t.glow ? 7 : 0;
  ring(c, g, 0);
  c.shadowBlur = 0;
  if (section.next && section.next.at - f.now <= f.lookAhead) {
    c.strokeStyle = t.accent;
    c.globalAlpha = 0.5;
    c.setLineDash([5, 5]);
    ring(c, { ...g, shape: section.next.index }, depth(section.next.at, f));
    c.setLineDash([]);
  }
  const particle: Particle = { x: 0, y: 0, alpha: 0 };
  for (const run of tube.runs)
    for (const event of run.part.events) {
      const n = event.note,
        lane = laneFor(event, run);
      if (n.end < f.now - duration || n.start > f.now + f.lookAhead) continue;
      const col = run.instrument.muted ? t.muted : run.instrument.colour;
      c.strokeStyle = col;
      c.fillStyle = col;
      c.lineWidth = 2;
      if (n.start <= f.now && n.end > f.now) {
        c.globalAlpha = run.instrument.muted ? 0.08 : 0.32;
        quad(c, g, lane, depth(n.end, f));
        c.globalAlpha = run.instrument.muted ? 0.2 : 0.9;
        const a = lanePoint(g, lane, 0),
          b = lanePoint(g, lane, depth(n.end, f));
        c.shadowColor = col;
        c.shadowBlur = t.glow ? 10 : 0;
        line(c, a.x, a.y, b.x, b.y);
        c.shadowBlur = 0;
      }
      if (!n.hasOnset) continue;
      if (n.start > f.now) {
        incoming++;
        const d = depth(n.start, f),
          p = lanePoint(g, lane, d);
        c.globalAlpha = run.instrument.muted ? 0.25 : 1;
        c.shadowColor = col;
        c.shadowBlur = t.glow ? 5 : 0;
        enemy(c, p.x, p.y, enemyRadius(f, d, tube.merged), run.instrument.index);
        c.shadowBlur = 0;
      } else if (!run.instrument.muted) {
        const age = (f.now - n.start) / duration;
        if (age < 0 || age >= 1) continue;
        const p = lanePoint(g, lane, 0);
        c.shadowColor = col;
        c.shadowBlur = t.glow ? 8 : 0;
        for (let bit = 0; bit < 8; bit++) {
          burst(event.seed + bit * 71, age, particle);
          c.globalAlpha = particle.alpha;
          line(
            c,
            p.x + particle.x * 12,
            p.y + particle.y * 12,
            p.x + particle.x * 46,
            p.y + particle.y * 46,
          );
        }
        c.shadowBlur = 0;
        c.globalAlpha = 1 - age;
        c.strokeStyle = t.text;
        c.beginPath();
        c.arc(p.x, p.y, 4, 0, Math.PI * 2);
        c.stroke();
      }
    }
  c.globalAlpha = 1;
  c.strokeStyle = t.text;
  c.lineWidth = 2.5;
  const claws = latestTargets(f, tube.runs);
  for (const lane of claws.length ? claws : [0]) {
    const p = lanePoint(g, lane, 0),
      dx = p.x - g.cx,
      dy = p.y - g.cy;
    const length = Math.hypot(dx, dy) || 1,
      nx = dx / length,
      ny = dy / length;
    const size = clamp(Math.min(f.width, f.height) * 0.025, 11, 20);
    const at = (side: number, out: number) => ({
      x: p.x - ny * side + nx * out,
      y: p.y + nx * side + ny * out,
    });
    const a = at(-size, -3),
      b = at(-size, 13),
      e = at(size, 13),
      d = at(size, -3),
      stem = at(0, 24),
      mid = at(0, 13);
    c.shadowColor = t.text;
    c.shadowBlur = t.glow ? 7 : 0;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.lineTo(e.x, e.y);
    c.lineTo(d.x, d.y);
    c.stroke();
    line(c, mid.x, mid.y, stem.x, stem.y);
  }
  c.shadowBlur = 0;
  c.lineWidth = 1;
  c.textAlign = 'left';
  c.fillStyle = t.text;
  c.font = `600 24px "${t.fontDisplay}"`;
  c.fillText('Rimshot', 18, 31);
  c.font = `11px "${t.fontMono}"`;
  c.fillStyle = t.muted;
  c.fillText(
    `BAR ${String(Math.floor(f.now) + 1)} · ${String(Math.round((f.now % 1) * 100))}% · WINDOW ${String(f.lookAhead)}`,
    18,
    51,
  );
  c.fillText(`rim = now · throat = one Window ahead`, 18, 68);
  c.fillText(
    `${String(tube.lanes)} lanes${tube.merged ? ` / ${String(tube.logical)} merged` : ''} · ${String(incoming)} incoming`,
    18,
    f.height - 12,
  );
  c.textAlign = 'right';
  c.fillStyle = t.accent;
  c.fillText(
    `LEVEL ${String(section.index + 1)} · ${section.name.toUpperCase()}`,
    f.width - 18,
    30,
    f.width * 0.45,
  );
  if (section.next) {
    c.fillStyle = t.muted;
    c.fillText(`NEXT IN ${(section.next.at - f.now).toFixed(1)}`, f.width - 18, 50);
    c.fillText(section.next.name, f.width - 79, 99, f.width * 0.22);
    c.strokeStyle = t.accent;
    c.globalAlpha = 0.8;
    c.lineWidth = 1.5;
    ring(c, { cx: f.width - 44, cy: 95, rx: 24, ry: 20, lanes: 16, shape: section.next.index }, 0);
  }
  c.globalAlpha = 1;
}
export default {
  id: 'rimshot',
  group: 'arcade',
  name: 'Rimshot',
  tag: 'tube shooter',
  mount: (el) => mount2d(el, analyse, draw),
} satisfies ViewDefinition;
