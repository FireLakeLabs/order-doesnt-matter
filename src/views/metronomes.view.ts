import type { ViewDefinition, ViewFrame } from './types';
import { line, mount2d } from './shared/retro-2d';
import { analyse, EXTREME, inStep, layout, poses, swing, type Pose } from './metronomes/model';

function metronome(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  p: Pose,
  x: number,
  y: number,
  scale: number,
) {
  const t = f.theme,
    colour = p.instrument.colour;
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  c.globalAlpha = p.instrument.muted ? 0.25 : p.resting ? 0.4 : 1;
  c.fillStyle = t.panel;
  c.strokeStyle = t.line;
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(-62, 35);
  c.lineTo(62, 35);
  c.lineTo(26, -155);
  c.lineTo(-26, -155);
  c.closePath();
  c.fill();
  c.stroke();
  if (p.held) {
    c.save();
    c.globalAlpha *= 0.13;
    c.fillStyle = colour;
    c.fill();
    c.restore();
  }
  c.fillStyle = t.ground;
  c.beginPath();
  c.roundRect(-7, -143, 14, 150, 7);
  c.fill();
  c.strokeStyle = t.line;
  c.lineWidth = 2;
  const arc = (lo: number, hi: number) => {
    c.beginPath();
    c.arc(0, 0, 200, lo - Math.PI / 2, hi - Math.PI / 2);
    c.stroke();
  };
  arc(-EXTREME, EXTREME);
  for (const angle of [-EXTREME, 0, EXTREME]) {
    c.save();
    c.rotate(angle);
    line(c, 0, -194, 0, -206);
    c.restore();
  }
  if (p.lit) {
    c.strokeStyle = colour;
    c.lineWidth = 5;
    c.lineCap = 'round';
    arc(p.lit[0], p.lit[1]);
    c.beginPath();
    c.arc(Math.sin(p.angle) * 200, -Math.cos(p.angle) * 200, 3, 0, Math.PI * 2);
    c.fillStyle = colour;
    c.fill();
  }
  if (p.fan && !p.resting) {
    c.save();
    c.globalAlpha *= 0.18;
    c.fillStyle = colour;
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, 200, -EXTREME - Math.PI / 2, EXTREME - Math.PI / 2);
    c.closePath();
    c.fill();
    c.globalAlpha *= 2;
    c.strokeStyle = colour;
    c.lineWidth = 1;
    for (let i = 0; i <= 16; i++) {
      c.save();
      c.rotate(-EXTREME + (2 * EXTREME * i) / 16);
      line(c, 0, 0, 0, -200);
      c.restore();
    }
    c.restore();
  }
  const arm = (angle: number, alpha: number, weight: boolean) => {
    c.save();
    c.rotate(angle);
    c.globalAlpha *= alpha;
    c.strokeStyle = colour;
    c.lineWidth = 5;
    c.lineCap = 'round';
    if (weight && p.held && t.glow && !p.fan) {
      c.shadowColor = colour;
      c.shadowBlur = 10;
    }
    line(c, 0, 0, 0, -200);
    c.shadowBlur = 0;
    if (weight) {
      c.fillStyle = colour;
      c.beginPath();
      c.roundRect(-11, -200 * p.weight - 8, 22, 16, Math.min(t.radius, 4));
      c.fill();
      // The weight remains legible even when Pocket colours repeat.
      c.strokeStyle = t.text;
      c.lineWidth = 1;
      c.stroke();
    }
    c.restore();
  };
  if (f.trails && !p.resting && !p.fan) {
    for (const [age, alpha] of [
      [0.07, 0.12],
      [0.035, 0.25],
    ])
      arm(swing(p.part, f.now - age * f.cps * f.trails), alpha, false);
  }
  arm(p.angle, 1, true);
  c.fillStyle = t.line;
  c.beginPath();
  c.arc(0, 0, 7, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
function drawMetronomes(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  parts: ReturnType<typeof analyse>,
) {
  const cast = poses(f, parts).sort((a, b) => Number(a.resting) - Number(b.resting)),
    grid = layout(f, cast.length),
    t = f.theme;
  c.textAlign = 'left';
  c.fillStyle = t.text;
  c.font = `600 24px "${t.fontDisplay}"`;
  c.fillText('Metronomes', 24, 35);
  c.textAlign = 'right';
  c.fillStyle = t.muted;
  c.font = `11px "${t.fontMono}"`;
  c.fillText(
    `bar ${String(Math.floor(f.now) + 1)} · ${String(Math.round((f.now % 1) * 100))}%`,
    f.width - 24,
    34,
  );
  c.textAlign = 'left';
  const groups = inStep(cast);
  const header = groups.length
    ? groups.map((g) => `${g.map((p) => p.instrument.name).join(' · ')} swing in step`).join(' / ')
    : 'Independent swings';
  // Wrap the measured groups rather than squeezing a long arrangement into one line.
  c.font = `12px "${t.fontMono}"`;
  c.fillStyle = t.muted;
  const words = header.split(' ');
  let text = '',
    row = 0;
  for (const word of words) {
    if (c.measureText(`${text} ${word}`).width > f.width - 48 && text) {
      c.fillText(text, 24, 61 + row * 17);
      text = word;
      row++;
    } else text = text ? `${text} ${word}` : word;
  }
  c.fillText(text, 24, 61 + row * 17);
  const top = Math.max(grid.top, 78 + row * 17);
  const cellHeight = Math.max(1, (f.height - top - 38) / grid.rows);
  for (const [i, p] of cast.entries()) {
    const column = i % grid.columns,
      r = Math.floor(i / grid.columns);
    const cx = 16 + (column + 0.5) * grid.cellWidth;
    const scale = Math.max(0.01, Math.min(grid.cellWidth / 156, (cellHeight - 68) / 250, 1.5));
    const base = top + (r + 1) * cellHeight - 35 * scale - 50;
    c.fillStyle = t.panel;
    c.fillRect(16 + column * grid.cellWidth + 6, base + 35 * scale, grid.cellWidth - 12, 5);
    metronome(c, f, p, cx, base, scale);
    c.font = `12px "${t.fontMono}"`;
    c.textAlign = 'center';
    c.fillStyle = p.held ? t.text : t.muted;
    c.fillText(p.instrument.name, cx, base + 35 * scale + 24, grid.cellWidth - 14);
    c.font = `10px "${t.fontMono}"`;
    c.fillStyle = t.muted;
    c.fillText(
      p.resting ? 'rest' : `${String(p.hits)} hits / cycle${p.fan ? ' · fan' : ''}`,
      cx,
      base + 35 * scale + 41,
      grid.cellWidth - 14,
    );
  }
  if (!cast.length) {
    c.textAlign = 'center';
    c.fillStyle = t.muted;
    c.fillText('Bring a score to set the arms in motion.', f.width / 2, f.height / 2);
  }
  c.textAlign = 'left';
  c.fillStyle = t.muted;
  c.font = `10px "${t.fontMono}"`;
  c.fillText('ONSET → EXTREME     HOLD → LIT SWING', 24, f.height - 14, f.width - 48);
}
const view: ViewDefinition = {
  id: 'metronomes',
  group: 'rhythm',
  name: 'Metronomes',
  tag: 'in step',
  mount: (el) => mount2d(el, analyse, drawMetronomes),
};
export default view;
