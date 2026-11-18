import type { ViewDefinition, ViewFrame } from './types';
import { mount2d, line } from './shared/retro-2d';
import {
  analyse,
  featured,
  figures,
  noteTitle,
  valueText,
  type Figure,
  type ShowScore,
} from './catwalk/model';
import { drawFigure, torsoAnchor } from './catwalk/figure';
import { drawPhotographers, drawStage } from './catwalk/stage';

function tag(c: CanvasRenderingContext2D, f: Figure, frame: ViewFrame) {
  if (!f.note) return;
  const { width: w, height: h, theme } = frame;
  const width = Math.min(262, w * 0.18);
  const x = 18;
  const top = h * 0.44;
  const pad = 12;
  const font = Math.max(10, Math.min(12, w / 85));
  c.font = `${String(font)}px "${theme.fontMono}"`;
  const rows: string[] = [];
  for (const item of f.outfit) {
    const prefix = `${item.garment} · ${item.name} `;
    const text = prefix + valueText(item.value);
    // Wrap the entire bag rather than eliding settings or long sample names.
    let row = '';
    for (const ch of text) {
      if (c.measureText(row + ch).width > width - pad * 2) {
        rows.push(row);
        row = '';
      }
      row += ch;
    }
    rows.push(row);
  }
  const header = `${f.instrument.name} ${noteTitle(f.note)}`.trim();
  const rowHeight = Math.min(font * 1.65, (h * 0.48 - 50) / Math.max(1, rows.length));
  const height = 46 + rows.length * rowHeight;
  c.save();
  c.fillStyle = theme.panel;
  c.strokeStyle = f.instrument.colour;
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect(x, top, width, height, theme.radius);
  c.fill();
  c.stroke();
  c.fillStyle = theme.text;
  c.font = `bold 14px "${theme.fontDisplay}"`;
  c.fillText(header, x + pad, top + 24, width - 2 * pad);
  c.font = `${String(Math.min(font, rowHeight * 0.8))}px "${theme.fontMono}"`;
  rows.forEach((row, i) => {
    c.fillText(row, x + pad, top + 45 + i * rowHeight);
  });
  c.strokeStyle = f.instrument.colour;
  c.globalAlpha = 0.5;
  const torso = torsoAnchor(f);
  line(c, x + width / 2, top + height + 5, torso.x, torso.y);
  c.restore();
}

function draw(c: CanvasRenderingContext2D, frame: ViewFrame, score: ShowScore) {
  const { width: w, height: h, theme } = frame;
  const cast = figures(frame, score);
  drawStage(c, frame);
  drawPhotographers(
    c,
    frame,
    score,
    cast.find((f) => f.walking),
  );
  for (const f of cast) drawFigure(c, f, frame);
  for (const f of featured(cast)) tag(c, f, frame);
  c.fillStyle = theme.text;
  c.font = `bold 26px "${theme.fontDisplay}"`;
  c.fillText('Catwalk', 20, 39);
  c.font = `11px "${theme.fontMono}"`;
  c.fillStyle = theme.muted;
  c.textAlign = 'right';
  c.fillText(
    `bar ${String(Math.floor(frame.now) + 1)} · ${String(Math.round((frame.now % 1) * 100))}%`,
    w - 20,
    36,
  );
  c.fillText('ONE PART · ONE LOOK · ONE TURN', w - 20, 57);
  if (h >= 600) {
    c.textAlign = 'center';
    c.fillText(
      'FILTER → HAT   ROOM → SHAWL   SHAPE → SPIKES   RESONANCE → ANTENNA   HIGH-PASS → BOOTS',
      w / 2,
      h - 27,
      w - 40,
    );
    c.fillText(
      'Every note fires a camera · gain sizes the look · pan chooses its side',
      w / 2,
      h - 10,
      w - 40,
    );
  }
  c.textAlign = 'left';
  if (!cast.length) c.fillText('The runway is waiting for notes.', w * 0.35, h * 0.6);
}

const view: ViewDefinition = {
  id: 'catwalk',
  group: 'settings',
  name: 'Catwalk',
  tag: 'note outfits',
  span: 'song',
  mount: (element) => mount2d(element, analyse, draw),
};
export default view;
