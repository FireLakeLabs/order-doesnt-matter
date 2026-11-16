import type { ViewDefinition, ViewFrame } from './types';
import { energy, flash, line, mount2d, quiet } from './shared/retro-2d';
import { analyse, channels, hex, layout, rowY } from './tracker/model';

export function drawTracker(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  data: ReturnType<typeof analyse>,
) {
  const { width: w, height: h, theme: t } = f;
  const l = layout(f),
    top = 112,
    bottom = h - 55;
  c.textAlign = 'left';
  c.font = `bold ${String(w < 600 ? 15 : 23)}px "${t.fontMono}"`;
  c.fillStyle = t.accent;
  c.fillText('ODM-TRACKER', 24, 37);
  c.font = `12px "${t.fontMono}"`;
  c.fillStyle = t.muted;
  c.fillText(`PAT ${hex(Math.floor(f.now) + 1)}  /  16 ROWS`, 24, 60);
  c.textAlign = 'right';
  c.fillStyle = t.text;
  c.fillText(f.playing ? 'PLAY >' : 'HOLD II', w - 24, 35);
  c.fillStyle = t.panel;
  c.fillRect(24, 77, w - 48, bottom - 77);
  c.strokeStyle = t.line;
  c.strokeRect(24.5, 77.5, w - 49, bottom - 77);
  c.fillStyle = t.accent;
  c.globalAlpha = 0.15;
  c.fillRect(25, l.gate - l.rowHeight * 0.5, w - 50, l.rowHeight);
  c.globalAlpha = 1;
  c.strokeStyle = t.accent;
  line(c, 25, l.gate - l.rowHeight * 0.5, w - 25, l.gate - l.rowHeight * 0.5);
  line(c, 25, l.gate + l.rowHeight * 0.5, w - 25, l.gate + l.rowHeight * 0.5);
  c.textAlign = 'left';
  c.font = `11px "${t.fontMono}"`;
  c.fillStyle = t.muted;
  c.fillText('ROW', 32, 99);
  const instruments = channels(f);
  for (let i = 0; i < l.shown; i++) {
    const inst = instruments[i],
      x = l.left + i * l.cell;
    const pulse = energy(data.groups.get(inst.id) ?? [], f);
    c.globalAlpha = quiet(inst);
    c.fillStyle = inst.colour;
    c.fillText(`${hex(inst.index + 1)} ${inst.name}`, x + 8, 97, l.cell - 16);
    c.globalAlpha *= 0.2 + pulse * 0.8;
    const meterWidth = l.cell - 16;
    for (let j = 0; j < 12; j++) {
      c.globalAlpha = quiet(inst) * (j / 12 < pulse ? 1 : 0.12);
      c.fillRect(x + 8 + (j * meterWidth) / 12, 103, Math.max(1, meterWidth / 12 - 2), 4);
    }
    c.globalAlpha = 1;
    c.strokeStyle = t.line;
    line(c, x, 78, x, bottom);
  }
  if (l.hidden) {
    c.fillStyle = t.accent;
    c.textAlign = 'center';
    c.fillText(`+${String(l.hidden)}`, w - 41, 97, 30);
    c.textAlign = 'left';
  }
  c.save();
  c.beginPath();
  c.rect(25, top, w - 50, Math.max(0, bottom - top));
  c.clip();
  const first = Math.floor(f.now * 16 + (top - l.gate) / l.rowHeight) - 1;
  const last = Math.ceil(f.now * 16 + (bottom - l.gate) / l.rowHeight) + 1;
  c.font = `${String(l.cell >= 134 ? 13 : 11)}px "${t.fontMono}"`;
  for (let row = first; row <= last; row++) {
    const y = rowY(f, row, l.gate, l.rowHeight);
    const current = row === l.row;
    if (row % 4 === 0) {
      c.fillStyle = t.line;
      c.globalAlpha = 0.25;
      c.fillRect(25, y - l.rowHeight / 2, w - 50, l.rowHeight);
    }
    c.globalAlpha = current ? 1 : 0.55;
    c.fillStyle = current ? t.text : t.muted;
    c.fillText(`${hex(Math.floor(row / 16) + 1)}:${hex(((row % 16) + 16) % 16)}`, 32, y + 4);
    for (let i = 0; i < l.shown; i++) {
      const inst = instruments[i],
        x = l.left + i * l.cell;
      const cell = data.rows.get(inst.id)?.get(row);
      let held = false;
      if (!cell)
        for (const event of data.groups.get(inst.id) ?? []) {
          if (event.note.start < row / 16 && event.note.end > row / 16) {
            held = true;
            break;
          }
        }
      c.globalAlpha = quiet(inst) * (cell ? 0.95 : held ? 0.42 : 0.2);
      c.fillStyle = cell || held ? inst.colour : t.muted;
      c.shadowColor = inst.colour;
      c.shadowBlur = t.glow && cell && flash(cell.note, f) > 0 ? 7 : 0;
      let label = held ? '=== ==' : '--- --';
      if (cell)
        label = `${cell.label}${cell.off ? '·' : ' '}${hex(inst.index + 1)}${cell.count > 1 ? ` ×${String(cell.count)}` : ''}`;
      c.fillText(label, x + 8, y + 4, Math.max(1, l.cell - (l.effects ? 43 : 12)));
      c.shadowBlur = 0;
      if (l.effects && cell?.effect) c.fillText(cell.effect, x + l.cell - 32, y + 4, 27);
    }
  }
  c.restore();
  // The gate stays fixed while the event rows move continuously through it.
  c.globalAlpha = 1;
  c.fillStyle = t.accent;
  c.fillText('>', 14, l.gate + 4);
  c.fillStyle = t.muted;
  c.font = `11px "${t.fontMono}"`;
  c.fillText('· off-row   × count   C cutoff  V gain  P pan  R room  S shape', 24, h - 30, w - 48);
  c.textAlign = 'right';
  c.fillText(
    `cycle ${String(Math.floor(f.now) + 1)} · row ${hex(((l.row % 16) + 16) % 16)}`,
    w - 24,
    h - 12,
  );
  c.textAlign = 'left';
}
const view: ViewDefinition = {
  id: 'tracker',
  name: 'Tracker',
  tag: 'retro',
  mount: (el) => mount2d(el, analyse, drawTracker),
};
export default view;
