import type { ViewDefinition, ViewFrame } from './types';
import { mount2d } from './shared/retro-2d';
import { analyse, at, className, fifths, position, spelling } from './chord-star/model';
import type { Chord } from './chord-star/model';
import { layout } from './chord-star/layout';

function draw(c: CanvasRenderingContext2D, f: ViewFrame, score: ReturnType<typeof analyse>) {
  const { width: w, height: h, theme } = f;
  const state = at(f, score);
  const { wide, r, cx, cy, scale, dot, bass, rootFont, labelFont, labelRadius, chartHeight } =
    layout(f);
  const margin = Math.max(16, w * 0.025);
  const legend = f.instruments.filter((i) => score.pitched.has(i.id) || score.unpitched.has(i.id));
  const xy = (pc: number, radius = r) => [
    cx + Math.cos(position(pc)) * radius,
    cy + Math.sin(position(pc)) * radius,
  ];
  const text = (
    label: string,
    x: number,
    y: number,
    size: number,
    colour = theme.muted,
    max = w,
  ) => {
    c.fillStyle = colour;
    c.font = `${String(size)}px "${theme.fontMono}"`;
    let shown = label;
    if (c.measureText(shown).width > max) {
      while (shown.length && c.measureText(`${shown}…`).width > max) shown = shown.slice(0, -1);
      shown += '…';
    }
    c.fillText(shown, x, y);
  };
  const circle = (x: number, y: number, radius: number) => {
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
  };
  const polygon = (chord: Chord, alpha: number, dash: number[], fill = false) => {
    if (chord.classes.length < 2 || !alpha) return;
    c.save();
    c.globalAlpha = alpha;
    c.setLineDash(dash);
    c.lineWidth = Math.max(1.5, (fill ? 2.5 : 1.5) * scale);
    const colour =
      f.instruments.find(
        (i) => i.id === chord.points.find((p) => p.lowest === chord.lowest)?.instrument,
      )?.colour ?? theme.accent;
    c.strokeStyle = colour;
    c.fillStyle = colour;
    c.beginPath();
    chord.classes.forEach((pc, i) => {
      const [x, y] = xy(pc);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.closePath();
    if (fill && chord.classes.length >= 3) {
      c.globalAlpha = 0.13;
      c.fill();
      c.globalAlpha = alpha;
    }
    c.stroke();
    c.restore();
  };
  c.textAlign = 'left';
  c.fillStyle = theme.text;
  c.font = `600 24px "${theme.fontDisplay}"`;
  c.fillText('Chord star', margin, 36);
  text('CIRCLE OF FIFTHS', margin, 58, 11);
  c.textAlign = 'right';
  text(
    `bar ${String(Math.floor(f.now) + 1)} · ${String(Math.floor((f.now % 1) * 100))}%`,
    w - margin,
    35,
    11,
  );
  c.strokeStyle = theme.line;
  c.lineWidth = 1.5;
  circle(cx, cy, r);
  c.stroke();
  c.globalAlpha = 0.5;
  circle(cx, cy, r * 0.6);
  c.stroke();
  c.globalAlpha = 1;
  if (state.previous) polygon(state.previous.chord, state.fade, [6, 5]);
  if (state.next) polygon(state.next.chord, 0.6, [1, 6]);
  polygon(state.current, 1, [], true);
  for (const pc of fifths) {
    const [x, y] = xy(pc);
    c.fillStyle = theme.line;
    circle(x, y, dot * 0.5);
    c.fill();
    const points = state.current.points.filter((p) => p.pc === pc);
    // Instruments occupy separate arcs at a shared pitch, including in Pocket.
    points.sort(
      (a, b) =>
        (f.instruments.find((i) => i.id === a.instrument)?.index ?? 0) -
        (f.instruments.find((i) => i.id === b.instrument)?.index ?? 0),
    );
    for (const [index, point] of points.entries()) {
      const instrument = f.instruments.find((i) => i.id === point.instrument);
      const lowest = point.lowest === state.current.lowest;
      c.strokeStyle = instrument?.colour ?? theme.accent;
      c.fillStyle = instrument?.colour ?? theme.accent;
      c.lineWidth = Math.max(2, (lowest ? 4 : 2) * scale);
      const radius = lowest ? bass : dot;
      if (theme.glow && index === 0) {
        c.shadowColor = c.fillStyle;
        c.shadowBlur = 13;
      }
      if (points.length === 1) {
        circle(x, y, radius);
        c.fill();
      } else {
        const angle = (index * Math.PI * 2) / points.length - Math.PI / 2;
        c.beginPath();
        c.arc(x, y, radius + 5 * scale, angle, angle + ((Math.PI * 2) / points.length) * 0.8);
        c.stroke();
      }
      c.shadowBlur = 0;
      if (lowest && points.length === 1) {
        circle(x, y, radius + 6 * scale);
        c.stroke();
      }
    }
    const count = points.reduce((sum, p) => sum + p.count, 0);
    if (count > 4 && r >= 160) {
      c.textAlign = 'center';
      const [countX, countY] = xy(pc, r - dot - 21);
      text(`×${String(count)}`, countX, countY + 4, 10, theme.text);
    }
    const [lx, ly] = xy(pc, labelRadius);
    c.textAlign = 'center';
    c.font = `600 ${String(labelFont)}px "${theme.fontDisplay}"`;
    c.fillStyle = points.length ? theme.text : theme.muted;
    c.fillText(className(pc), lx, ly + labelFont * 0.35);
  }
  // Outline the letters rather than covering the chord's geometry with a panel.
  const centreLabel = (label: string, y: number) => {
    c.save();
    c.strokeStyle = theme.ground;
    c.lineWidth = Math.max(3, 4 * scale);
    c.lineJoin = 'round';
    c.strokeText(label, cx, y, r * 1.15);
    c.restore();
    c.fillText(label, cx, y, r * 1.15);
  };
  c.textAlign = 'center';
  const current = state.current;
  if (current.root) {
    c.font = `700 ${String(rootFont)}px "${theme.fontDisplay}"`;
    c.fillStyle = theme.text;
    centreLabel(current.root, cy + 2 * scale);
    text(
      current.quality ?? '',
      cx,
      cy + 35 * scale,
      Math.max(13, 18 * scale),
      theme.muted,
      r * 1.25,
    );
  } else {
    const perLine = r < 150 ? 4 : 6;
    const lines: string[] = [];
    for (let i = 0; i < current.classes.length; i += perLine)
      lines.push(
        current.classes
          .slice(i, i + perLine)
          .map(className)
          .join(' · '),
      );
    if (!lines.length) lines.push(current.name);
    c.font = `600 ${String(Math.max(14, 17 * scale))}px "${theme.fontDisplay}"`;
    c.fillStyle = theme.text;
    lines.forEach((label, i) => {
      centreLabel(label, cy + (i - (lines.length - 1) / 2) * Math.max(18, 21 * scale));
    });
    if (lines.length < 3 && current.pitches.length)
      text(
        'sounding pitches',
        cx,
        cy + 35 * scale,
        Math.max(11, 12 * scale),
        theme.muted,
        r * 1.25,
      );
  }
  const total = current.points.reduce((sum, point) => sum + point.count, 0);
  const octaves =
    total <= 8
      ? current.pitches.map(spelling).join(' ')
      : `${String(total)} notes${r >= 150 ? ` · ${String(current.classes.length)} classes` : ''}`;
  text(octaves, cx, cy + Math.max(50, 62 * scale), Math.max(11, 12 * scale), theme.muted, r * 1.25);
  const sx = wide ? w * 0.8 : margin;
  const sy = wide ? cy - 110 * scale : chartHeight + 12;
  c.textAlign = 'left';
  text('CHORDS BY BAR', sx, sy, Math.max(11, 11 * scale));
  text('longest held set · window', sx, sy + 18, 10, theme.muted, wide ? w * 0.18 : w - margin * 2);
  const barWidth = wide ? w * 0.18 : (w - margin * 2) / 4 - 8;
  for (const [index, entry] of state.bars.entries()) {
    const x = wide ? sx : margin + (index * (w - margin * 2)) / 4;
    const y = wide ? sy + 48 + index * 56 * scale : sy + 45;
    if (entry.bar === Math.floor(f.now)) {
      c.fillStyle = theme.panel;
      c.strokeStyle = theme.accent;
      c.lineWidth = 1.5;
      c.beginPath();
      c.roundRect(x - 6, y - 16, barWidth, wide ? 47 * scale : 61, theme.radius);
      c.fill();
      c.stroke();
    }
    text(
      `bar ${String(entry.bar + 1)}`,
      x,
      y - 2,
      Math.max(11, 11 * scale),
      theme.muted,
      barWidth - 8,
    );
    const colour = entry.bar === Math.floor(f.now) ? theme.text : theme.muted;
    if (entry.chord && !entry.chord.root && entry.chord.classes.length > 4) {
      for (let row = 0; row < Math.ceil(entry.chord.classes.length / 4); row++)
        text(
          entry.chord.classes
            .slice(row * 4, row * 4 + 4)
            .map(className)
            .join(' · '),
          x,
          y + 14 + row * 13,
          11,
          colour,
          barWidth - 8,
        );
    } else
      text(
        entry.chord?.name ?? 'outside window',
        x,
        y + 16,
        Math.max(11, 12 * scale),
        colour,
        barWidth - 8,
      );
  }
  // Instruments live beside the circle instead of taking its height away.
  const legendFont = wide ? Math.max(11, 11 * scale) : 11;
  const rowHeight = legendFont + 7;
  const sideWidth = Math.max(90, cx - labelRadius - margin - 12);
  const rows = wide
    ? Math.min(legend.length, Math.max(1, Math.floor((h - 125) / rowHeight)))
    : Math.ceil(legend.length / 2);
  const columns = Math.max(1, Math.ceil(legend.length / Math.max(1, rows)));
  const columnWidth = wide ? sideWidth / columns : sideWidth;
  const legendTop = wide ? h - margin - rows * rowHeight : 78;
  c.textAlign = 'left';
  if (wide) {
    text('— unpitched', margin, legendTop - 18, legendFont, theme.muted, sideWidth);
    text(
      'solid: now · dashed: previous · dotted: next',
      margin,
      h - 10,
      11,
      theme.muted,
      w - margin * 2,
    );
  } else
    text(
      'solid: now · dashed: previous · dotted: next · — unpitched',
      margin,
      chartHeight - 12,
      11,
      theme.muted,
      w - margin * 2,
    );
  for (const [index, instrument] of legend.entries()) {
    const col = Math.floor(index / Math.max(1, rows));
    const x = wide ? margin + col * columnWidth : col ? w - margin - sideWidth : margin;
    const y = legendTop + (index % Math.max(1, rows)) * rowHeight;
    c.fillStyle = instrument.colour;
    circle(x + 4, y - 4, 4);
    c.fill();
    const unpitched = score.unpitched.has(instrument.id);
    const label = `${unpitched ? (score.pitched.has(instrument.id) ? 'mixed: ' : '— ') : ''}${instrument.name}${instrument.muted ? ' (muted)' : ''}`;
    text(label, x + 14, y, legendFont, theme.text, columnWidth - 20);
  }
}
const view: ViewDefinition = {
  id: 'chord-star',
  group: 'pitch',
  name: 'Chord star',
  tag: 'harmony',
  mount(element) {
    return mount2d(
      element,
      (notes) => ({ notes, score: analyse(notes), muted: '' }),
      (c, f, data) => {
        const muted = f.instruments
          .filter((i) => i.muted)
          .map((i) => i.id)
          .sort()
          .join('|');
        if (muted !== data.muted) {
          data.muted = muted;
          data.score = analyse(
            data.notes,
            new Set(f.instruments.filter((i) => i.muted).map((i) => i.id)),
          );
        }
        draw(c, f, data.score);
      },
    );
  },
};
export default view;
