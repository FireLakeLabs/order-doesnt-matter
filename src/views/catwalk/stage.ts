import type { ViewFrame } from '../types';
import { line } from '../shared/retro-2d';
import { cameraFlashes, runway, type ShowScore } from './model';

function polygon(c: CanvasRenderingContext2D, points: number[][]) {
  c.beginPath();
  points.forEach(([x, y], i) => {
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  });
  c.closePath();
  c.fill();
  c.stroke();
}
export function drawStage(c: CanvasRenderingContext2D, frame: ViewFrame) {
  const { width: w, height: h, theme } = frame;
  const r = runway(frame);
  const cx = w / 2;
  // Full-height folds frame a dark entrance, with the section as the collection title.
  c.fillStyle = theme.panel;
  c.fillRect(w * 0.1, h * 0.1, w * 0.8, r.back - h * 0.1);
  c.strokeStyle = theme.line;
  c.lineWidth = 2;
  for (let i = 0; i <= 24; i++) {
    const x = w * (0.1 + i * (0.8 / 24));
    c.beginPath();
    c.moveTo(x, h * 0.1);
    c.quadraticCurveTo(x - 10, h * 0.23, x, r.back);
    c.stroke();
  }
  c.fillStyle = theme.ground;
  c.fillRect(cx - r.backWidth * 0.43, h * 0.215, r.backWidth * 0.86, h * 0.125);
  c.strokeStyle = theme.muted;
  c.lineWidth = 1;
  line(c, cx - r.backWidth * 0.43, h * 0.215, cx - r.backWidth * 0.43, r.back);
  line(c, cx + r.backWidth * 0.43, h * 0.215, cx + r.backWidth * 0.43, r.back);
  const length = frame.sections.at(-1)?.to ?? 0;
  const local = length > 0 ? ((frame.now % length) + length) % length : frame.now;
  const section =
    frame.sections.find((s) => s.from <= local && s.to > local)?.name ?? 'THE COLLECTION';
  c.textAlign = 'center';
  c.fillStyle = theme.text;
  c.font = `bold ${String(Math.min(28, w / 40))}px "${theme.fontDisplay}"`;
  c.fillText(section.toUpperCase(), cx, h * 0.165, w * 0.4);
  c.fillStyle = theme.muted;
  c.font = `10px "${theme.fontMono}"`;
  c.fillText('ORDER DOESN’T MATTER · RUNWAY SHOW', cx, h * 0.195, w * 0.42);
  c.fillStyle = theme.panel;
  c.strokeStyle = theme.line;
  polygon(c, [
    [cx - r.backWidth / 2, r.back],
    [cx + r.backWidth / 2, r.back],
    [cx + r.frontWidth / 2, r.front],
    [cx - r.frontWidth / 2, r.front],
  ]);
  // A raised front lip and converging seams establish the audience-end perspective.
  polygon(c, [
    [cx - r.frontWidth / 2, r.front],
    [cx + r.frontWidth / 2, r.front],
    [cx + r.frontWidth / 2, r.front + 13],
    [cx - r.frontWidth / 2, r.front + 13],
  ]);
  c.globalAlpha = 0.35;
  for (const side of [-1, 1])
    line(c, cx + side * r.backWidth * 0.22, r.back, cx + side * r.frontWidth * 0.22, r.front);
  c.globalAlpha = 1;
  for (let i = 0; i < 12; i++) {
    const p = i / 11;
    const y = r.back + (r.front - r.back) * p;
    const half = (r.backWidth + (r.frontWidth - r.backWidth) * p) / 2;
    for (const side of [-1, 1]) {
      c.fillStyle = theme.text;
      c.shadowColor = theme.accent;
      c.shadowBlur = theme.glow ? 7 : 0;
      c.beginPath();
      c.ellipse(cx + side * (half - 4), y, 1.5 + p * 2, 1 + p, 0, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.shadowBlur = 0;
  c.textAlign = 'left';
}

export function photographer(frame: ViewFrame, slot: number) {
  const r = runway(frame);
  const p = (Math.floor(slot / 2) + 0.5) / 10;
  const side = slot % 2 ? 1 : -1;
  return {
    x:
      frame.width / 2 + side * ((r.backWidth + (r.frontWidth - r.backWidth) * p) / 2 + 25 + 30 * p),
    y: r.back + (r.front - r.back) * p + 12,
    scale: 0.45 + p * 0.75,
    side,
  };
}
export function drawPhotographers(c: CanvasRenderingContext2D, frame: ViewFrame, score: ShowScore) {
  const { theme } = frame;
  for (let i = 0; i < 20; i++) {
    const p = photographer(frame, i);
    c.save();
    c.translate(p.x, p.y);
    c.scale(p.scale, p.scale);
    c.fillStyle = theme.line;
    c.strokeStyle = theme.muted;
    c.lineWidth = 1;
    c.beginPath();
    c.arc(0, -25, 6, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.beginPath();
    c.roundRect(-9, -18, 18, 21, 6);
    c.fill();
    c.lineWidth = 4;
    line(c, -4, 0, -11, 9);
    line(c, 4, 0, 12, 9);
    line(c, p.side * 6, -13, -p.side * 10, -19);
    c.fillStyle = theme.muted;
    c.fillRect(-p.side * 11 - 5, -24, 10, 7);
    c.fillStyle = theme.ground;
    c.fillRect(-p.side * 11 - 2, -23, 4, 4);
    c.restore();
  }
  const flashes = cameraFlashes(frame, score);
  // Separate coloured rings preserve simultaneous parts sharing a photographer.
  for (const f of flashes) {
    const p = photographer(frame, f.slot);
    const instrument = frame.instruments.find((i) => i.id === f.instrument);
    if (!instrument) continue;
    const x = p.x - p.side * 11 * p.scale,
      y = p.y - 25 * p.scale;
    c.save();
    c.strokeStyle = instrument.colour;
    c.fillStyle = instrument.colour;
    c.globalAlpha = f.brightness * (instrument.muted ? 0.3 : 1);
    c.shadowColor = instrument.colour;
    c.shadowBlur = theme.glow ? 18 : 0;
    c.lineWidth = 1.5;
    const radius = (5 + f.brightness * 15) * p.scale;
    c.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const r = i % 2 ? radius * 0.28 : radius;
      const xx = x + Math.cos(a) * r,
        yy = y + Math.sin(a) * r;
      if (i) c.lineTo(xx, yy);
      else c.moveTo(xx, yy);
    }
    c.closePath();
    c.fill();
    c.stroke();
    c.shadowBlur = 0;
    c.beginPath();
    c.arc(x, y, radius + 3 + (instrument.index % 4) * 3, 0, Math.PI * 2);
    c.stroke();
    if (f.count > 1) {
      c.globalAlpha = 1;
      c.font = `bold 10px "${theme.fontMono}"`;
      c.fillText(`×${String(f.count)}`, x + radius + 3, y - 3);
    }
    c.restore();
  }
}
