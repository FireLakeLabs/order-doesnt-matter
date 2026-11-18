import type { ViewDefinition, ViewFrame } from './types';
import { line, mount2d } from './shared/retro-2d';
import { clamp } from './shared/math';
import { random } from './shared/particles';
import { noteName } from './shared/pitch';
import { indexTubes, racks, valueText, type TubeIndex } from './tubes/model';
import { tubeLayout, type TubeBox } from './tubes/geometry';
import { tubeMotion } from './tubes/motion';
import { drawVessel, vesselBody } from './tubes/vessels';

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
function drawTube(c: CanvasRenderingContext2D, f: ViewFrame, box: TubeBox, index: TubeIndex) {
  const { tube, rack, x, bottom } = box;
  const body = vesselBody(box);
  const { width } = body;
  const motion = tubeMotion(index.get(rack.instrument.id), tube, f.now, f.cps);
  const { theme } = f;
  const height = body.bottom - body.top;
  const active = rack.sample.active.length > 0 && !rack.instrument.muted;
  const y = (level: number) => bottom - level * height;
  drawVessel(c, f, body, motion, active);
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
  const labelWidth = Math.max(40, box.width * 1.28);
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
  c.roundRect(x - 22, body.top - 24, 44, 16, theme.radius);
  c.fill();
  c.fillStyle = status === 'moving' ? inkOn(rack.instrument.colour, theme) : theme.muted;
  c.fillText(status, x, body.top - 12);
  c.restore();
  if (
    height >= 40 &&
    tube.range?.min !== undefined &&
    tube.range.max !== undefined &&
    tube.moving
  ) {
    c.fillStyle = theme.muted;
    c.font = `9px "${theme.fontMono}"`;
    const name = tube.setting.name === 'note' ? noteName : valueText;
    for (const [text, baseline] of [
      [name(tube.range.max), body.top + 12],
      [name(tube.range.min), bottom - 8],
    ] as const) {
      const textWidth = Math.min(labelWidth, c.measureText(text).width);
      c.fillStyle = theme.panel;
      c.fillRect(x - textWidth / 2 - 2, baseline - 8, textWidth + 4, 11);
      c.fillStyle = theme.text;
      c.fillText(text, x, baseline, labelWidth);
    }
  }
  // Onset bubbles use real seconds, independently of playback frame order.
  const sample = tube.sample;
  if (sample && motion.age !== undefined && motion.level !== undefined) {
    const age = motion.age;
    const life = 0.4;
    if (age < life) {
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
          y(motion.level) - (phase * (0.08 + random(seed, i + 5) * 0.1) + i * 0.015) * height;
        c.beginPath();
        c.arc(
          bx,
          Math.min(bottom - 3, Math.max(body.top + 3, by)),
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
  c.fillText('one vessel per setting · pour & settle · last 16 values', 21, 59, w - 170);
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
    c.fillStyle =
      label.rack.sample.active.length && !label.rack.instrument.muted ? theme.text : theme.muted;
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
  for (const tube of layout.tubes) drawTube(c, f, tube, index);
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
