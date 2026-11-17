import type { ViewDefinition, ViewFrame } from './types';
import {
  currentPatch,
  indexQuilt,
  quiltLayout,
  quiltRange,
  ringGeometry,
  ringPoint,
  ringSegment,
  stitchAt,
} from './quilt/model';
import type { Quilt, QuiltLayout } from './quilt/model';
import { clamp } from './shared/math';

type Cell = QuiltLayout['cells'][number];
function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function drawStitches(
  ctx: CanvasRenderingContext2D,
  cell: Cell,
  side: number,
  frame: ViewFrame,
  colours: Map<string, string>,
  sewn: boolean,
  progress = 1,
) {
  const { theme } = frame;
  cell.row.instruments.forEach((id, index) => {
    const ring = ringGeometry(side, cell.row.instruments.length, index);
    const x = cell.x + ring.inset,
      y = cell.y + ring.inset;
    ctx.strokeStyle = sewn ? (colours.get(id) ?? theme.text) : theme.muted;
    ctx.lineWidth = sewn ? ring.stroke : Math.min(1.25, ring.stroke * 0.55);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const carried of [false, true]) {
      ctx.setLineDash(!sewn ? [2, 3] : carried ? [0.1, Math.max(1, ring.stroke * 1.8)] : []);
      ctx.beginPath();
      for (const stitch of cell.patch.stitches) {
        if (stitch.instrument !== id || stitch.carried !== carried) continue;
        const { end } = stitchAt(stitch, progress);
        if (end <= stitch.start) continue;
        const points = ringSegment(ring.length, stitch.start, end);
        ctx.moveTo(x + points[0][0], y + points[0][1]);
        for (const point of points.slice(1)) ctx.lineTo(x + point[0], y + point[1]);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (!sewn) return;
    ctx.fillStyle = theme.text;
    const radius = ring.texture ? Math.min(0.7, side * 0.01) : Math.min(2.5, side * 0.03);
    ctx.beginPath();
    for (const stitch of cell.patch.stitches) {
      if (stitch.instrument !== id || !stitchAt(stitch, progress).knot) continue;
      const point = ringPoint(ring.length, stitch.start);
      ctx.rect(x + point[0] - radius, y + point[1] - radius, radius * 2, radius * 2);
    }
    ctx.fill();
  });
}
function drawBase(
  ctx: CanvasRenderingContext2D,
  quilt: Quilt,
  box: QuiltLayout,
  frame: ViewFrame,
  colours: Map<string, string>,
) {
  const { width, height, theme, now } = frame;
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.text;
  ctx.font = `22px "${theme.fontDisplay}"`;
  ctx.fillText('Quilt', 24, 32);
  ctx.font = `10px "${theme.fontMono}"`;
  ctx.fillStyle = theme.muted;
  const known = quilt.patches.filter((p) => p.known).length;
  ctx.fillText(
    `${String(quilt.distinct)} DISTINCT PATCHES · ${String(known)}/${String(quilt.patches.length)} ASKED · ${String(quilt.stitches)} STITCHES`,
    24,
    53,
  );
  for (const label of box.labels) {
    const size = Math.min(15, box.side * 0.3);
    ctx.fillStyle = theme.text;
    ctx.font = `${String(size)}px "${theme.fontDisplay}"`;
    ctx.fillText(
      fit(ctx, `${label.row.name}${label.continued ? ' ↳' : ''}`, box.label - 12),
      label.x,
      label.y + box.side * 0.43,
    );
    ctx.font = `${String(Math.min(10, box.side * 0.2))}px "${theme.fontMono}"`;
    ctx.fillStyle = theme.muted;
    ctx.fillText(
      `bars ${String(label.from + 1)}–${String(label.to)}`,
      label.x,
      label.y + box.side * 0.43 + 15,
    );
    ctx.fillText(
      `${String(label.row.instruments.length)} rings`,
      label.x,
      label.y + box.side * 0.43 + 29,
    );
  }
  for (const cell of box.cells) {
    const { x, y, patch } = cell;
    ctx.fillStyle = theme.panel;
    ctx.fillRect(x, y, box.side, box.side);
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x + 2, y + 2, Math.max(0.1, box.side - 4), Math.max(0.1, box.side - 4));
    ctx.setLineDash([]);
    if (!patch.known) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, box.side, box.side);
      ctx.clip();
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (let d = -box.side; d < box.side; d += Math.max(3, box.side / 8)) {
        ctx.beginPath();
        ctx.moveTo(x + d, y);
        ctx.lineTo(x + d + box.side, y + box.side);
        ctx.stroke();
      }
      ctx.restore();
    }
    drawStitches(ctx, cell, box.side, frame, colours, patch.to <= now);
  }
  ctx.setLineDash([]);
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.muted;
  ctx.font = `10px "${theme.fontMono}"`;
  const lines =
    width < 700
      ? [
          'COLOUR: SEWN · CHALK: AHEAD · ■: ONSET',
          'DOTTED: CARRIED · TIME ↻ FROM TOP LEFT',
          'HATCH: UNASKED · INNER RINGS >8: TEXTURE',
        ]
      : [
          'COLOUR: SEWN · CHALK: AHEAD · ■: ONSET · DOTTED: CARRIED · TIME ↻ FROM TOP LEFT',
          'HATCH: UNASKED · INNER RINGS ABOVE 8 BLEND TO TEXTURE',
        ];
  lines.forEach((line, i) => {
    ctx.fillText(line, 24, height - box.footer + 17 + i * 14);
  });
}
function drawLive(
  ctx: CanvasRenderingContext2D,
  quilt: Quilt,
  box: QuiltLayout,
  frame: ViewFrame,
  colours: Map<string, string>,
  current: number,
) {
  const { now, theme, width } = frame;
  ctx.font = `11px "${theme.fontMono}"`;
  ctx.fillStyle = theme.accent;
  ctx.textAlign = 'right';
  ctx.fillText(
    `bar ${String(Math.floor(now - quilt.from) + 1)}${quilt.arranged ? ` of ${String(quilt.to - quilt.from)}` : ''} · ${String(Math.round((now - Math.floor(now)) * 100))}%`,
    width - 24,
    30,
  );
  const cell = box.cells.at(current);
  if (current < 0 || !cell) return;
  drawStitches(ctx, cell, box.side, frame, colours, true, clamp(now - cell.patch.bar));
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = Math.max(1.5, Math.min(2.5, box.side * 0.03));
  if (theme.glow) {
    ctx.shadowColor = theme.accent;
    ctx.shadowBlur = 8;
  }
  ctx.beginPath();
  ctx.roundRect(cell.x - 3, cell.y - 3, box.side + 6, box.side + 6, Math.min(6, theme.radius));
  ctx.stroke();
  ctx.shadowBlur = 0;
}
const view: ViewDefinition = {
  id: 'quilt',
  name: 'Quilt',
  group: 'song',
  tag: 'form',
  span: 'song',
  mount(element) {
    const canvas = document.createElement('canvas'),
      backing = document.createElement('canvas');
    const ctx = canvas.getContext('2d'),
      base = backing.getContext('2d');
    if (!ctx || !base) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let quilt: Quilt | undefined,
      box: QuiltLayout | undefined,
      notes: ViewFrame['notes'] | undefined;
    let scoreKey = '',
      paintKey = '',
      colours = new Map<string, string>();
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const nextScore = JSON.stringify([
          quiltRange(frame),
          frame.from,
          frame.to,
          frame.sections,
          frame.instruments.map(({ id, index }) => [id, index]),
        ]);
        const changed = !quilt || notes !== frame.notes || scoreKey !== nextScore;
        if (changed) {
          quilt = indexQuilt(frame);
          notes = frame.notes;
          scoreKey = nextScore;
        }
        if (!quilt) return;
        const current = currentPatch(quilt, frame.now);
        const nextPaint = JSON.stringify([
          frame.width,
          frame.height,
          frame.dpr,
          frame.theme,
          current,
          document.fonts.check(`22px "${frame.theme.fontDisplay}"`),
          document.fonts.check(`10px "${frame.theme.fontMono}"`),
          frame.instruments.map(({ id, colour }) => [id, colour]),
        ]);
        if (changed || paintKey !== nextPaint) {
          box = quiltLayout(quilt, frame.width, frame.height);
          colours = new Map(frame.instruments.map((i) => [i.id, i.colour]));
          canvas.width = backing.width = Math.max(1, Math.round(frame.width * frame.dpr));
          canvas.height = backing.height = Math.max(1, Math.round(frame.height * frame.dpr));
          canvas.style.width = `${String(frame.width)}px`;
          canvas.style.height = `${String(frame.height)}px`;
          base.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
          drawBase(base, quilt, box, frame, colours);
          paintKey = nextPaint;
        }
        if (!box) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(backing, 0, 0);
        ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
        drawLive(ctx, quilt, box, frame, colours, current);
      },
      dispose() {
        canvas.remove();
        canvas.width = backing.width = 0;
        canvas.height = backing.height = 0;
        quilt = undefined;
        box = undefined;
        notes = undefined;
        colours.clear();
      },
    };
  },
};
export default view;
