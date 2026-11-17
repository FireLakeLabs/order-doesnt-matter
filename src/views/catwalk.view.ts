import type { ViewDefinition, ViewFrame, ViewNote } from './types';
import { mount2d, line } from './shared/retro-2d';
import {
  featured,
  figures,
  noteTitle,
  runway,
  scoredNotes,
  valueText,
  type Figure,
} from './catwalk/model';

const instrumentCount = (f: Figure) => new Set(f.members.map((n) => n.instrument)).size;

function figure(c: CanvasRenderingContext2D, f: Figure, frame: ViewFrame) {
  const { theme } = frame;
  c.save();
  c.translate(f.x, f.y);
  c.scale(f.scale, f.scale);
  c.globalAlpha = f.instrument.muted ? 0.3 : 0.55 + f.progress * 0.45;
  const items = f.outfit;
  // Every garment is placed independently; bag insertion order cannot change the outfit.
  for (const item of items.filter((i) => i.garment === 'cape')) {
    const length = 20 + item.size * 65;
    c.fillStyle = theme.text;
    c.globalAlpha *= 0.28;
    c.beginPath();
    c.moveTo(-20, -80);
    c.lineTo(20, -80);
    c.lineTo(25 + length * 0.35, -80 + length);
    c.lineTo(-25 - length * 0.35, -80 + length);
    c.closePath();
    c.fill();
    c.globalAlpha /= 0.28;
    c.strokeStyle = theme.text;
    c.lineWidth = 1.5;
    c.stroke();
  }
  c.fillStyle = f.instrument.colour;
  c.strokeStyle = f.instrument.colour;
  c.lineCap = 'round';
  c.lineWidth = 8;
  line(c, -9, -23, -9 - f.stride, -3);
  line(c, 9, -23, 9 + f.stride, -3);
  // A hand on the hip is the held pose; approaching notes swing their arms.
  c.lineWidth = 6;
  line(c, -18, -69, -31 - f.stride * 0.4, -43);
  line(c, -31 - f.stride * 0.4, -43, f.posing ? -18 : -29, -36);
  line(c, 18, -69, 29 + f.stride * 0.4, -40);
  c.beginPath();
  c.roundRect(-22, -82, 44, 62, 17);
  c.fill();
  if (f.posing && theme.glow && !f.instrument.muted) {
    c.shadowColor = f.instrument.colour;
    c.shadowBlur = 12;
  }
  c.beginPath();
  c.arc(0, -99, 16, 0, Math.PI * 2);
  c.fill();
  c.shadowBlur = 0;
  // Theme ink outlines keep figures legible in both flat-ink themes.
  c.strokeStyle = theme.text;
  c.lineWidth = 1.2;
  c.beginPath();
  c.roundRect(-22, -82, 44, 62, 17);
  c.stroke();
  c.fillStyle = theme.ground;
  for (const x of [-5, 5]) {
    c.beginPath();
    c.arc(x, -101, 2.4, 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = theme.ground;
  c.lineWidth = 1.6;
  c.beginPath();
  c.arc(0, -95, 5, 0.2, Math.PI - 0.2);
  c.stroke();
  c.fillStyle = theme.text;
  c.strokeStyle = theme.text;
  for (const item of items) {
    const v = item.size;
    switch (item.garment) {
      case 'hat': {
        const width = 12 + v * 26,
          height = 7 + v * 26;
        c.beginPath();
        c.roundRect(-width * 0.6, -114 - height, width * 1.2, height, 3);
        c.fill();
        c.beginPath();
        c.ellipse(0, -114, width, 4, 0, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case 'spikes':
        c.beginPath();
        c.moveTo(-22, -80);
        for (let i = 0; i < 5; i++) {
          c.lineTo(-18 + i * 9, -85 - v * 22);
          c.lineTo(-14 + i * 9, -80);
        }
        c.closePath();
        c.fill();
        break;
      case 'boots':
        for (const side of [-1, 1]) {
          const x = side * (9 + f.stride);
          c.beginPath();
          c.roundRect(x - 7, -4 - v * 17, 15, 8 + v * 17, 3);
          c.fill();
        }
        break;
      case 'antenna':
        c.lineWidth = 2;
        line(c, 13, -108, 24 + v * 16, -120 - v * 33);
        c.beginPath();
        c.arc(24 + v * 16, -120 - v * 33, 3 + v * 3, 0, Math.PI * 2);
        c.fill();
        break;
    }
  }
  const badges = items.filter((i) => i.garment === 'badge');
  for (const [i, badge] of badges.entries()) {
    const x = -15 + (i % 3) * 15,
      y = -68 + Math.floor(i / 3) * 11;
    c.fillStyle = theme.panel;
    c.strokeStyle = theme.text;
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(x - 5, y - 4, 10 + badge.size * 3, 8, 1);
    c.fill();
    c.stroke();
  }
  if (f.members.length > 1) {
    c.font = `bold 16px "${theme.fontMono}"`;
    c.textAlign = 'center';
    c.fillStyle = theme.text;
    c.fillText(`×${String(f.members.length)}`, 0, 24);
  }
  c.restore();
  if (f.posing) {
    c.save();
    c.textAlign = 'center';
    c.fillStyle = theme.text;
    c.font = `12px "${theme.fontDisplay}"`;
    c.fillText(
      instrumentCount(f) > 1 ? `${String(instrumentCount(f))} instruments` : f.instrument.name,
      f.x,
      f.y + (f.members.length > 1 ? 24 * f.scale + 18 : 23),
      frame.width * 0.21,
    );
    c.restore();
  }
}

function tag(c: CanvasRenderingContext2D, f: Figure, frame: ViewFrame, index: number) {
  const { width: w, height: h, theme } = frame;
  const width = Math.min(262, w < 700 ? w * 0.47 : w * 0.25);
  const x = index === 0 ? 20 : w - width - 20;
  const top = h * 0.16;
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
  if (f.members.length > 1) {
    rows.unshift('representative bag');
    const count = instrumentCount(f);
    rows.unshift(
      `×${String(f.members.length)} · ${String(count)} ${count === 1 ? 'instrument' : 'instruments'}`,
    );
  }
  const header = `${f.instrument.name} ${noteTitle(f.note)}`.trim();
  const rowHeight = Math.min(font * 1.65, (h * 0.51 - 50) / Math.max(1, rows.length));
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
  line(c, x + width / 2, top + height + 5, f.x, f.y - 150 * f.scale);
  c.restore();
}

function draw(c: CanvasRenderingContext2D, frame: ViewFrame, notes: ViewNote[]) {
  const { width: w, height: h, theme } = frame;
  const r = runway(frame);
  const cast = figures(frame, notes);
  c.fillStyle = theme.panel;
  c.strokeStyle = theme.line;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo((w - r.backWidth) / 2, r.back);
  c.lineTo((w + r.backWidth) / 2, r.back);
  c.lineTo((w + r.frontWidth) / 2, r.front);
  c.lineTo((w - r.frontWidth) / 2, r.front);
  c.closePath();
  c.fill();
  c.stroke();
  c.setLineDash([9, 12]);
  line(c, w / 2, r.back, w / 2, r.front);
  c.setLineDash([]);
  for (let i = 1; i < 5; i++) {
    const p = i / 5;
    const y = r.back + (r.front - r.back) * p;
    const half = (r.backWidth + (r.frontWidth - r.backWidth) * p) / 2;
    c.globalAlpha = 0.35;
    line(c, w / 2 - half, y, w / 2 + half, y);
  }
  c.globalAlpha = 1;
  c.beginPath();
  c.ellipse(w / 2, r.front + 5, w * 0.45, h * 0.037, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  for (const f of cast.filter((f) => f.posing)) {
    c.fillStyle = f.instrument.colour;
    c.globalAlpha = f.instrument.muted ? 0.08 : 0.22;
    c.beginPath();
    c.ellipse(f.x, f.y + 4, 47 * f.scale, 8 * f.scale, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  for (const f of cast) figure(c, f, frame);
  for (const [i, f] of featured(cast, w)
    .sort((a, b) => a.x - b.x)
    .entries())
    tag(c, f, frame, i);
  c.fillStyle = theme.text;
  c.font = `bold 26px "${theme.fontDisplay}"`;
  c.fillText('Catwalk', 20, 39);
  c.font = `12px "${theme.fontMono}"`;
  c.fillStyle = theme.muted;
  c.fillText('WHAT NOTES WEAR · ANY ORDER, SAME OUTFIT', 21, 63, w - 180);
  c.textAlign = 'right';
  c.fillText(
    `bar ${String(Math.floor(frame.now) + 1)} · ${String(Math.floor((frame.now % 1) * 100))}%`,
    w - 20,
    36,
  );
  c.fillText(`window ${String(frame.lookAhead)}`, w - 20, 57);
  c.textAlign = 'left';
  if (!cast.length) {
    c.textAlign = 'center';
    c.fillText('The runway is waiting for notes.', w / 2, h * 0.6);
    c.textAlign = 'left';
  }
}

const view: ViewDefinition = {
  id: 'catwalk',
  group: 'settings',
  name: 'Catwalk',
  tag: 'note outfits',
  mount: (element) => mount2d(element, scoredNotes, draw),
};
export default view;
