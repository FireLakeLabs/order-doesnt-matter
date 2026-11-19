/** Afterglow draws scored outlines purely from the current score and now.
 * Exception: measured FFT snapshots cannot be reconstructed at arbitrary now.
 * HeardColumns stores the first actual measurement in each 1/64-cycle cell
 * (4096 cells max, FIFO), keyed by score time, cleared on program changes via
 * the host's per-document settings-array identity. Missing cells are hatched,
 * never interpolated. Revisited cells retain the earlier pass, labelled “heard
 * then”. Future cells are hidden even if previously heard. No clock, inferred
 * tails, per-part audio attribution or simulated audio is kept here. Remounting
 * starts a new observation session. Audio comes through the same tap as Scope.
 */
import type { ViewDefinition } from './types';
import type { Column } from './afterglow/model';
import {
  BANDS,
  COLUMNS_PER_CYCLE,
  HeardColumns,
  heatRamp,
  layout,
  level,
  noteGeometry,
  scoredNotes,
  timeRange,
  frequencyPosition,
} from './afterglow/model';

const view: ViewDefinition = {
  id: 'afterglow',
  group: 'pitch',
  name: 'Afterglow',
  tag: 'heard vs scored',
  needs: 'audio',
  mount(element) {
    const canvas = document.createElement('canvas');
    canvas.dataset.afterglow = '';
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    element.append(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.remove();
      throw Error('Afterglow needs Canvas 2D');
    }
    const heard = new HeardColumns();
    let paletteKey = '',
      ramp: string[] = [];
    let tiles = new WeakMap<Column, HTMLCanvasElement>();
    return {
      frame(frame) {
        const { width, height, dpr, theme, now } = frame;
        if (width <= 0 || height <= 0) return;
        heard.observe(frame);
        if (
          canvas.width !== Math.round(width * dpr) ||
          canvas.height !== Math.round(height * dpr)
        ) {
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
        }
        ctx.reset();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = theme.ground;
        ctx.fillRect(0, 0, width, height);
        const box = layout(width, height),
          range = timeRange(frame);
        const x = (t: number) =>
          box.left + ((t - range.from) / (range.to - range.from)) * (box.right - box.left);
        const nx = x(now),
          plotWidth = box.right - box.left,
          plotHeight = box.bottom - box.top;
        const key = JSON.stringify(theme);
        if (key !== paletteKey) {
          paletteKey = key;
          ramp = heatRamp(theme);
          tiles = new WeakMap();
        }
        ctx.fillStyle = theme.panel;
        ctx.fillRect(box.left, box.top, plotWidth, plotHeight);
        // Unheard past only: a visible hatch, replaced solely by observed cells.
        ctx.save();
        ctx.beginPath();
        ctx.rect(box.left, box.top, nx - box.left, plotHeight);
        ctx.clip();
        ctx.strokeStyle = theme.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let p = -plotHeight; p < plotWidth; p += 10) {
          ctx.moveTo(box.left + p, box.bottom);
          ctx.lineTo(box.left + p + plotHeight, box.top);
        }
        ctx.stroke();
        ctx.restore();
        let visibleColumns = 0;
        for (const [cell, column] of heard.columns) {
          const start = cell / COLUMNS_PER_CYCLE,
            end = (cell + 1) / COLUMNS_PER_CYCLE;
          if (column.time > now || end <= range.from || start >= now) continue;
          visibleColumns++;
          const left = Math.max(box.left, x(start)),
            right = Math.min(nx, x(end));
          let tile = tiles.get(column);
          if (!tile) {
            tile = document.createElement('canvas');
            tile.width = 1;
            tile.height = BANDS;
            const paint = tile.getContext('2d');
            if (!paint) throw Error('Afterglow needs Canvas 2D');
            for (let band = 0; band < BANDS; band++) {
              paint.fillStyle = ramp[Math.round(level(column.bands[band]) * 255)];
              paint.fillRect(0, BANDS - band - 1, 1, 1);
            }
            tiles.set(column, tile);
          }
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(tile, left, box.top, right - left, plotHeight);
        }
        // Axis grid, then the independently scored layer. No score heat fills.
        ctx.strokeStyle = theme.line;
        ctx.lineWidth = 0.5;
        for (const hz of [30, 100, 300, 1000, 3000, 10000]) {
          const y = box.bottom - frequencyPosition(hz) * plotHeight;
          ctx.beginPath();
          ctx.moveTo(box.left, y);
          ctx.lineTo(box.right, y);
          ctx.stroke();
        }
        ctx.fillStyle = theme.panel;
        ctx.fillRect(box.left, box.floor, plotWidth, box.floorHeight);
        const notes = scoredNotes(frame);
        const marks = new Map<string, { rect: ReturnType<typeof noteGeometry>; colour: string }>();
        for (const { note, hz } of notes) {
          const rect = noteGeometry(note, hz, frame);
          const colour =
            frame.instruments.find((i) => i.id === note.instrument)?.colour ?? theme.text;
          // Coincident raster marks are merged and counted, never discarded.
          const key = JSON.stringify([note.instrument, rect.x, rect.end, rect.y]);
          if (!marks.has(key)) marks.set(key, { rect, colour });
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(box.left, box.top, plotWidth, box.floor + box.floorHeight - box.top);
        ctx.clip();
        for (const { rect, colour } of marks.values()) {
          for (const future of [false, true]) {
            const left = future ? Math.max(nx, rect.x) : rect.x;
            const right = future ? rect.end : Math.min(nx, rect.end);
            if (right <= left) continue;
            ctx.setLineDash(future ? [4, 3] : []);
            // A dark keyline keeps pale instrument colours readable in light themes.
            ctx.strokeStyle = ramp[0];
            ctx.lineWidth = 4;
            ctx.strokeRect(left, rect.y, right - left, rect.height);
            ctx.strokeStyle = colour;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(left, rect.y, right - left, rect.height);
          }
        }
        ctx.restore();
        ctx.setLineDash([]);
        ctx.strokeStyle = theme.text;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(nx, box.top);
        ctx.lineTo(nx, box.floor + box.floorHeight);
        ctx.stroke();
        // All text is last, on the opaque ground or its own opaque plate.
        ctx.fillStyle = theme.text;
        ctx.textAlign = 'left';
        ctx.font = `22px "${theme.fontDisplay}"`;
        ctx.fillText('Afterglow', 18, 29);
        ctx.font = `11px "${theme.fontMono}"`;
        const previous = visibleColumns > 0 && now < heard.latest;
        ctx.fillText(
          !frame.playing
            ? 'PAUSED · no audio flowing'
            : !frame.audio
              ? 'No audio flowing · waiting for output'
              : 'LIVE · measured master output',
          18,
          50,
        );
        ctx.fillText(
          previous ? 'EARLIER PASS · heard then' : 'Heat = measured · outlines = scored',
          18,
          69,
        );
        ctx.textAlign = 'right';
        for (const hz of [30, 100, 300, 1000, 3000, 10000]) {
          const y = box.bottom - frequencyPosition(hz) * plotHeight;
          ctx.fillText(hz >= 1000 ? `${String(hz / 1000)}k` : String(hz), box.left - 8, y + 4);
        }
        ctx.fillText('Hz', box.left - 8, box.top + 5);
        ctx.fillText('floor', box.left - 8, box.floor + 22);
        ctx.textAlign = 'left';
        const plate = (text: string, left: number, top: number) => {
          ctx.fillStyle = theme.ground;
          ctx.fillRect(left - 4, top - 12, ctx.measureText(text).width + 8, 18);
          ctx.fillStyle = theme.text;
          ctx.fillText(text, left, top);
        };
        plate('now', nx + 5, box.top + 15);
        if (!visibleColumns) plate('NOT HEARD · hatch', box.left + 12, box.top + 35);
        // Future area is deliberately empty, including on a backwards seek.
        if (plotWidth * 0.25 > 100) plate('score only', nx + 10, box.top + plotHeight / 2);
        ctx.fillStyle = theme.text;
        const footer = box.floor + box.floorHeight + 20;
        const merged = notes.length - marks.size;
        const offscale = notes.filter(
          ({ hz }) => hz !== undefined && (hz < 20 || hz > 20000),
        ).length;
        ctx.fillText(
          `SCORED · ${String(notes.length)} spans · ${String(notes.filter((n) => n.hz === undefined).length)} unpitched${merged ? ` · ${String(merged)} merged` : ''}${offscale ? ` · ${String(offscale)} at edge` : ''}`,
          box.left,
          footer,
        );
        ctx.fillText(
          `MEASURED · ${String(visibleColumns)} snapshots · hatch = not heard`,
          box.left,
          footer + 38,
        );
        const gradient = ctx.createLinearGradient(box.left, 0, box.left + 110, 0);
        for (let i = 0; i <= 10; i++)
          gradient.addColorStop(i / 10, ramp[Math.round((i / 10) * 255)]);
        ctx.fillStyle = gradient;
        ctx.fillRect(box.left, footer + 11, 110, 9);
        ctx.fillStyle = theme.text;
        ctx.fillText('−90 → −30 dBFS · mixed output', box.left + 120, footer + 20);
        ctx.textAlign = 'right';
        ctx.fillText(
          `bar ${String(Math.floor(now) + 1)} · ${String(Math.round((now - Math.floor(now)) * 100))}%`,
          box.right,
          29,
        );
      },
      dispose() {
        heard.clear();
        tiles = new WeakMap();
        ramp = [];
        canvas.remove();
        canvas.width = canvas.height = 0;
      },
    };
  },
};
export default view;
