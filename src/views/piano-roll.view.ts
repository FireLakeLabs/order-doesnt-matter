import type { ViewDefinition, ViewFrame } from './types';
import {
  flash,
  gate,
  indexScore,
  line,
  mount2d,
  pitchName,
  quiet,
  ruler,
  timeline,
  type Score,
} from './shared/retro-2d';
import { rows, trail } from './piano-roll/model';
export function drawPianoRoll(c: CanvasRenderingContext2D, f: ViewFrame, score: Score) {
  const { width: w, height: h, theme: t } = f;
  const left = Math.min(110, w * 0.2),
    right = w - 25,
    r = rows(f, score),
    time = timeline(f, left, right);
  c.textAlign = 'left';
  c.fillStyle = t.text;
  c.font = `24px "${t.fontDisplay}"`;
  c.fillText('Piano roll', 24, 37);
  c.font = `11px "${t.fontMono}"`;
  c.fillStyle = t.muted;
  c.fillText('PITCH / TIME', 25, 59);
  c.fillStyle = t.panel;
  c.fillRect(24, r.top, w - 49, r.bottom - r.top);
  c.font = `10px "${t.fontMono}"`;
  for (let p = Math.ceil(r.low); p <= r.high; p++) {
    const y = r.y(p),
      black = [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
    let lit = false;
    for (const inst of f.instruments) {
      if (inst.muted || !inst.inSection) continue;
      if (
        score
          .get(inst.id)
          ?.some(
            (e) =>
              e.pitch !== undefined &&
              Math.round(e.pitch) === p &&
              e.note.hasOnset &&
              e.note.start <= f.now &&
              e.note.end > f.now,
          )
      )
        lit = true;
    }
    c.globalAlpha = black ? 0.16 : 0.035;
    c.fillStyle = t.text;
    c.fillRect(left, y - r.keyHeight / 2, right - left, r.keyHeight);
    c.globalAlpha = lit ? 1 : black ? 0.35 : 0.12;
    c.fillStyle = lit ? t.accent : t.text;
    c.fillRect(
      25,
      y - r.keyHeight / 2 + 0.5,
      left - (black ? 46 : 28),
      Math.max(1, r.keyHeight - 1),
    );
    if (r.keyHeight > 9 && (p % 12 === 0 || r.pitches < 15)) {
      c.globalAlpha = 0.8;
      c.fillStyle = lit ? t.ground : t.muted;
      c.fillText(pitchName(p), 31, y + 3);
    }
  }
  for (const [i, id] of r.unpitched.entries()) {
    const inst = f.instruments.find((inst) => inst.id === id);
    if (!inst) continue;
    const y = r.drumY(id);
    c.globalAlpha = quiet(inst) * 0.8;
    c.fillStyle = inst.colour;
    c.fillText(inst.name, 30, y + 3, left - 38);
    c.globalAlpha = i % 2 ? 0.1 : 0.05;
    c.fillRect(left, y - r.drumRow / 2, right - left, r.drumRow);
  }
  c.globalAlpha = 1;
  c.strokeStyle = t.line;
  line(c, 25, r.split, right, r.split);
  ruler(c, f, left, right, r.top, r.bottom);
  c.save();
  c.beginPath();
  c.rect(left, r.top, right - left, r.bottom - r.top);
  c.clip();
  for (const inst of f.instruments) {
    const events = score.get(inst.id) ?? [];
    for (const e of events) {
      const n = e.note;
      if (n.end < time.from || n.start > time.to) continue;
      const y = e.pitch === undefined ? r.drumY(inst.id) : r.y(e.pitch);
      const row = e.pitch === undefined ? r.drumRow : r.keyHeight;
      const height = Math.max(1, row * 0.72),
        x = time.x(n.start),
        end = time.x(n.end);
      const tail = trail(n, f);
      const hit = flash(n, f),
        held = n.hasOnset && n.start <= f.now && n.end > f.now;
      c.globalAlpha =
        quiet(inst) *
        (n.hasOnset ? (held ? 0.95 : n.end <= f.now ? 0.12 + tail * 0.65 : 0.7) : 0.22);
      c.fillStyle = inst.colour;
      c.shadowColor = inst.colour;
      c.shadowBlur = t.glow && (held || tail > 0) && events.length < 256 ? 14 : 0;
      c.beginPath();
      c.roundRect(x, y - height / 2, Math.max(1, end - x - 1), height, Math.min(3, height / 3));
      c.fill();
      c.shadowBlur = 0;
      if (n.hasOnset) {
        c.globalAlpha = quiet(inst) * (0.5 + hit * 0.5);
        c.fillStyle = t.text;
        c.fillRect(x, y - height / 2, 2, height);
      }
      if (held || hit) {
        c.globalAlpha = quiet(inst) * Math.max(hit, 0.5);
        c.fillStyle = t.text;
        c.fillRect(time.gate - 2, y - height / 2, 4 + hit * 5, height);
      }
      // Positional stripes retain instrument identity on Pocket's limited palette.
      if (t.name === 'pocket' && inst.index % 2) {
        c.globalAlpha = quiet(inst) * 0.7;
        c.strokeStyle = t.ground;
        line(c, x, y, end, y);
      }
    }
  }
  c.restore();
  gate(c, f, time.gate, r.top, r.bottom);
  c.font = `11px "${t.fontMono}"`;
  c.fillStyle = t.muted;
  c.textAlign = 'left';
  const legendWidth = (w - 50) / Math.max(1, f.instruments.length);
  c.font = `10px "${t.fontMono}"`;
  for (const [i, inst] of f.instruments.entries()) {
    c.globalAlpha = quiet(inst) * 0.85;
    c.fillStyle = inst.colour;
    c.fillRect(25 + i * legendWidth, h - 34, Math.max(1, legendWidth - 8), 2);
    c.fillText(inst.name, 25 + i * legendWidth, h - 18, Math.max(1, legendWidth - 8));
  }
  c.globalAlpha = 1;
  c.textAlign = 'right';
  c.fillText(`cycle ${String(Math.floor(f.now) + 1)} · ${String(f.lookAhead)} window`, w - 25, 37);
  c.textAlign = 'left';
}
const view: ViewDefinition = {
  id: 'piano-roll',
  name: 'Piano roll',
  tag: 'classic',
  mount: (el) => mount2d(el, indexScore, drawPianoRoll),
};
export default view;
