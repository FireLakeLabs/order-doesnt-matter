import type { ViewDefinition, ViewFrame } from './types';
import {
  energy,
  flash,
  gate,
  indexScore,
  line,
  mount2d,
  quiet,
  ruler,
  type Score,
} from './shared/retro-2d';
import { layout } from './punchcard/model';
export function drawPunchcard(c: CanvasRenderingContext2D, f: ViewFrame, score: Score) {
  const { width: w, height: h, theme: t } = f,
    l = layout(f);
  c.textAlign = 'left';
  c.font = `24px "${t.fontDisplay}"`;
  c.fillStyle = t.text;
  c.fillText('Punchcard', 25, 36);
  c.fillStyle = t.panel;
  // The clipped corner and registration rails belong to the stock, not the score.
  c.beginPath();
  c.moveTo(20, 62);
  c.lineTo(w - 55, 62);
  c.lineTo(w - 20, 97);
  c.lineTo(w - 20, h - 34);
  c.lineTo(20, h - 34);
  c.closePath();
  c.fill();
  c.strokeStyle = t.line;
  c.stroke();
  c.fillStyle = t.muted;
  c.font = `10px "${t.fontMono}"`;
  c.fillText('ODM  /  SCORE READER', 37, 86);
  c.textAlign = 'right';
  c.fillText(`NO. ${String(Math.floor(f.now) + 1).padStart(4, '0')}`, w - 68, 86);
  c.textAlign = 'left';
  ruler(c, f, l.left, l.right, l.top, l.bottom);
  const ordered = [...f.instruments].sort((a, b) => a.index - b.index);
  for (const [i, inst] of ordered.entries()) {
    const y = l.top + (i + 0.5) * l.row,
      events = score.get(inst.id) ?? [],
      pulse = energy(events, f);
    c.globalAlpha = quiet(inst) * 0.14;
    c.strokeStyle = t.muted;
    c.setLineDash([2, 5]);
    line(c, 36, y, l.right, y);
    c.setLineDash([]);
    c.globalAlpha = quiet(inst);
    c.fillStyle = pulse ? inst.colour : t.muted;
    c.font = `${String(Math.min(12, Math.max(8, l.row * 0.35)))}px "${t.fontMono}"`;
    c.fillText(`${String(i + 1).padStart(2, '0')} ${inst.name}`, 37, y - 6, l.left - 47);
    c.globalAlpha = quiet(inst) * (0.2 + pulse * 0.8);
    c.fillStyle = inst.colour;
    c.fillRect(37, y + 2, (l.left - 53) * (0.12 + 0.88 * pulse), 3);
    c.save();
    c.beginPath();
    c.rect(l.left, l.top, l.right - l.left, l.bottom - l.top);
    c.clip();
    const holeHeight = Math.min(23, l.row * 0.48);
    for (const { note: n } of events) {
      if (n.end < l.time.from || n.start > l.time.to) continue;
      const x = l.time.x(n.start),
        end = l.time.x(n.end);
      if (!n.hasOnset) {
        c.globalAlpha = quiet(inst) * 0.2;
        c.strokeStyle = inst.colour;
        line(c, x, y, end, y);
        continue;
      }
      const hit = flash(n, f),
        held = f.now >= n.start && f.now < n.end;
      const width = Math.max(3, end - x - 2);
      c.globalAlpha = quiet(inst);
      c.fillStyle = t.ground;
      c.beginPath();
      c.roundRect(x, y - holeHeight / 2, width, holeHeight, Math.min(4, holeHeight / 2));
      c.fill();
      c.strokeStyle = inst.colour;
      c.globalAlpha *= held ? 1 : 0.5;
      c.stroke();
      if (held || hit) {
        c.globalAlpha = quiet(inst) * (0.38 + hit * 0.62);
        c.fillStyle = inst.colour;
        c.shadowColor = inst.colour;
        c.shadowBlur = t.glow && events.length < 256 ? 14 : 0;
        c.fill();
        c.shadowBlur = 0;
        c.globalAlpha = quiet(inst) * hit;
        c.fillStyle = t.text;
        c.fillRect(l.time.gate - 2, y - holeHeight / 2, 4, holeHeight);
      }
      // A distinct leading edge preserves every onset even when slots overlap.
      c.globalAlpha = quiet(inst) * 0.8;
      c.fillStyle = inst.colour;
      c.fillRect(x, y - holeHeight / 2, 2, holeHeight);
      if (t.name === 'pocket' && inst.index % 2) {
        c.globalAlpha = quiet(inst) * 0.55;
        c.strokeStyle = t.text;
        line(c, x + 2, y, x + width - 2, y);
      }
    }
    c.restore();
  }
  gate(c, f, l.time.gate, l.top, l.bottom);
  c.globalAlpha = 0.45;
  c.fillStyle = t.ground;
  for (let x = 38; x < w - 38; x += 22) {
    c.beginPath();
    c.roundRect(x, h - 57, 9, 5, 2);
    c.fill();
  }
  c.globalAlpha = 0.7;
  c.fillStyle = t.muted;
  c.font = `10px "${t.fontMono}"`;
  c.fillText('ONSET / HOLD     •     FEED →', 37, h - 16, w * 0.6);
  c.globalAlpha = 1;
  c.textAlign = 'right';
  c.fillText(`cycle ${String(Math.floor(f.now) + 1)} · ${String(f.lookAhead)} window`, w - 25, 35);
  c.textAlign = 'left';
}
const view: ViewDefinition = {
  id: 'punchcard',
  name: 'Punchcard',
  tag: 'classic',
  mount: (el) => mount2d(el, indexScore, drawPunchcard),
};
export default view;
