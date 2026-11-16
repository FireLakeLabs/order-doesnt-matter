import type { SheetModel } from '../../sheet/model';
import type { EventResult } from '../../contract';
import type { ViewTheme } from '../../views/types';
import { instrumentColour } from '../themes';
import { noteRects, settingLaneId, timeX, type LaneRow } from './model';

/** Cache the static score in an unattached surface. The shared frame only copies
 * it and paints the playhead, regardless of note density. One canvas is in the DOM. */
export function drawScore(
  ctx: CanvasRenderingContext2D,
  lanes: LaneRow[],
  model: SheetModel,
  events: Record<string, EventResult>,
  width: number,
  height: number,
  theme: ViewTheme,
  selected: string | null,
) {
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  for (const lane of lanes) {
    const colour = instrumentColour(
      theme.name,
      model.rows.findIndex((r) => r.id === lane.row.id),
    );
    if (lane.row.id === selected) {
      ctx.fillStyle = theme.panel;
      ctx.fillRect(0, lane.y, width, lane.height);
    }
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, lane.y + lane.height - 0.5);
    ctx.lineTo(width, lane.y + lane.height - 0.5);
    ctx.stroke();
    if (lane.setting) {
      const cell = lane.row.cells.find((c) => settingLaneId(lane.row.id, c) === lane.setting);
      if (cell?.marks.length) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        cell.marks.forEach((mark, i) => {
          const x = (mark.x / 100) * width,
            y = lane.y + (mark.y / 35) * lane.height;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          if (!mark.signal) ctx.lineTo(x + (mark.width / 100) * width, y);
        });
        ctx.stroke();
      }
      continue;
    }
    ctx.fillStyle = colour;
    for (const note of noteRects(events[lane.row.id], lane, model.fromCycle, model.toCycle, width))
      ctx.fillRect(note.x, note.y, note.width, note.height);
    if (lane.row.broken || !Object.hasOwn(events, lane.row.id)) {
      ctx.fillStyle = theme.muted;
      ctx.font = `11px "${theme.fontMono}"`;
      ctx.fillText(
        lane.row.broken ? `Broken: ${lane.row.broken}` : 'Asking the score…',
        12,
        lane.y + Math.min(lane.height - 2, 22),
      );
    }
  }
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  for (let cycle = Math.ceil(model.fromCycle); cycle < model.toCycle; cycle++) {
    const x = timeX(cycle, model.fromCycle, model.toCycle, width) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}
