import type { ViewDefinition, ViewFrame } from './types';
import { line, mount2d } from './shared/retro-2d';
import { clamp } from './shared/math';
import { star } from './shared/particles';
import {
  analyse,
  comparison,
  layout,
  strip,
  differenceLabel,
  lanes,
  voiceCount,
} from './deja-vu/model';
import type { Entry, Score, Slice } from './deja-vu/model';

function fit(c: CanvasRenderingContext2D, text: string, width: number) {
  if (c.measureText(text).width <= width) return text;
  while (text.length && c.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function hatch(c: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  c.save();
  c.beginPath();
  c.rect(x, y, width, height);
  c.clip();
  for (let k = -height; k < width; k += 7) line(c, x + k, y + height, x + k + height, y);
  c.restore();
}
function noteInk(colour: string, f: ViewFrame) {
  const luminance = (hex: string) => {
    const value = Number.parseInt(hex.slice(1), 16);
    const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
      const n = channel / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const background = luminance(colour);
  const contrast = (ink: string) => {
    const light = luminance(ink);
    return (Math.max(background, light) + 0.05) / (Math.min(background, light) + 0.05);
  };
  return contrast(f.theme.text) > contrast(f.theme.ground) ? f.theme.text : f.theme.ground;
}
function draw(c: CanvasRenderingContext2D, f: ViewFrame, score: Score) {
  const view = comparison(f, score),
    rows = view.rows.filter((r) => r.entries.length),
    rest = view.rows.length - rows.length;
  const g = layout(f, rows.length),
    t = f.theme,
    width = g.right - g.left,
    phase = f.now - Math.floor(f.now);
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  c.fillStyle = t.text;
  c.font = `600 ${String(Math.max(24, 24 * g.scale))}px "${t.fontDisplay}"`;
  c.fillText('Déjà vu', 24 * g.scale, Math.max(29, 32 * g.scale));
  c.font = `${String(g.font)}px "${t.fontMono}"`;
  c.fillStyle = t.muted;
  c.textAlign = 'right';
  c.fillText(
    `bar ${String(view.bar + 1)} over ${String(view.bar)}`,
    g.right,
    Math.max(29, 32 * g.scale),
  );
  c.textAlign = 'left';
  const cells = strip(f, score),
    cellWidth = width / cells.length;
  c.fillText('change', Math.max(14, 24 * g.scale), g.stripTop + g.stripHeight / 2);
  for (const [i, cell] of cells.entries()) {
    const x = g.left + i * cellWidth,
      w = Math.max(1, cellWidth - 3);
    c.fillStyle = t.panel;
    c.fillRect(x, g.stripTop, w, g.stripHeight);
    if (cell.change === undefined) {
      c.strokeStyle = t.muted;
      c.globalAlpha = 0.65;
      hatch(c, x, g.stripTop, w, g.stripHeight);
    } else {
      c.globalAlpha = 0.06 + 0.94 * cell.change;
      c.fillStyle = t.accent;
      c.fillRect(x, g.stripTop, w, g.stripHeight);
    }
    c.globalAlpha = 1;
    if (cell.bar === view.bar) {
      c.strokeStyle = t.text;
      c.lineWidth = 2;
      c.strokeRect(x - 1, g.stripTop - 2, w + 2, g.stripHeight + 4);
      c.lineWidth = 1;
    }
  }
  const length = f.sections.at(-1)?.to ?? 16;
  c.fillStyle = t.muted;
  for (const [i, section] of f.sections.entries()) {
    const x = g.left + (section.from / length) * width,
      end = g.left + ((f.sections[i + 1]?.from ?? length) / length) * width;
    c.fillText(fit(c, section.name, end - x - 5), x, g.stripTop + g.stripHeight + 16);
  }
  c.strokeStyle = t.line;
  line(c, g.left, g.top - 9, g.right, g.top - 9);
  c.strokeStyle = t.text;
  c.globalAlpha = 0.3;
  line(c, g.left + phase * width, g.top, g.left + phase * width, g.bottom);
  c.globalAlpha = 1;
  if (!rows.length) {
    c.fillStyle = t.muted;
    c.textAlign = 'center';
    c.fillText(
      view.known ? 'Both bars are resting' : 'This bar has not been asked about',
      (g.left + g.right) / 2,
      (g.top + g.bottom) / 2,
    );
    c.textAlign = 'left';
  }
  for (const [index, row] of rows.entries()) {
    const y = g.top + (index + 0.5) * g.rowHeight,
      colour = row.instrument.colour;
    c.font = `${String(g.font)}px "${t.fontMono}"`;
    c.fillStyle = colour;
    c.beginPath();
    c.arc(Math.max(16, 24 * g.scale), y, Math.max(3, 4 * g.scale), 0, Math.PI * 2);
    c.fill();
    c.fillStyle = t.text;
    c.fillText(
      fit(c, row.instrument.name, g.left - Math.max(38, 42 * g.scale) - 8),
      Math.max(27, 36 * g.scale),
      y,
    );
    c.strokeStyle = t.line;
    line(c, g.left, y, g.right, y);
    const simultaneous = voiceCount(row.entries);
    const annotationFont = Math.max(12, g.font * 0.85);
    c.font = `${String(annotationFont)}px "${t.fontMono}"`;
    const annotations = (e: Entry) => {
      const w = Math.max(1, (e.slice.end - e.slice.start) * width - 6 * g.scale - 8);
      const labels = e.differences.map(differenceLabel);
      const full = labels
        .map((d) => `${d.key === 'pitch' ? '' : `${d.key} `}${d.before} → ${d.after}`)
        .join(' · ');
      if (c.measureText(full).width <= w) return [full];
      return labels.flatMap((d) =>
        c.measureText(`${d.before}→${d.after}`).width <= w
          ? [`${d.before}→${d.after}`]
          : [`${d.before}→`, d.after],
      );
    };
    const annotationHeight = Math.max(
      0,
      ...row.entries
        .filter((e) => e.kind === 'changed')
        .map((e) => annotations(e).length * annotationFont + 4),
    );
    // Crowds retain every solid/ghost span and exact counts, while value text becomes a density band.
    const dense =
      row.entries.length > width / 20 ||
      g.rowHeight < 30 ||
      simultaneous > 4 ||
      annotationHeight > (g.rowHeight * 0.55) / simultaneous;
    const voices = dense ? 1 : simultaneous;
    const positions = lanes(row.entries);
    const pitchChanged = row.entries.some((e) => e.differences.some((d) => d.key === 'pitch'));
    const height = dense
      ? g.noteHeight
      : Math.max((g.noteHeight * (pitchChanged ? 0.75 : 1)) / voices, annotationHeight);
    const yy = (s: Slice) =>
      y + (voices > 1 ? ((positions.get(s) ?? 0) - (voices - 1) / 2) * height : 0);
    if (g.rowHeight >= 40) {
      const keys = [...new Set(row.entries.flatMap((e) => e.differences.map((d) => d.key)))];
      const fresh = row.entries.filter((e) => e.kind === 'new').length,
        gone = row.entries.filter((e) => e.kind === 'vanished').length;
      const status =
        fresh || gone
          ? `+${String(fresh)} −${String(gone)}`
          : keys.join(' · ') || (view.known ? 'same' : 'unasked');
      c.font = `12px "${t.fontMono}"`;
      c.fillStyle = keys.length || fresh || gone ? t.accent : t.muted;
      c.fillText(
        fit(c, status, g.left - Math.max(38, 42 * g.scale) - 8),
        Math.max(27, 36 * g.scale),
        y + 18,
      );
    }
    const box = (s: Slice, ghost: boolean, changed: boolean) => {
      const x = g.left + s.start * width,
        w = Math.max(
          1,
          (s.end - s.start) * width - Math.min(6 * g.scale, (s.end - s.start) * width * 0.12),
        );
      const offset =
        changed && !dense && voices === 1 ? (ghost ? height * 0.25 : -height * 0.18) : 0;
      const top = yy(s) - height / 2 + offset;
      c.globalAlpha = row.instrument.muted ? 0.3 : 1;
      if (ghost) {
        c.strokeStyle = colour;
        c.lineWidth = Math.max(1.5, g.scale);
        c.setLineDash([4 * g.scale + 1, 3 * g.scale + 1]);
        c.strokeRect(x, top, w, height);
        c.setLineDash([]);
        c.lineWidth = 1;
      } else {
        c.fillStyle = colour;
        c.globalAlpha *= 0.82;
        c.fillRect(x, top, w, height);
      }
      c.globalAlpha = 1;
      return { x, top, w };
    };
    for (const e of row.entries) if (e.after) box(e.after, false, e.kind === 'changed');
    for (const e of row.entries) if (e.before) box(e.before, true, e.kind === 'changed');
    for (const e of row.entries) {
      const s = e.slice;
      const x = g.left + s.start * width,
        w = Math.max(1, (s.end - s.start) * width - 6 * g.scale);
      if (e.kind === 'new') {
        const seed =
          Math.round((view.bar + s.start) * 100003) +
          (s.pitch ?? 0) * 101 +
          row.instrument.index * 991;
        for (let j = 0; j < 4; j++) {
          const p = star(seed + j * 71, f.now, { x: 0, y: 0, alpha: 0 }),
            sx = x + p.x * Math.max(8, w),
            sy = dense
              ? y - height / 2 + 2 + p.y * Math.max(0, height - 4)
              : yy(s) - height / 2 - 4 - p.y * 9;
          c.strokeStyle = t.accent;
          c.globalAlpha = p.alpha;
          line(c, sx - 3, sy, sx + 3, sy);
          line(c, sx, sy - 3, sx, sy + 3);
        }
        c.globalAlpha = 1;
      }
      if (e.kind === 'changed') {
        c.fillStyle = t.accent;
        c.fillRect(
          x + Math.min(w / 2, 8),
          dense ? y + height / 2 - Math.min(9, g.rowHeight * 0.16) : yy(s) + height / 2 + 3,
          Math.min(5, w),
          Math.min(9, g.rowHeight * 0.16),
        );
        if (!dense) {
          c.font = `${String(annotationFont)}px "${t.fontMono}"`;
          const lines = annotations(e);
          c.fillStyle = noteInk(colour, f);
          for (const [i, text] of lines.entries())
            c.fillText(
              fit(c, text, w - 4),
              x + 2,
              yy(s) - height * 0.18 + (i - (lines.length - 1) / 2) * annotationFont,
            );
        }
      }
    }
    if (dense) {
      c.font = `12px "${t.fontMono}"`;
      const caption = `${String(row.entries.length)} ${row.entries.length === 1 ? 'note' : 'notes'}`;
      const captionWidth = c.measureText(caption).width + 8;
      c.fillStyle = t.panel;
      c.fillRect(g.right - captionWidth, y - 8, captionWidth, 16);
      c.fillStyle = t.text;
      c.textAlign = 'right';
      c.fillText(caption, g.right - 4, y);
      c.textAlign = 'left';
    }
  }
  c.globalAlpha = 1;
  c.font = `${String(g.font)}px "${t.fontMono}"`;
  const footerY = f.height - Math.max(23, 24 * g.scale),
    legendY = footerY - 21;
  c.fillStyle = t.muted;
  c.fillText(
    `solid ${String(view.bar + 1)} · dashed ${String(view.bar)}${rest ? ` · ${String(rest)} resting` : ''}`,
    g.left,
    legendY,
  );
  c.fillStyle = t.text;
  const counts = view.counts;
  const summary = view.known
    ? `${String(counts.new)} new · ${String(counts.vanished)} vanished · ${String(counts.changed)} changed`
    : 'Previous bar unasked — comparison unavailable';
  c.fillText(fit(c, summary, g.right - g.left), g.left, footerY);
  c.fillStyle = t.accent;
  c.textAlign = 'right';
  if (f.width > 700)
    c.fillText(
      view.change === undefined
        ? 'hatched = unasked'
        : `${String(Math.round(clamp(view.change) * 100))}% change`,
      g.right,
      legendY,
    );
  c.textAlign = 'left';
}
export default {
  id: 'deja-vu',
  group: 'rhythm',
  name: 'Déjà vu',
  tag: 'what changed',
  span: 'song',
  mount(element) {
    return mount2d(element, analyse, draw);
  },
} satisfies ViewDefinition;
