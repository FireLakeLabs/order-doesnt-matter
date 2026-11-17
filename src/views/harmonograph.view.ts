import type { ViewDefinition, ViewFrame } from './types';
import { mount2d } from './shared/retro-2d';
import { noteProgress } from './shared/timing';
import {
  analyse,
  layout,
  pairing,
  pitchLabel,
  sounding,
  trace,
  unpitched,
} from './harmonograph/model';
import type { Pair, Tone } from './harmonograph/model';

function draw(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  active: Tone[],
  pairs: ReturnType<typeof pairing>,
  unpitchedIds: Set<string>,
) {
  const { theme, width: w, height: h } = f;
  const g = layout(w, h, pairs.others.length),
    scale = Math.max(0.65, w / 960);
  const owner = (tone: Tone) => f.instruments.find((i) => i.id === tone.note.instrument);
  const text = (
    value: string,
    x: number,
    y: number,
    font: number,
    colour = theme.muted,
    width = w - 32,
  ) => {
    c.font = `${String(font)}px "${theme.fontMono}"`;
    c.fillStyle = colour;
    let label = value;
    if (c.measureText(label).width > width) {
      while (label.length && c.measureText(`${label}…`).width > width) label = label.slice(0, -1);
      label += '…';
    }
    c.fillText(label, x, y);
  };
  const figure = (pair: Pair, cx: number, cy: number, radius: number, small: boolean) => {
    const { points } = trace(pair, f.now, small);
    const count = points.length / 2,
      tail = Math.max(0, Math.floor((count - 1) * 0.8));
    const stroke = (from: number, colour: string, alpha: number, width: number) => {
      c.beginPath();
      for (let i = from; i < count; i++) {
        const x = cx + points[i * 2] * radius,
          y = cy + points[i * 2 + 1] * radius;
        if (i === from) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.strokeStyle = colour;
      c.globalAlpha = alpha;
      c.lineWidth = width;
      c.stroke();
    };
    const lowColour = owner(pair.low)?.colour ?? theme.accent;
    const highColour = owner(pair.high)?.colour ?? theme.text;
    stroke(0, lowColour, small ? 0.65 : 0.55, Math.max(1.2, (small ? 0.8 : 1) * scale));
    stroke(tail, highColour, 1, Math.max(1.4, (small ? 1 : 1.6) * scale));
    c.globalAlpha = 1;
    if (!small) {
      const x = cx + points[(count - 1) * 2] * radius,
        y = cy + points[(count - 1) * 2 + 1] * radius;
      c.fillStyle = theme.text;
      c.shadowColor = highColour;
      c.shadowBlur = theme.glow ? 8 : 0;
      c.beginPath();
      c.arc(x, y, Math.max(3, 6 * scale), 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
    }
  };
  c.textAlign = 'left';
  c.fillStyle = theme.text;
  c.font = `600 24px "${theme.fontDisplay}"`;
  c.fillText('Harmonograph', 20, 33);
  c.textAlign = 'right';
  text(
    `bar ${String(Math.floor(f.now) + 1)} · ${String(Math.round((f.now % 1) * 100))}%`,
    w - 20,
    33,
    11,
  );
  const main = pairs.main;
  const unpitchedNames = f.instruments.filter((i) => unpitchedIds.has(i.id)).map((i) => i.name);
  const status = `${main ? `pen ${String(Math.round(noteProgress(main.shorter, f.now) * 100))}% of shorter span` : 'scored pitches'}${unpitchedNames.length ? ` · unpitched (${String(unpitchedNames.length)}): ${unpitchedNames.join(' · ')}` : ''}`;
  c.textAlign = 'left';
  text(status, 20, 57, 11);

  if (!main) {
    c.textAlign = 'center';
    c.fillStyle = theme.text;
    c.font = `600 ${String(Math.max(24, Math.min(44, w / 25)))}px "${theme.fontDisplay}"`;
    c.fillText('no interval now', w / 2, h * 0.46);
    text(
      `${String(active.length)} pitched span${active.length === 1 ? '' : 's'} sounding`,
      w / 2,
      h * 0.46 + 30,
      13,
    );
    return;
  }
  figure(main, g.cx, g.cy, g.radius, false);
  c.textAlign = 'center';
  text(
    `${main.ratio.toFixed(6)} ≈ ${main.approximation} · ${main.interval}`,
    g.cx,
    g.captionY,
    Math.max(13, 16 * scale),
    theme.text,
    g.mainWidth - 28,
  );
  text(
    `${pitchLabel(main.low.midi)} ${owner(main.low)?.name ?? main.low.note.instrument} × ${pitchLabel(main.high.midi)} ${owner(main.high)?.name ?? main.high.note.instrument}`,
    g.cx,
    g.captionY + 20,
    Math.max(11, 12 * scale),
    theme.muted,
    g.mainWidth - 28,
  );
  if (!pairs.others.length) {
    c.textAlign = 'left';
    text('Only this pair now', 20, h - 12, 11);
    return;
  }
  const cellW = g.miniWidth / g.miniColumns,
    cellH = g.miniHeight / g.miniRows;
  c.textAlign = 'center';
  text(
    pairs.aggregated ? 'OTHER PAIRS · COUNTED BANDS' : 'OTHER PAIRS',
    g.miniX + g.miniWidth / 2,
    g.miniY - 18,
    11,
    theme.muted,
    g.miniWidth,
  );
  for (const [i, other] of pairs.others.entries()) {
    const cx = g.miniX + ((i % g.miniColumns) + 0.5) * cellW;
    const top = g.miniY + Math.floor(i / g.miniColumns) * cellH;
    const radius = Math.max(12, Math.min(46 * scale, (cellW - 12) / 2, (cellH - 47) / 2));
    const cy = top + (cellH - 47) / 2;
    figure(other.pair, cx, cy, radius, true);
    c.textAlign = 'center';
    text(`≈ ${other.pair.approximation}`, cx, top + cellH - 30, 12, theme.text, cellW - 8);
    text(
      `${pitchLabel(other.pair.low.midi)} · ${pitchLabel(other.pair.high.midi)}`,
      cx,
      top + cellH - 16,
      11,
      theme.muted,
      cellW - 8,
    );
    text(
      other.band ? `${other.band} · ×${String(other.count)}` : other.pair.shortName,
      cx,
      top + cellH - 3,
      11,
      theme.muted,
      cellW - 8,
    );
  }
  c.textAlign = 'right';
  text(
    `${String(active.length)} pitched spans · ${String(pairs.count - 1)} other pairs${pairs.aggregated ? ' · representative per band' : ''}`,
    w - 16,
    h - 8,
    11,
    theme.muted,
    w - 32,
  );
}
const view: ViewDefinition = {
  id: 'harmonograph',
  group: 'pitch',
  name: 'Harmonograph',
  tag: 'intervals',
  mount(element) {
    return mount2d(
      element,
      (notes) => ({
        tones: analyse(notes),
        unpitched: unpitched(notes),
        active: [] as Tone[],
        pairs: pairing([]),
      }),
      (c, f, data) => {
        const active = sounding(f, data.tones);
        if (
          active.length !== data.active.length ||
          active.some((tone, i) => tone !== data.active[i])
        ) {
          data.active = active;
          data.pairs = pairing(active);
        }
        draw(c, f, active, data.pairs, data.unpitched);
      },
    );
  },
};
export default view;
