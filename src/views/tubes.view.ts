import type { ViewDefinition, ViewFrame } from './types';
import { line, mount2d } from './shared/retro-2d';
import { clamp } from './shared/math';
import { random } from './shared/particles';
import { noteProgress } from './shared/timing';
import { noteName } from './shared/pitch';
import { indexTubes, racks, valueText, type TubeIndex } from './tubes/model';
import { tubeLayout, type TubeBox } from './tubes/geometry';

function inkOn(colour: string, theme: ViewFrame['theme']): string {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((i) => {
      const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const ground = luminance(theme.ground),
    text = luminance(theme.text),
    background = luminance(colour);
  const contrast = (l: number) =>
    (Math.max(l, background) + 0.05) / (Math.min(l, background) + 0.05);
  return contrast(ground) > contrast(text) ? theme.ground : theme.text;
}
function glass(c: CanvasRenderingContext2D, box: TubeBox) {
  const left = box.x - box.width / 2,
    right = box.x + box.width / 2;
  const radius = Math.min(box.width / 2, (box.bottom - box.top) / 2);
  c.beginPath();
  c.moveTo(left, box.top);
  c.lineTo(left, box.bottom - radius);
  c.quadraticCurveTo(left, box.bottom, box.x, box.bottom);
  c.quadraticCurveTo(right, box.bottom, right, box.bottom - radius);
  c.lineTo(right, box.top);
}
function drawTube(c: CanvasRenderingContext2D, f: ViewFrame, box: TubeBox) {
  const { tube, rack, x, width, top, bottom } = box;
  const { theme } = f;
  const height = bottom - top;
  const active = rack.sample.active.length > 0 && !rack.instrument.muted;
  const y = (level: number) => bottom - level * height;
  c.save();
  glass(c, box);
  c.closePath();
  c.clip();
  c.fillStyle = theme.panel;
  c.fillRect(x - width / 2, top, width, height);
  if (tube.level !== undefined) {
    c.globalAlpha = active ? 0.88 : 0.28;
    c.fillStyle = rack.instrument.colour;
    c.fillRect(x - width / 2 + 2, y(tube.level), width - 4, height * tube.level);
    if (tube.low !== undefined && tube.low !== tube.level) {
      c.globalAlpha = active ? 0.3 : 0.12;
      c.fillStyle = theme.text;
      c.fillRect(x - width / 2 + 2, y(tube.level), width - 4, height * (tube.level - tube.low));
    }
    c.globalAlpha = active ? 1 : 0.5;
    c.strokeStyle = theme.text;
    c.lineWidth = 2;
    line(c, x - width / 2 + 2, y(tube.level), x + width / 2 - 2, y(tube.level));
  }
  c.restore();
  c.strokeStyle = theme.muted;
  c.lineWidth = 2;
  glass(c, box);
  c.stroke();
  c.strokeStyle = theme.line;
  c.lineWidth = 1;
  line(c, x - width / 2 - 3, top, x + width / 2 + 3, top);
  for (const [i, tick] of tube.ticks.entries()) {
    c.save();
    c.globalAlpha = 0.15 + ((i + 1) / tube.ticks.length) * 0.7;
    c.strokeStyle = rack.instrument.colour;
    c.lineWidth = i === tube.ticks.length - 1 ? 2 : 1;
    if (tick === undefined) {
      c.beginPath();
      c.arc(x + width / 2 + 6, bottom + 3, 1.5, 0, Math.PI * 2);
      c.stroke();
    } else line(c, x + width / 2 + 2, y(tick), x + width / 2 + 9, y(tick));
    c.restore();
  }
  const labelWidth = Math.max(40, width * 1.65);
  c.textAlign = 'center';
  c.fillStyle = theme.text;
  c.font = `10px "${theme.fontMono}"`;
  const status =
    tube.level === undefined
      ? '—'
      : box.dense && tube.count > 1
        ? `×${String(tube.count)}`
        : tube.moving
          ? 'moving'
          : 'flat';
  c.save();
  c.fillStyle = status === 'moving' ? rack.instrument.colour : theme.panel;
  c.beginPath();
  c.roundRect(x - 22, top + 9, 44, 16, theme.radius);
  c.fill();
  c.fillStyle = status === 'moving' ? inkOn(rack.instrument.colour, theme) : theme.muted;
  c.fillText(status, x, top + 21);
  c.restore();
  if (!box.dense && tube.range?.min !== undefined && tube.range.max !== undefined && tube.moving) {
    c.fillStyle = theme.muted;
    c.font = `9px "${theme.fontMono}"`;
    const name = tube.setting.name === 'note' ? noteName : valueText;
    for (const [text, baseline] of [
      [name(tube.range.max), top + 39],
      [name(tube.range.min), bottom - 8],
    ] as const) {
      const textWidth = Math.min(labelWidth, c.measureText(text).width);
      c.fillStyle = theme.panel;
      c.fillRect(x - textWidth / 2 - 2, baseline - 8, textWidth + 4, 11);
      c.fillStyle = theme.text;
      c.fillText(text, x, baseline, labelWidth);
    }
  }
  // Bubbles mark an onset, never a sweep of the held liquid level.
  const sample = tube.sample;
  if (active && tube.moving && sample?.hasOnset && tube.level !== undefined) {
    const progress = noteProgress(sample, f.now);
    const age = f.now - sample.start;
    const life = Math.min(0.25, sample.end - sample.start);
    if (age >= 0 && age < life && progress < 1) {
      let seed = Math.round(sample.start * 65536) ^ Math.imul(rack.instrument.index + 1, 31);
      for (const ch of tube.setting.name) seed = Math.imul(seed, 31) + ch.charCodeAt(0);
      const phase = clamp(age / life);
      c.save();
      c.globalAlpha = 1 - phase;
      c.strokeStyle = theme.text;
      c.lineWidth = 1;
      for (let i = 0; i < (box.dense ? 2 : 5); i++) {
        const bx = x + (random(seed, i) - 0.5) * width * 0.65;
        const by =
          y(tube.level) - (phase * (0.08 + random(seed, i + 5) * 0.1) + i * 0.015) * height;
        c.beginPath();
        c.arc(
          bx,
          Math.min(bottom - 3, Math.max(top + 30, by)),
          1.5 + random(seed, i + 10) * 1.5,
          0,
          Math.PI * 2,
        );
        c.stroke();
      }
      c.restore();
    }
  }
  c.fillStyle = theme.muted;
  c.font = `${box.dense ? '10' : '11'}px "${theme.fontMono}"`;
  c.fillText(tube.setting.name, x, bottom + (box.dense ? 12 : 18), labelWidth);
  c.fillStyle = theme.text;
  c.font = `${box.dense ? '11' : '12'}px "${theme.fontMono}"`;
  c.fillText(
    tube.missing && tube.missing === tube.count ? '—' : tube.text,
    x,
    bottom + (box.dense ? 26 : 34),
    labelWidth,
  );
  c.fillStyle = theme.muted;
  c.font = `9px "${theme.fontMono}"`;
  const tail =
    tube.count > 1
      ? `×${String(tube.count)} · ${String(tube.ticks.length)}/16`
      : `${String(tube.ticks.length)}/16`;
  if (!box.dense)
    c.fillText(
      tube.missing > 0 ? `${String(tube.count - tube.missing)}/${String(tube.count)} set` : tail,
      x,
      bottom + 46,
      labelWidth,
    );
  c.textAlign = 'left';
}
function wrappedName(c: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let row = '';
  for (const ch of text.replace(/([a-z])([A-Z])/g, '$1 $2')) {
    if (row && c.measureText(row + ch).width > width) {
      const space = row.lastIndexOf(' ');
      if (space > 0) {
        lines.push(row.slice(0, space).trim());
        row = row.slice(space + 1);
      } else {
        lines.push(row.trim());
        row = '';
      }
    }
    row += ch;
  }
  if (row) lines.push(row.trim());
  return lines;
}
function drawTubes(c: CanvasRenderingContext2D, f: ViewFrame, index: TubeIndex) {
  const { width: w, height: h, theme } = f;
  const current = racks(f, index);
  const layout = tubeLayout(f, current);
  c.fillStyle = theme.text;
  c.font = `bold 26px "${theme.fontDisplay}"`;
  c.fillText('Tubes', 20, 36);
  c.fillStyle = theme.muted;
  c.font = `11px "${theme.fontMono}"`;
  c.fillText('one sample per note · last 16 values', 21, 59, w - 170);
  c.font = `10px "${theme.fontMono}"`;
  c.fillText('song min → max · fixed ranges centred · — unavailable / unset', 21, 77, w - 42);
  c.textAlign = 'right';
  c.fillText(
    `bar ${String(Math.floor(f.now) + 1)} · ${String(Math.floor((f.now % 1) * 100))}%`,
    w - 20,
    34,
  );
  c.fillText(`song ${String(f.from + 1)}–${String(f.to)}`, w - 20, 56);
  c.textAlign = 'left';
  const beams = new Set(layout.tubes.map((t) => t.bottom));
  for (const bottom of beams) {
    c.fillStyle = theme.panel;
    c.strokeStyle = theme.line;
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(14, bottom - 3, layout.stageWidth - 28, 11, theme.radius);
    c.fill();
    c.stroke();
  }
  for (const label of layout.labels) {
    c.font = `${label.dense ? '11' : '12'}px "${theme.fontDisplay}"`;
    c.fillStyle = label.rack.sample.active.length ? theme.text : theme.muted;
    const rows = wrappedName(
      c,
      label.dense
        ? `${String(label.rack.instrument.index + 1)} ${label.rack.instrument.name}`
        : label.rack.instrument.name,
      label.width - 8,
    );
    const max = label.dense ? 1 : 3;
    for (const [i, text] of rows.slice(0, max).entries())
      c.fillText(
        i === max - 1 && rows.length > max ? `${text}…` : text,
        label.x + 4,
        label.y + 10 + i * 13,
        label.width - 8,
      );
    c.fillStyle = label.rack.instrument.colour;
    c.fillRect(label.x + 4, label.y + (label.dense ? 14 : 39), label.width - 8, 2);
  }
  for (const tube of layout.tubes) drawTube(c, f, tube);
  if (layout.chips.length) {
    c.fillStyle = theme.panel;
    c.fillRect(layout.trayLeft, layout.trayTop, layout.trayWidth, h - layout.trayTop);
    c.fillStyle = theme.muted;
    c.font = `10px "${theme.fontMono}"`;
    c.fillText(
      `FOLDED CONSTANTS${layout.compact ? ' · names only' : ' · retained values dim at rest'}`,
      layout.trayLeft + 12,
      layout.trayTop + 13,
      layout.trayWidth - 24,
    );
    for (const chip of layout.chips) {
      const active = chip.rack.sample.active.length > 0 && !chip.rack.instrument.muted;
      if (chip.tube) {
        c.save();
        c.globalAlpha = active ? (theme.glow ? 0.65 : 0.25) : theme.glow ? 0.2 : 0.1;
        c.fillStyle = chip.rack.instrument.colour;
        c.beginPath();
        c.roundRect(chip.x, chip.y, chip.width, 17, theme.radius);
        c.fill();
        c.restore();
        c.strokeStyle = theme.line;
        c.lineWidth = 1;
        c.beginPath();
        c.roundRect(chip.x, chip.y, chip.width, 17, theme.radius);
        c.stroke();
      }
      c.fillStyle = chip.tube ? theme.text : chip.rack.instrument.colour;
      c.font = `10px "${chip.tube ? theme.fontMono : theme.fontDisplay}"`;
      c.fillText(chip.text, chip.x + 6, chip.y + 12, chip.width - 12);
    }
  }
  if (!current.some((r) => r.tubes.length)) {
    c.fillStyle = theme.muted;
    c.font = `14px "${theme.fontDisplay}"`;
    c.textAlign = 'center';
    c.fillText('Settings in the score will fill the rack.', w / 2, h / 2);
    c.textAlign = 'left';
  }
}
const view: ViewDefinition = {
  id: 'tubes',
  name: 'Tubes',
  group: 'settings',
  tag: 'sampled settings',
  // Song ranges and truthful resting values require the song, as agreed with the lead.
  span: 'song',
  mount: (element) => mount2d(element, indexTubes, drawTubes),
};
export default view;
