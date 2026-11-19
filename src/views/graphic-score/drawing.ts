import type { ViewFrame } from '../types';
import { clamp } from '../shared/math';
import type { GraphicScore, Mark, PosterLayout } from './model';

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function path(ctx: CanvasRenderingContext2D, mark: Mark, box: PosterLayout) {
  const a = box.x(mark.from),
    b = box.x(mark.to),
    y = mark.midi === undefined ? box.drumY(mark.note.instrument) : box.y(mark.midi);
  ctx.beginPath();
  if (mark.kind === 'line' || mark.kind === 'tick' || mark.carried) {
    ctx.moveTo(a, y);
    ctx.lineTo(b, y);
    if (mark.kind === 'tick' && !mark.carried) {
      ctx.moveTo(a, y - 3);
      ctx.lineTo(a, y + 3);
    }
  } else if (mark.kind === 'dot') ctx.arc(a, y, 1.8, 0, Math.PI * 2);
  else {
    ctx.moveTo(a - 2, y - 3);
    ctx.lineTo(a + 2, y + 3);
    ctx.moveTo(a + 2, y - 3);
    ctx.lineTo(a - 2, y + 3);
  }
  return { a, b, y };
}
export function drawPoster(
  ctx: CanvasRenderingContext2D,
  score: GraphicScore,
  box: PosterLayout,
  frame: ViewFrame,
) {
  const { width, height, theme } = frame;
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  const colours = new Map(frame.instruments.map((i) => [i.id, i.colour]));
  // Light themes overprint directly. Dark themes get paper under the inks so
  // multiply remains visible; typography keeps the current theme's contrast.
  const dark = ['arcade', 'sunset', 'phosphor'].includes(theme.name);
  const paper = dark ? theme.text : theme.ground;
  const rule = dark ? theme.ground : theme.muted;
  ctx.fillStyle = paper;
  ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.left, box.top, box.right - box.left, box.bottom - box.top);
  ctx.clip();
  ctx.strokeStyle = rule;
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.2;
  for (const p of box.pitchLabels) {
    ctx.beginPath();
    ctx.moveTo(box.left, box.y(p.midi));
    ctx.lineTo(box.right, box.y(p.midi));
    ctx.stroke();
  }
  for (let bar = score.from; bar <= score.to; bar++) {
    ctx.beginPath();
    ctx.moveTo(box.x(bar), box.top);
    ctx.lineTo(box.x(bar), box.bottom);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Unasked score is explicitly hatched, never represented as empty paper.
  for (const [from, to] of [
    [score.from, Math.min(score.to, frame.from)],
    [Math.max(score.from, frame.to), score.to],
  ]) {
    if (to <= from) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x(from), box.top, box.x(to) - box.x(from), box.bottom - box.top);
    ctx.clip();
    ctx.strokeStyle = rule;
    for (let x = box.left - (box.bottom - box.top); x < box.right; x += 9) {
      ctx.beginPath();
      ctx.moveTo(x, box.top);
      ctx.lineTo(x + box.bottom - box.top, box.bottom);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'multiply';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const mark of score.marks) {
    ctx.strokeStyle = ctx.fillStyle = colours.get(mark.note.instrument) ?? theme.accent;
    const weight = 0.6 + clamp(mark.gain, 0, 2) * 3;
    ctx.setLineDash(mark.carried ? [4, 4 + weight] : []);
    if (mark.room > 0) {
      path(ctx, mark, box);
      for (const spread of [1, 0.65, 0.3]) {
        ctx.lineWidth = weight + (5 + mark.room * 8) * spread;
        ctx.globalAlpha = (0.025 + mark.room * 0.045) * (1.2 - spread);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const { a, b, y } = path(ctx, mark, box);
    ctx.lineWidth = weight;
    if (mark.kind === 'dot' && !mark.carried) ctx.fill();
    else ctx.stroke();
    for (const [index, wave] of mark.waves.entries()) {
      const amplitude = 1.5 + wave.width * 6;
      ctx.beginPath();
      ctx.moveTo(a, y);
      const steps = Math.max(2, Math.ceil((b - a) / 3));
      for (let i = 1; i < steps; i++)
        ctx.lineTo(
          a + ((b - a) * i) / steps,
          y + (i % 2 ? -1 : 1) * amplitude * (1 + index * 0.25),
        );
      ctx.lineTo(b, y);
      ctx.lineWidth = 0.85;
      ctx.stroke();
    }
  }
  ctx.restore();
  // Labels live outside the ink and playhead regions; all are >=11 CSS pixels.
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'left';
  ctx.font = `bold ${String(width < 700 ? 27 : 38)}px "${theme.fontDisplay}"`;
  ctx.fillText('Graphic score', box.margin, 43);
  ctx.font = `11px "${theme.fontMono}"`;
  ctx.fillStyle = theme.muted;
  const c = score.counts;
  const summary = `${String(score.to - score.from)} CYCLES / ${String(score.notes.length)} NOTES / ${String(score.panels.length)} PANELS`;
  const counts = `${String(c.line)} LINES · ${String(c.dot)} DOTS · ${String(c.cross)} CROSSES · ${String(c.tick)} TICKS`;
  ctx.fillText(
    fit(ctx, summary + (width >= 700 ? `     ${counts}` : ''), width - 2 * box.margin),
    box.margin,
    65,
  );
  for (const [index, panel] of score.panels.entries()) {
    const a = box.x(panel.from),
      b = box.x(panel.to);
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a, box.top - 2);
    ctx.lineTo(a, box.bottom + 1);
    ctx.stroke();
    ctx.font = `bold 18px "${theme.fontDisplay}"`;
    ctx.fillStyle = theme.text;
    const number = String(index + 1).padStart(2, '0');
    ctx.fillText(fit(ctx, number, b - a - 4), a + 4, 91);
    const offset = ctx.measureText(number).width + 10;
    ctx.font = `11px "${theme.fontMono}"`;
    ctx.fillStyle = theme.muted;
    ctx.fillText(fit(ctx, panel.name, b - a - offset - 5), a + offset, 90);
  }
  ctx.font = `11px "${theme.fontMono}"`;
  ctx.textAlign = 'right';
  ctx.fillStyle = theme.muted;
  for (const p of box.pitchLabels) ctx.fillText(p.label, box.left - 8, box.y(p.midi) + 4);
  const spacing =
    box.drumParts.length > 1 ? box.drumY(box.drumParts[1].id) - box.drumY(box.drumParts[0].id) : 20;
  const stride = Math.max(1, Math.ceil(14 / spacing));
  box.drumParts.forEach((p, i) => {
    if (i % stride === 0)
      ctx.fillText(fit(ctx, p.name, box.left - box.margin - 8), box.left - 8, box.drumY(p.id) + 4);
  });
  ctx.textAlign = 'left';
  const footerTop = height - box.footer;
  ctx.strokeStyle = theme.muted;
  ctx.beginPath();
  ctx.moveTo(box.margin, footerTop);
  ctx.lineTo(width - box.margin, footerTop);
  ctx.stroke();
  const columnWidth = (width - 2 * box.margin) / box.columns;
  const capacity = box.partRows * box.columns;
  score.parts.slice(0, capacity).forEach((part, i) => {
    const x = box.margin + (i % box.columns) * columnWidth,
      y = footerTop + 18 + Math.floor(i / box.columns) * 18;
    ctx.fillStyle = colours.get(part.id) ?? theme.accent;
    ctx.fillRect(x, y - 8, 10, 4);
    ctx.fillStyle = theme.text;
    const detail = part.moving.length
      ? ` ↝ ${part.moving.map((m) => m.name).join(', ')}`
      : part.heldCutoff !== undefined
        ? ` · cutoff ${String(Math.round(part.heldCutoff))} held`
        : '';
    ctx.fillText(fit(ctx, `${part.name}${detail}`, columnWidth - 24), x + 16, y);
  });
  const y = footerTop + box.partRows * 18 + 22;
  ctx.fillStyle = theme.muted;
  const extra =
    score.parts.length > capacity
      ? ` · +${String(score.parts.length - capacity)} ${score.parts.length - capacity === 1 ? 'part' : 'parts'}`
      : '';
  const legends =
    width < 700
      ? [
          `LINE: PITCH / LENGTH · WEIGHT: GAIN${extra}`,
          '• ≤1/16 · × ≤1/4 · ├ LONG · ↝ CHANGING VALUE',
          `HALO: ROOM · DASH: CARRIED · HATCH: UNASKED${stride > 1 ? ` · ROW LABELS EVERY ${String(stride)}` : ''}`,
        ]
      : [
          `LINE: PITCH / LENGTH · WEIGHT: GAIN · • ≤1/16 · × ≤1/4 · ├ LONG${extra}`,
          `↝ WIDTH: CHANGING VALUE · HALO: ROOM · DASH: CARRIED · HATCH: UNASKED${stride > 1 ? ` · ROW LABELS EVERY ${String(stride)}` : ''}`,
        ];
  legends.forEach((text, i) => {
    ctx.fillText(fit(ctx, text, width - 2 * box.margin), box.margin, y + i * 16);
  });
}
export function drawPlayhead(ctx: CanvasRenderingContext2D, box: PosterLayout, frame: ViewFrame) {
  const x = box.x(frame.now);
  if (x < box.left || x > box.right) return;
  const ink = ['arcade', 'sunset', 'phosphor'].includes(frame.theme.name)
    ? frame.theme.ground
    : frame.theme.text;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, box.top);
  ctx.lineTo(x, box.bottom);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(x - 4, box.top - 7);
  ctx.lineTo(x + 4, box.top - 7);
  ctx.lineTo(x, box.top - 2);
  ctx.fill();
}
