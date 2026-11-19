import type { ViewDefinition, ViewFrame } from './types';
import {
  padLayout,
  padState,
  sampleCursor,
  samplePads,
  waveformPeaks,
  type Pad,
} from './sampler/model';

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function text(
  ctx: CanvasRenderingContext2D,
  frame: ViewFrame,
  value: string,
  x: number,
  y: number,
  width: number,
  size = 11,
) {
  ctx.font = `${String(size)}px "${frame.theme.fontMono}"`;
  ctx.fillStyle = frame.theme.text;
  ctx.fillText(fit(ctx, value, width), x, y);
}
/** Snap source markers to physical pixels. Fractional antialiased strokes can
 * round a colour channel differently on Chromium's first raster and a replay,
 * even with identical draw commands and a fully reset context. */
function marker(
  ctx: CanvasRenderingContext2D,
  frame: ViewFrame,
  x: number,
  y: number,
  height: number,
  width = 1,
  dashed = false,
) {
  const snap = (value: number) => Math.round(value * frame.dpr) / frame.dpr;
  const left = snap(x),
    top = snap(y),
    bottom = snap(y + height);
  const thickness = Math.max(1, Math.round(width * frame.dpr)) / frame.dpr;
  const step = dashed ? Math.max(1, Math.round(6 * frame.dpr)) / frame.dpr : bottom - top;
  if (step <= 0) return;
  for (let yy = top; yy < bottom; yy += step)
    ctx.fillRect(left, yy, thickness, Math.min(dashed ? snap(3) : step, bottom - yy));
}
function shell(
  ctx: CanvasRenderingContext2D,
  frame: ViewFrame,
  x: number,
  y: number,
  w: number,
  h: number,
  pad: Pad,
) {
  const state = padState(pad, frame),
    colour = pad.parts[0].colour;
  ctx.fillStyle = frame.theme.panel;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, frame.theme.radius);
  ctx.fill();
  // The onset light is outside the text/screen plates; labels always sit on panel.
  ctx.strokeStyle = state.light > 0.02 ? colour : frame.theme.line;
  ctx.lineWidth = 1 + 3 * state.light;
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.globalAlpha = state.resting ? 0.25 : 0.3 + 0.7 * state.light;
  ctx.fillRect(x + 12, y + 10, 5, h - 20);
  ctx.globalAlpha = 1;
  return state;
}
function drawPad(
  ctx: CanvasRenderingContext2D,
  frame: ViewFrame,
  pad: Pad,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const state = shell(ctx, frame, x, y, w, h, pad);
  const sx = x + 24,
    sy = y + 54,
    sw = w - 38,
    sh = Math.max(20, h - 100);
  const result = pad.result;
  ctx.fillStyle = frame.theme.ground;
  ctx.fillRect(sx, sy, sw, sh);
  let status = state.resting
    ? 'other sections · resting'
    : state.latest
      ? 'ended'
      : 'waiting for onset';
  let settings = '',
    file = '';
  if (result.status === 'buffer') {
    const representative = state.latest ?? pad.notes.find((n) => n.hasOnset) ?? pad.notes.at(0);
    const slice = representative && sampleCursor(representative, result, frame.now, frame.cps);
    const peaks = waveformPeaks(result, Math.min(512, sw));
    ctx.strokeStyle = pad.parts[0].colour;
    ctx.lineWidth = 1;
    ctx.globalAlpha = state.resting ? 0.45 : 0.85;
    ctx.beginPath();
    for (let i = 0; i < peaks.columns; i++) {
      const px = sx + ((i + 0.5) / peaks.columns) * sw;
      ctx.moveTo(px, sy + sh / 2 - peaks.max[i] * (sh / 2 - 4));
      ctx.lineTo(px, sy + sh / 2 - peaks.min[i] * (sh / 2 - 4) + 0.5);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (slice) {
      const regions = state.active.length ? state.active : [slice];
      const bounds = [...new Set([0, 1, ...regions.flatMap((c) => [c.begin, c.end])])].sort(
        (a, b) => a - b,
      );
      ctx.fillStyle = frame.theme.panel;
      ctx.globalAlpha = 0.8;
      for (let i = 0; i < bounds.length - 1; i++) {
        const middle = (bounds[i] + bounds[i + 1]) / 2;
        if (!regions.some((c) => c.begin <= middle && c.end >= middle))
          ctx.fillRect(sx + sw * bounds[i], sy, sw * (bounds[i + 1] - bounds[i]), sh);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = frame.theme.text;
      for (const boundary of new Set(regions.flatMap((c) => [c.begin, c.end])))
        marker(ctx, frame, sx + sw * boundary, sy, sh, 1, true);
      const bins = new Map<number, number>();
      for (const cursor of state.active) {
        // Coincident/dense retriggers share a pixel column, retaining their count.
        const column = Math.round(cursor.position * (sw - 1));
        bins.set(column, (bins.get(column) ?? 0) + 1);
      }
      for (const [column, count] of bins)
        marker(ctx, frame, sx + column, sy, sh, Math.min(4, count));
      if (!state.active.length && state.latest && !slice.limited && !state.resting)
        marker(ctx, frame, sx + sw * slice.position, sy, sh);
      settings = `${slice.begin.toFixed(2)}–${slice.end.toFixed(2)} · ×${String(slice.speed)} ${slice.speed < 0 ? '←' : '→'}${representative.value.unit === 'c' ? ' unit c' : ''}`;
      if (!state.resting) {
        const unknown = state.cursors.filter((c) => c.limited).length;
        if (state.active.length) {
          const newest = state.active.reduce((a, b) => (a.note.start > b.note.start ? a : b));
          status = `${String(state.active.length)} cursor${state.active.length === 1 ? '' : 's'} · ${String(Math.round(newest.fraction * 100))}% slice`;
          if (unknown) status += ` · ${String(unknown)} unknown`;
        } else if (unknown) status = `${String(unknown)} onsets · cursor unavailable`;
        else if (slice.speed === 0) status = 'speed 0 · no trigger';
        else status = state.latest ? 'ended' : 'waiting for onset';
      }
    } else settings = 'slice bounds not in this window';
    file = `${result.duration.toFixed(3)}s · ${result.fileName}`;
  } else {
    status = result.status === 'loading' ? 'loading / not decoded yet' : 'unavailable';
    settings = state.resting ? 'other sections · resting' : 'no decoded sample';
    file = result.status === 'unavailable' ? result.reason : 'Sample has not been decoded';
    text(
      ctx,
      frame,
      result.status === 'loading' ? 'LOADING' : 'UNAVAILABLE',
      sx + 10,
      sy + sh / 2 + 4,
      sw - 20,
    );
  }
  // Text last, in dedicated bands clear of all waveform/cursor movement.
  text(
    ctx,
    frame,
    `${pad.sound || 'no sound'}:${String(pad.index)}`,
    sx,
    y + 25,
    (w - 40) * 0.48,
    16,
  );
  text(
    ctx,
    frame,
    pad.parts.map((p) => p.name).join(' / '),
    sx + (w - 40) * 0.5,
    y + 25,
    (w - 40) * 0.5,
  );
  text(ctx, frame, status, sx, y + 44, w - 40);
  text(ctx, frame, settings, sx, y + h - 30, w - 40);
  text(ctx, frame, file, sx, y + h - 12, w - 40);
}
function drawSynth(
  ctx: CanvasRenderingContext2D,
  frame: ViewFrame,
  pad: Pad,
  x: number,
  y: number,
  w: number,
  h = 80,
) {
  const state = shell(ctx, frame, x, y, w, h, pad);
  const onsets = pad.notes.filter((n) => n.hasOnset).length;
  const large = h > 140;
  const x0 = large ? x + 24 : x + w - 68,
    y0 = large ? y + h / 2 : y + 33,
    span = large ? w - 48 : 48,
    amplitude = large ? Math.max(10, (h - 140) / 2) : 9;
  ctx.strokeStyle = pad.parts[0].colour;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const t = i / 24;
    const v =
      pad.sound === 'sine'
        ? Math.sin(t * Math.PI * 2)
        : pad.sound === 'triangle'
          ? 1 - 4 * Math.abs((t % 1) - 0.5)
          : pad.sound === 'square'
            ? t % 1 < 0.5
              ? 1
              : -1
            : pad.sound === 'sawtooth' || pad.sound === 'supersaw'
              ? (t % 1) * 2 - 1
              : 0;
    if (!i) ctx.moveTo(x0 + (i / 48) * span, y0 - v * amplitude);
    else ctx.lineTo(x0 + (i / 48) * span, y0 - v * amplitude);
  }
  ctx.stroke();
  text(ctx, frame, pad.sound, x + 24, y + 25, w - 100, 14);
  text(ctx, frame, pad.parts.map((p) => p.name).join(' / '), x + 24, y + 42, w - 100);
  text(ctx, frame, 'synth, no sample', x + 24, y + h - 20, w - 40);
  text(
    ctx,
    frame,
    state.resting ? `${String(onsets)} onsets · resting` : `${String(onsets)} onsets in window`,
    x + 24,
    y + h - 5,
    w - 40,
  );
}
function draw(ctx: CanvasRenderingContext2D, frame: ViewFrame) {
  const pads = samplePads(frame);
  const samples = pads.filter((p) => p.result.status !== 'synth');
  const synths = pads.filter((p) => p.result.status === 'synth');
  const synthOnly = !samples.length && synths.length > 0;
  const box = padLayout(
    synthOnly ? synths.length : samples.length,
    frame.width,
    frame.height,
    synthOnly ? 0 : synths.length,
  );
  const outside = frame.instruments.filter(
    (part) => !pads.some((p) => p.parts.some((member) => member.id === part.id)),
  ).length;
  ctx.fillStyle = frame.theme.ground;
  ctx.fillRect(0, 0, frame.width, frame.height);
  text(ctx, frame, 'SAMPLER · SAMPLE MEMORY', 18, 22, frame.width - 36, 18);
  text(
    ctx,
    frame,
    `${String(samples.length)} pad${samples.length === 1 ? '' : 's'} · ${String(synths.length)} synth${synths.length === 1 ? '' : 's'}${outside ? ` · ${String(outside)} part${outside === 1 ? '' : 's'} outside window` : ''}`,
    18,
    41,
    frame.width - 36,
  );
  const overflow = (items: Pad[], capacity: number) =>
    items.length > capacity ? capacity - 1 : items.length;
  const grid = synthOnly ? synths : samples;
  const shown = overflow(grid, box.capacity);
  grid.slice(0, shown).forEach((pad, i) => {
    const x = 18 + (i % box.columns) * (box.width + 12),
      y = 48 + Math.floor(i / box.columns) * (box.height + 12);
    if (synthOnly) drawSynth(ctx, frame, pad, x, y, box.width, box.height);
    else drawPad(ctx, frame, pad, x, y, box.width, box.height);
  });
  const summary = (
    items: Pad[],
    from: number,
    columns: number,
    width: number,
    y: number,
    height: number,
  ) => {
    if (from >= items.length) return;
    const x = 18 + (from % columns) * (width + 12),
      top = y + Math.floor(from / columns) * (height + 12);
    ctx.fillStyle = frame.theme.panel;
    ctx.fillRect(x, top, width, height);
    text(ctx, frame, `+${String(items.length - from)} addresses`, x + 14, top + 28, width - 28, 16);
    const cursors = items.slice(from).reduce((sum, p) => sum + padState(p, frame).active.length, 0);
    text(
      ctx,
      frame,
      `${String(cursors)} cursors · ${String(items.slice(from).reduce((sum, p) => sum + p.notes.filter((n) => n.hasOnset).length, 0))} onsets`,
      x + 14,
      top + 50,
      width - 28,
    );
    text(ctx, frame, 'merged · stage space limit', x + 14, top + 70, width - 28);
  };
  summary(grid, shown, box.columns, box.width, 48, box.height);
  if (synths.length && !synthOnly) {
    text(ctx, frame, 'OSCILLATORS · SHAPE SYMBOLS', 18, box.synthY + 14, frame.width - 36);
    const shownSynths = overflow(synths, box.synthCapacity);
    synths.slice(0, shownSynths).forEach((pad, i) => {
      drawSynth(
        ctx,
        frame,
        pad,
        18 + (i % box.synthColumns) * (box.synthWidth + 12),
        box.synthY + 28 + Math.floor(i / box.synthColumns) * 92,
        box.synthWidth,
      );
    });
    summary(synths, shownSynths, box.synthColumns, box.synthWidth, box.synthY + 28, 80);
  }
  text(
    ctx,
    frame,
    'LIGHT = ONSET AGE · CURSORS = SAMPLE POSITION',
    18,
    frame.height - 12,
    frame.width - 36,
  );
}
const view: ViewDefinition = {
  id: 'sampler',
  name: 'Sampler',
  group: 'settings',
  tag: 'sample memory',
  needs: 'score',
  span: 'window',
  samples: true,
  mount(element) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const width = Math.max(1, Math.round(frame.width * frame.dpr)),
          height = Math.max(1, Math.round(frame.height * frame.dpr));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        canvas.style.width = `${String(frame.width)}px`;
        canvas.style.height = `${String(frame.height)}px`;
        ctx.reset();
        ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
        draw(ctx, frame);
      },
      dispose() {
        canvas.remove();
        canvas.width = canvas.height = 0;
      },
    };
  },
};
export default view;
