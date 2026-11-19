import type { ViewDefinition, ViewFrame } from './types';
import { indexStacker, stackerRange } from './stacker/model';
import type { Stacker } from './stacker/model';
import { drawingLayout, formIndex } from './stacker/drawing';
import type { Form } from './stacker/drawing';

interface Label {
  text: string;
  x: number;
  y: number;
  size: number;
  width?: number;
}
function draw(
  ctx: CanvasRenderingContext2D,
  frame: ViewFrame,
  score: Stacker,
  forms: Map<number, Form>,
) {
  const { width, height, theme, now } = frame;
  const box = drawingLayout(score, now, width, height, forms);
  const { state, x, top, bottom, wellWidth, side, cell, inkWidth } = box;
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
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  for (let col = 0; col <= 16; col++) {
    ctx.moveTo(x + 4 + (col * inkWidth) / 16, top);
    ctx.lineTo(x + 4 + (col * inkWidth) / 16, bottom);
  }
  for (let y = bottom; y >= top; y -= cell) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + wellWidth, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  const brightness = (colour: string) =>
    [1, 3, 5].reduce((n, i) => n + parseInt(colour.slice(i, i + 2), 16), 0);
  const light = brightness(theme.text) > brightness(theme.ground) ? theme.text : theme.ground;
  const dark = light === theme.text ? theme.ground : theme.text;
  const block = (
    bx: number,
    by: number,
    w: number,
    h: number,
    colour: string,
    outline: boolean,
    active: boolean,
  ) => {
    if (outline) {
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1.25;
      ctx.strokeRect(bx + 0.625, by + 0.625, Math.max(0, w - 1.25), Math.max(0, h - 1.25));
      return;
    }
    const bevel = Math.min(3.5, h / 4, w / 4);
    ctx.fillStyle = colour;
    ctx.fillRect(bx, by, w, h);
    ctx.globalAlpha *= 0.6;
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + w, by);
    ctx.lineTo(bx + w - bevel, by + bevel);
    ctx.lineTo(bx + bevel, by + bevel);
    ctx.lineTo(bx + bevel, by + h - bevel);
    ctx.lineTo(bx, by + h);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha /= 0.6;
    ctx.globalAlpha *= 0.7;
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(bx + w, by);
    ctx.lineTo(bx + w, by + h);
    ctx.lineTo(bx, by + h);
    ctx.lineTo(bx + bevel, by + h - bevel);
    ctx.lineTo(bx + w - bevel, by + h - bevel);
    ctx.lineTo(bx + w - bevel, by + bevel);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha /= 0.7;
    if (active) {
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    }
  };
  const piece = (
    form: Form,
    y: number,
    ghost = false,
    preview = false,
    active = false,
    scale = 1,
    opacity = 1,
    metadata = true,
  ) => {
    const px = preview ? side : x + 4;
    const pw = preview ? width - side - 18 : inkWidth;
    const row = preview ? Math.min(12, 44 / form.rows) : cell;
    const h = form.rows * row * scale;
    if (!form.piece.known || form.blocks.length === 0) {
      if (!ghost && metadata && y >= top && y + 12 <= bottom)
        label(form.piece.known ? 'REST' : 'UNASKED', px + 8, y + 12, 11, pw - 16);
      return;
    }
    ctx.globalAlpha = opacity;
    for (const tile of form.blocks) {
      const by = y + ((tile.lane - form.first) * row + (tile.band * row) / tile.bands) * scale;
      block(
        px + tile.start * pw,
        by,
        (tile.end - tile.start) * pw,
        (row / tile.bands) * scale,
        colours.get(tile.instrument) ?? theme.text,
        ghost,
        active,
      );
    }
    ctx.globalAlpha = 1;
    if (!preview && !ghost && metadata && y + h / 2 >= top + 11 && y + h / 2 <= bottom - 4) {
      label(
        String(form.piece.bar - score.from + 1).padStart(2, '0'),
        x + wellWidth - 54,
        y + h / 2 + 4,
      );
      if (form.crowded)
        label(`×${String(form.crowded)}`, x + wellWidth - 30, y + h / 2 + 4, 11, 29);
    }
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, top, wellWidth, bottom - top);
  ctx.clip();
  for (const placed of box.placed) {
    const raised =
      state.flash && placed.form.piece.bar > (state.flash.match ?? Infinity) ? box.lift : 0;
    piece(placed.form, placed.y - raised);
  }
  if (box.flash && box.lift > 0) {
    const matched = box.placed.find((p) => p.form.piece.bar === state.flash?.match);
    if (matched) {
      ctx.fillStyle = light;
      ctx.globalAlpha = 0.65 * (1 - box.collapse);
      ctx.fillRect(x, matched.y, wellWidth, matched.form.rows * cell);
      ctx.globalAlpha = 1;
    }
    const flashY = box.anchor - box.lift;
    ctx.fillStyle = light;
    ctx.globalAlpha = 0.72 * (1 - box.collapse);
    ctx.fillRect(x, flashY, wellWidth, box.lift);
    ctx.globalAlpha = 1;
    piece(box.flash, flashY, false, false, false, 1 - box.collapse, 1 - box.collapse, false);
    ctx.fillStyle = light;
    ctx.globalAlpha = 0.6 * (1 - box.collapse);
    ctx.fillRect(x, flashY, wellWidth, box.lift);
    ctx.globalAlpha = 1;
  }
  if (box.current) {
    piece(box.current, box.landing - box.lift, true);
    piece(box.current, top + (box.landing - top) * state.phase - box.lift, false, false, true);
  }
  ctx.restore();
  // Section tags remain on their stable landings, outside all block motion.
  box.placed.forEach((placed, i) => {
    const p = placed.form.piece;
    if (i === box.placed.length - 1 || p.section !== box.placed[i + 1].form.piece.section) {
      ctx.fillStyle = theme.text;
      ctx.fillRect(x - 15, placed.y, 4, Math.min(cell, 18));
      if (!box.narrow) label(p.section, 18, placed.y + 13, 11, x - 44);
    }
  });
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
    const nextForm = box.forms.get(state.next.bar);
    if (nextForm) piece(nextForm, 114, false, true);
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
    const available = Math.floor((box.stackTop - 108) / 17);
    const count = Math.max(0, Math.min(score.order.length, available));
    for (let i = 0; i < count; i++) {
      const id = score.order[i];
      ctx.fillStyle = colours.get(id) ?? theme.text;
      ctx.fillRect(18, 94 + i * 17, 6, 8);
      label(
        `${String((i % 6) + 1)} ${frame.instruments.find((p) => p.id === id)?.name ?? id}`,
        30,
        102 + i * 17,
        11,
        x - 56,
      );
    }
    if (count < score.order.length)
      label(`+${String(score.order.length - count)} rows`, 18, 104 + count * 17, 11, x - 40);
  }
  if (state.flash) {
    label(
      `MATCH BAR ${String((state.flash.match ?? score.from) - score.from + 1)}`,
      x + 18,
      top + 27,
      18,
      wellWidth - 36,
    );
  }
  // Fixed footer strips reserve space for counters and density semantics.
  ctx.fillStyle = box.flash ? light : theme.panel;
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
    label(`${String(score.order.length)} parts · 6 lanes`, side, 404, 11, width - side - 12);
  }
  label('EXACT CLEARS · × = MERGED NOTES / SHARED LANES', 18, height - 7, 11, width - 36);
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
    let formCache:
      | { score: Stacker; width: number; height: number; forms: Map<number, Form> }
      | undefined;
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
        if (
          formCache?.score !== score ||
          formCache.width !== frame.width ||
          formCache.height !== frame.height
        )
          formCache = {
            score,
            width: frame.width,
            height: frame.height,
            forms: formIndex(score, frame.width, frame.height),
          };
        draw(ctx, frame, score, formCache.forms);
      },
      dispose() {
        canvas.remove();
        canvas.width = canvas.height = 0;
        score = undefined;
        notes = undefined;
        formCache = undefined;
      },
    };
  },
};
export default view;
