import type { ViewDefinition, ViewFrame } from './types';
import { indexStacker, notePatches, stackAt, stackerLayout, stackerRange } from './stacker/model';
import type { Piece, Stacker } from './stacker/model';

interface Label {
  text: string;
  x: number;
  y: number;
  size: number;
  width?: number;
}
function draw(ctx: CanvasRenderingContext2D, frame: ViewFrame, score: Stacker) {
  const { width, height, theme, now } = frame;
  const box = stackerLayout(width, height, score.order.length);
  const state = stackAt(score, now, box.capacity);
  const { x, top, bottom, wellWidth, pieceHeight: ph, side } = box;
  const labels: Label[] = [];
  const label = (text: string, x: number, y: number, size = 11, width?: number) =>
    labels.push({ text, x, y, size, width });
  const colours = new Map(frame.instruments.map((i) => [i.id, i.colour]));
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  // Recessed, double-bordered playfield; grid is scaffolding, never timing quantization.
  ctx.fillStyle = theme.line;
  ctx.fillRect(x - 9, top - 9, wellWidth + 18, bottom - top + 18);
  ctx.fillStyle = theme.panel;
  ctx.fillRect(x - 4, top - 4, wellWidth + 8, bottom - top + 8);
  ctx.fillStyle = theme.ground;
  ctx.fillRect(x, top, wellWidth, bottom - top);
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let col = 0; col <= 16; col++) {
    ctx.moveTo(x + (col * wellWidth) / 16, top);
    ctx.lineTo(x + (col * wellWidth) / 16, bottom);
  }
  for (let y = bottom; y >= top; y -= ph) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + wellWidth, y);
  }
  ctx.stroke();
  const activeHeight = Math.max(64, score.order.length * 3 + 8);
  const piece = (p: Piece, y: number, ghost = false, preview = false, falling = false) => {
    const px = preview ? side : x + 5;
    const pw = preview ? width - side - 18 : wellWidth - 10;
    const h = preview ? 44 : falling ? activeHeight : ph - 3;
    ctx.fillStyle = theme.panel;
    if (!ghost) ctx.fillRect(px, y, pw, h);
    ctx.strokeStyle = ghost ? theme.muted : theme.line;
    ctx.setLineDash(ghost ? [4, 4] : []);
    ctx.strokeRect(px + 0.5, y + 0.5, pw - 1, h - 1);
    ctx.setLineDash([]);
    if (!p.known) {
      if (!ghost) label('UNASKED', px + 8, y + h / 2 + 4, 11, pw - 16);
      return;
    }
    const inkWidth = Math.max(1, pw - (preview ? 8 : 68));
    const rowHeight = (h - 6) / Math.max(1, score.order.length);
    let crowded = 0;
    score.order.forEach((id, row) => {
      const patches = notePatches(p, id, inkWidth);
      const py = y + 3 + row * rowHeight;
      for (const patch of patches) {
        const start = px + 4 + patch.start * inkWidth;
        const w = Math.max(0.8, (patch.end - patch.start) * inkWidth - 0.7);
        const rh = Math.max(0.6, rowHeight - 0.45);
        if (ghost) {
          ctx.strokeStyle = theme.muted;
          ctx.strokeRect(start, py, w, rh);
        } else {
          ctx.fillStyle = colours.get(id) ?? theme.text;
          ctx.fillRect(start, py, w, rh);
          // Light top and dark foot give each fractional block its bevel.
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = theme.text;
          ctx.fillRect(start, py, w, Math.min(0.65, rh / 3));
          ctx.fillStyle = theme.ground;
          ctx.fillRect(start, py + rh * 0.7, w, rh * 0.3);
          ctx.globalAlpha = 1;
        }
        if (patch.count > 1) crowded += patch.count;
      }
    });
    if (!preview && !ghost) {
      label(String(p.bar - score.from + 1).padStart(2, '0'), px + pw - 54, y + h / 2 + 4);
      if (crowded) label(`×${String(crowded)}`, px + pw - 30, y + h / 2 + 4, 11, 29);
    }
  };
  state.visible.forEach((p, i) => {
    piece(p, bottom - (i + 1) * ph);
  });
  const landing = bottom - state.visible.length * ph - activeHeight;
  if (state.current) {
    piece(state.current, landing, true, false, true);
    const y = top + (landing - top) * state.phase;
    piece(state.current, y, false, false, true);
    ctx.strokeStyle = theme.text;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 5, y, wellWidth - 10, activeHeight);
  }
  // Section labels sit outside the well, so falling material cannot cover them.
  for (let i = 0; i < state.visible.length; i++) {
    const p = state.visible[i];
    if (i === state.visible.length - 1 || p.section !== state.visible[i + 1].section) {
      const y = bottom - (i + 1) * ph;
      ctx.fillStyle = theme.text;
      ctx.fillRect(x - 15, y, 4, ph - 3);
      if (!box.narrow) label(p.section, 18, y + ph / 2 + 4, 11, x - 44);
    }
  }
  label('STACKER', 18, 31, 23);
  label(
    `BAR ${state.current ? String(state.current.bar - score.from + 1) : '—'} · ${String(Math.min(99, Math.floor(state.phase * 100 + 1e-8)))}% ↓`,
    x,
    55,
    12,
    wellWidth,
  );
  label('NEXT', side, 81);
  if (state.next) {
    label(
      `BAR ${String(state.next.bar - score.from + 1)}${state.current && state.next.bar < state.current.bar ? ' ↻' : ''}`,
      side,
      103,
      16,
    );
    piece(state.next, 114, false, true);
  } else
    label(
      state.current && !score.arranged ? 'NEXT PAGE' : 'NEXT UNASKED',
      side,
      110,
      11,
      width - side - 12,
    );
  const counter = (name: string, value: number, y: number, detail: string) => {
    label(`${name} · ${detail.toUpperCase()}`, side, y, 11, width - side - 12);
    label(String(value).padStart(2, '0'), side, y + 29, 28);
  };
  counter('SCORE', state.completed.filter((p) => p.known).length, 189, 'bars');
  counter('LINES', state.clears.length, 249, 'clears');
  const sectionIndex = frame.sections.findIndex(
    (s) => now - score.from >= s.from && now - score.from < s.to,
  );
  counter('LEVEL', sectionIndex < 0 ? 1 : sectionIndex + 1, 309, 'section');
  label(state.current?.section ?? 'End', side, 359, 12, width - side - 14);
  if (!box.narrow && height >= 560) {
    label('PIECE ROWS', 18, 81);
    const available = Math.floor((bottom - state.visible.length * ph - 108) / 17);
    const count = Math.max(0, Math.min(score.order.length, available));
    for (let i = 0; i < count; i++) {
      const id = score.order[i];
      ctx.fillStyle = colours.get(id) ?? theme.text;
      ctx.fillRect(18, 94 + i * 17, 6, 8);
      label(frame.instruments.find((p) => p.id === id)?.name ?? id, 30, 102 + i * 17, 11, x - 56);
    }
    if (count < score.order.length)
      label(`+${String(score.order.length - count)} rows`, 18, 104 + count * 17, 11, x - 40);
  }
  if (state.flash) {
    ctx.fillStyle = theme.text;
    ctx.globalAlpha = 1 - state.phase / 0.28;
    ctx.fillRect(x + 6, landing + activeHeight / 2 - 2, wellWidth - 12, 4);
    ctx.globalAlpha = 1;
    const text = `CLEAR · MATCH BAR ${String((state.flash.match ?? score.from) - score.from + 1)}`;
    ctx.fillStyle = theme.panel;
    ctx.fillRect(x + 8, top + 12, wellWidth - 16, 35);
    label(text, x + 18, top + 35, 16, wellWidth - 36);
  }
  // Fixed footer strips reserve space for counters and density semantics.
  ctx.fillStyle = theme.panel;
  ctx.fillRect(x, bottom + 13, wellWidth, 18);
  ctx.strokeStyle = theme.line;
  ctx.strokeRect(x, bottom + 13, wellWidth, 18);
  label(
    `${String(state.stack.length)} STACKED · ${String(state.buried)} BURIED${state.unknown ? ` · ${String(state.unknown)} UNASKED` : ''}`,
    x,
    height - 24,
    11,
    wellWidth,
  );
  if (height >= 430) {
    label(
      `${state.current?.known ? String(state.current.notes.length) : '?'} notes falling`,
      side,
      386,
      11,
      width - side - 12,
    );
    label(`${String(score.order.length)} part rows`, side, 404, 11, width - side - 12);
  }
  label('EXACT VALUES CLEAR · × = MERGED NOTES', 18, height - 7, 11, width - 36);
  // All text uses the theme's text/ground pair, on opaque plates, after motion.
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const l of labels) {
    ctx.font = `${String(l.size)}px "${l.size > 16 ? theme.fontDisplay : theme.fontMono}"`;
    let text = l.text;
    if (l.width !== undefined) {
      while (text.length && ctx.measureText(text).width > l.width) text = text.slice(0, -1);
      if (text !== l.text && text.length > 1) text = `${text.slice(0, -1)}…`;
    }
    const w = ctx.measureText(text).width;
    ctx.fillStyle = theme.ground;
    ctx.fillRect(l.x - 2, l.y - l.size, w + 4, l.size + 4);
    ctx.fillStyle = theme.text;
    ctx.fillText(text, l.x, l.y);
  }
}
const view: ViewDefinition = {
  id: 'stacker',
  name: 'Stacker',
  group: 'arcade',
  tag: 'falling blocks',
  span: 'song',
  mount(element) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let score: Stacker | undefined,
      notes: ViewFrame['notes'] | undefined,
      key = '';
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const next = JSON.stringify([
          stackerRange(frame),
          frame.from,
          frame.to,
          frame.sections,
          frame.instruments.map((i) => [i.id, i.index]),
        ]);
        if (!score || notes !== frame.notes || key !== next) {
          score = indexStacker(frame);
          notes = frame.notes;
          key = next;
        }
        const w = Math.max(1, Math.round(frame.width * frame.dpr)),
          h = Math.max(1, Math.round(frame.height * frame.dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        canvas.style.width = `${String(frame.width)}px`;
        canvas.style.height = `${String(frame.height)}px`;
        ctx.reset();
        ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
        draw(ctx, frame, score);
      },
      dispose() {
        canvas.remove();
        canvas.width = canvas.height = 0;
        score = undefined;
        notes = undefined;
      },
    };
  },
};
export default view;
