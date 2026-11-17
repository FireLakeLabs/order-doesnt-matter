import type { ViewDefinition, ViewFrame } from './types';
import { mount2d } from './shared/retro-2d';
import { analyse, at, className, fifths, position, spelling } from './chord-star/model';
import type { Chord } from './chord-star/model';

function draw(c: CanvasRenderingContext2D, f: ViewFrame, score: ReturnType<typeof analyse>) {
  const { width: w, height: h, theme } = f;
  const state = at(f, score),
    wide = w >= 900;
  const margin = Math.max(16, Math.min(32, w * 0.025));
  const legend = f.instruments.filter((i) => score.pitched.has(i.id) || score.unpitched.has(i.id));
  const columns = Math.max(wide ? 5 : 3, Math.ceil(legend.length / 4));
  const footerHeight = 35 + Math.ceil(legend.length / columns) * 23;
  const stripHeight = wide ? 0 : 102;
  const top = 86,
    bottom = Math.max(top + 100, h - footerHeight - stripHeight - 18);
  const circleWidth = wide ? w * 0.76 : w;
  const r = Math.max(30, Math.min(circleWidth * 0.36, (bottom - top) * 0.44));
  const cx = circleWidth / 2,
    cy = (top + bottom) / 2;
  const dot = Math.max(6, Math.max(10, Math.min(12, r * 0.06)));
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
    c.fillText(label, x, y, Math.max(1, max));
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
    c.lineWidth = fill ? 2.5 : 1.5;
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
  text('CIRCLE OF FIFTHS', margin, 58, 10);
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
      c.lineWidth = lowest ? 4 : 2;
      const radius = dot + (lowest ? 3 : 0);
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
        c.arc(x, y, radius + 5, angle, angle + ((Math.PI * 2) / points.length) * 0.8);
        c.stroke();
      }
      c.shadowBlur = 0;
      if (lowest && points.length === 1) {
        circle(x, y, radius + 6);
        c.stroke();
      }
    }
    const count = points.reduce((sum, p) => sum + p.count, 0);
    if (count > 4 && r >= 160) {
      c.textAlign = 'center';
      const [countX, countY] = xy(pc, r - dot - 21);
      text(`×${String(count)}`, countX, countY + 4, 10, theme.text);
    }
    const [lx, ly] = xy(pc, r + Math.max(25, dot + 16));
    c.textAlign = 'center';
    c.font = `600 ${String(Math.max(13, Math.min(19, r * 0.085)))}px "${theme.fontDisplay}"`;
    c.fillStyle = points.length ? theme.text : theme.muted;
    c.fillText(className(pc), lx, ly + 6);
  }
  // A ground-coloured label keeps crossed polygons from obscuring the chord name.
  c.fillStyle = theme.ground;
  c.globalAlpha = 0.94;
  c.fillRect(cx - r * 0.59, cy - 53, r * 1.18, 111);
  c.globalAlpha = 1;
  c.textAlign = 'center';
  const current = state.current;
  if (current.root) {
    c.font = `700 ${String(Math.min(76, r * 0.4))}px "${theme.fontDisplay}"`;
    c.fillStyle = theme.text;
    c.fillText(current.root, cx, cy + 2);
    text(current.quality ?? '', cx, cy + 29, 15, theme.muted, r * 1.15);
  } else {
    const perLine = r < 150 ? 3 : 6;
    const lines: string[] = [];
    for (let i = 0; i < current.classes.length; i += perLine)
      lines.push(
        current.classes
          .slice(i, i + perLine)
          .map(className)
          .join(' · '),
      );
    if (!lines.length) lines.push(current.name);
    c.font = `600 ${String(Math.max(12, Math.min(25, r * 0.13)))}px "${theme.fontDisplay}"`;
    c.fillStyle = theme.text;
    lines.forEach((label, i) => {
      c.fillText(label, cx, cy + (i - (lines.length - 1) / 2) * 17, r * 1.15);
    });
    if (lines.length < 3 && current.pitches.length)
      text('sounding pitches', cx, cy + 26, 11, theme.muted, r * 1.1);
  }
  const total = current.points.reduce((sum, point) => sum + point.count, 0);
  const octaves =
    total <= 8
      ? current.pitches.map(spelling).join(' ')
      : `${String(total)} notes${r >= 150 ? ` · ${String(current.classes.length)} classes` : ''}`;
  text(octaves, cx, cy + 50, Math.max(10, Math.min(12, r * 0.06)), theme.muted, r * 1.12);
  const sx = wide ? w * 0.79 : margin,
    sy = wide ? cy - 90 : bottom + 26;
  c.textAlign = 'left';
  text('CHORDS BY BAR', sx, sy, 11);
  text('longest held set · window', sx, sy + 19, 9, theme.muted, wide ? w * 0.19 : w - margin * 2);
  for (const [index, entry] of state.bars.entries()) {
    const x = wide ? sx : margin + (index * (w - margin * 2)) / 4;
    const y = wide ? sy + 54 + index * 43 : sy + 46;
    const width = wide ? w * 0.19 : (w - margin * 2) / 4 - 8;
    if (entry.bar === Math.floor(f.now)) {
      c.fillStyle = theme.panel;
      c.strokeStyle = theme.accent;
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(x - 6, y - 16, width, wide ? 36 : 47, theme.radius);
      c.fill();
      c.stroke();
    }
    text(`bar ${String(entry.bar + 1)}`, x, y - 2, 10, theme.muted, width - 10);
    text(
      entry.chord?.name ?? 'outside window',
      x,
      y + 14,
      11,
      entry.bar === Math.floor(f.now) ? theme.text : theme.muted,
      width - 10,
    );
  }
  c.textAlign = 'left';
  const footerTop = h - footerHeight;
  c.strokeStyle = theme.line;
  c.beginPath();
  c.moveTo(margin, footerTop);
  c.lineTo(w - margin, footerTop);
  c.stroke();
  text(
    'solid: now   dashed: previous   dotted: next',
    margin,
    footerTop + 20,
    10,
    theme.muted,
    w - margin * 2,
  );
  for (const [index, instrument] of legend.entries()) {
    const x = margin + ((index % columns) * (w - margin * 2)) / columns;
    const y = footerTop + 43 + Math.floor(index / columns) * 23;
    c.fillStyle = instrument.colour;
    circle(x + 4, y - 4, 4);
    c.fill();
    const label = `${score.unpitched.has(instrument.id) ? (score.pitched.has(instrument.id) ? 'mixed: ' : 'not pitched: ') : ''}${instrument.name}${instrument.muted ? ' (muted)' : ''}`;
    text(label, x + 15, y, 11, theme.text, (w - margin * 2) / columns - 25);
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
