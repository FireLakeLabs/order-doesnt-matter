import type { ViewDefinition, ViewFrame } from './types';
import { indexStage, settingText, type StageIndex } from './soundstage/model';
import { random } from './shared/particles';
import { line } from './shared/retro-2d';
import {
  aquarium,
  dryBowl,
  drySwim,
  identity,
  swim,
  tankLayout,
  type TankBox,
} from './aquarium/model';

const percentage = (now: number) => Math.min(99, Math.floor((now % 1) * 100 + 1e-8));
const counted = (n: number, noun: string) => `${String(n)} ${noun}${n === 1 ? '' : 's'}`;

function fit(c: CanvasRenderingContext2D, text: string, width: number) {
  if (c.measureText(text).width <= width) return text;
  while (text && c.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function text(c: CanvasRenderingContext2D, value: string, x: number, y: number, width: number) {
  c.fillText(fit(c, value, width), x, y);
}
function fish(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  facing: number,
  colour: string,
  f: ViewFrame,
) {
  c.save();
  c.translate(x, y);
  c.scale(size * facing, size);
  c.fillStyle = colour;
  c.strokeStyle = f.theme.ground;
  c.lineWidth = 0.8;
  // Forked tail, rounded body, dorsal and ventral fins, gill and eye.
  c.beginPath();
  c.moveTo(-19, 0);
  c.lineTo(-37, -15);
  c.quadraticCurveTo(-31, 0, -37, 15);
  c.closePath();
  c.fill();
  c.stroke();
  c.beginPath();
  c.moveTo(-10, -7);
  c.quadraticCurveTo(-7, -27, 10, -8);
  c.fill();
  c.beginPath();
  c.moveTo(-1, 8);
  c.lineTo(-7, 21);
  c.lineTo(15, 8);
  c.fill();
  c.beginPath();
  c.ellipse(0, 0, 26, 13, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.beginPath();
  c.moveTo(7, -9);
  c.quadraticCurveTo(-1, 0, 7, 9);
  c.stroke();
  c.fillStyle = f.theme.ground;
  c.beginPath();
  c.arc(16, -4, 2.6, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
function drawDryBowl(c: CanvasRenderingContext2D, f: ViewFrame, box: TankBox) {
  const fishList = box.rooms[0].fish;
  const bowl = dryBowl(box, fishList.length);
  const { x, y, width: w, height: h } = bowl;
  const { theme } = f;
  const legendWidth = Math.min(box.width, Math.max(180, w));
  const legendX = box.x + (box.width - legendWidth) / 2;
  c.fillStyle = theme.panel;
  c.strokeStyle = theme.muted;
  c.lineWidth = 1.5;
  c.beginPath();
  c.roundRect(x, y, w, h, bowl.radius);
  c.fill();
  c.stroke();
  c.save();
  c.clip();
  c.fillStyle = theme.line;
  c.fillRect(x, y + h * 0.85, w, h * 0.15);
  for (let i = 0; i < Math.ceil(w / 9); i++) {
    c.fillStyle = i % 2 ? theme.muted : theme.ground;
    c.beginPath();
    c.ellipse(x + i * 9, y + h - 5 - random(i, 3) * 8, 3.5, 2, i, 0, Math.PI * 2);
    c.fill();
  }
  bowl.paths.forEach((path, i) => {
    const entry = fishList[i];
    const p = drySwim(path, entry.instrument.id, f.now);
    c.globalAlpha = entry.instrument.muted ? 0.3 : 1;
    fish(c, p.x, p.y, path.size, p.facing, entry.instrument.colour, f);
  });
  c.restore();
  c.fillStyle = theme.text;
  c.font = `bold 16px "${theme.fontDisplay}"`;
  text(c, 'Dry bowl', x, box.y + 16, w);
  c.font = `11px "${theme.fontMono}"`;
  text(
    c,
    `${String(fishList.length)} fish · ${fishList.some((p) => p.unknown) ? '? unsampled' : 'no send'}`,
    legendX + 10,
    bowl.legendY + 12,
    legendWidth - 20,
  );
  for (let i = 0; i < bowl.legendRows; i++) {
    const entry = fishList[i];
    const last = i === bowl.legendRows - 1 && fishList.length > bowl.legendRows;
    const label = `${entry.instrument.name}${entry.voices > 1 ? ` ×${String(entry.voices)} voices` : ''}${entry.unknown ? ' ?' : ''}`;
    const withSend = `${label} · send ${entry.voices > 1 ? '≤' : ''}${settingText(entry.send)}`;
    c.fillStyle = entry.instrument.colour;
    if (!last) c.fillRect(legendX + 11, bowl.legendY + 21 + i * 17, 7, 7);
    c.fillStyle = theme.text;
    text(
      c,
      last
        ? bowl.overflow
          ? `+${String(fishList.length - i)} (${String(bowl.overflow)} hidden)`
          : `+${String(fishList.length - i)} fish`
        : c.measureText(withSend).width <= legendWidth - 34
          ? withSend
          : label,
      legendX + (last ? 10 : 24),
      bowl.legendY + 28 + i * 17,
      legendWidth - (last ? 20 : 34),
    );
  }
}
function drawTank(c: CanvasRenderingContext2D, f: ViewFrame, box: TankBox) {
  const { x, y, width: w, height: h, rooms, shelf } = box,
    { theme } = f;
  const merged = rooms.length > 1;
  const fishList = rooms.flatMap((r) => r.fish);
  const requests = rooms.flatMap((r) => r.requests);
  const contested = rooms.some((r) => r.contested);
  const bubbles = rooms.flatMap((r) => r.bubbles);
  const compact = h < 270;
  const legendRows = Math.min(fishList.length, compact ? 1 : shelf ? 2 : 4);
  const footer = 27 + legendRows * 17;
  const waterTop = y + (compact ? 82 : 112),
    floor = y + h - footer;
  const innerX = x + 8,
    innerW = w - 16,
    innerH = Math.max(8, floor - waterTop);
  c.fillStyle = theme.panel;
  c.strokeStyle = theme.muted;
  c.lineWidth = 1.5;
  c.beginPath();
  c.roundRect(x, y + 25, w, h - 25, 7);
  c.fill();
  c.stroke();
  c.save();
  c.beginPath();
  c.rect(innerX, waterTop, innerW, innerH);
  c.clip();
  // Token-coloured water and a moving surface, glass reflection on either side.
  const water = c.createLinearGradient(0, waterTop, 0, floor);
  water.addColorStop(0, theme.line);
  water.addColorStop(1, theme.panel);
  c.fillStyle = water;
  c.fillRect(innerX, waterTop, innerW, innerH);
  c.globalAlpha = 0.35;
  c.fillStyle = theme.text;
  c.fillRect(innerX + 7, waterTop + 5, 3, innerH - 15);
  c.fillRect(innerX + innerW - 13, waterTop + 5, 1, innerH - 15);
  c.globalAlpha = 1;
  const stir = Math.max(
    0,
    ...requests.map((r) => (r.start === null ? 0 : Math.max(0, 1 - (f.now - r.start) / 1.2))),
  );
  c.strokeStyle = theme.muted;
  c.lineWidth = 1.2;
  c.beginPath();
  for (let dx = 0; dx <= innerW; dx += 3) {
    const yy = waterTop + 5 + Math.sin(dx / 23 + f.now * 5) * (2 + stir * 4);
    if (!dx) c.moveTo(innerX + dx, yy);
    else c.lineTo(innerX + dx, yy);
  }
  c.stroke();
  if (stir > 0) {
    c.globalAlpha = 0.35 * stir;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.ellipse(
        x + w / 2,
        waterTop + innerH * (0.28 + i * 0.2),
        innerW * 0.37,
        8 + Math.sin(f.now * 4 + i) * 4,
        0,
        0.2 + (f.now % (Math.PI * 2)),
        Math.PI * 1.7 + (f.now % (Math.PI * 2)),
      );
      c.stroke();
    }
    c.globalAlpha = 1;
  }
  // Gravel and rooted, branching plants make the whole tank read as an aquarium.
  c.fillStyle = theme.line;
  c.fillRect(innerX, floor - 17, innerW, 17);
  for (let i = 0; i < Math.ceil(innerW / 9); i++) {
    c.fillStyle = i % 2 ? theme.muted : theme.ground;
    c.beginPath();
    c.ellipse(innerX + i * 9, floor - 5 - random(i, 3) * 8, 3.5, 2, i, 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = theme.muted;
  c.lineWidth = shelf ? 2 : 3;
  for (let i = 0; i < 5; i++) {
    const px = innerX + innerW * (0.08 + i * 0.21),
      ph = Math.min(innerH * 0.34, 50 + random(i) * 55);
    const sway = Math.sin(f.now * 1.5 + i) * 7;
    c.beginPath();
    c.moveTo(px, floor - 12);
    c.bezierCurveTo(
      px - 12,
      floor - ph * 0.4,
      px + sway + 12,
      floor - ph * 0.8,
      px + sway,
      floor - ph,
    );
    c.stroke();
    for (const side of [-1, 1]) {
      c.beginPath();
      c.moveTo(px, floor - ph * 0.4);
      c.quadraticCurveTo(px + side * 20, floor - ph * 0.7, px + side * 14, floor - ph * 0.8);
      c.stroke();
    }
  }
  const fishSize = Math.max(0.25, Math.min(shelf ? 0.65 : 1.35, innerW / 165, innerH / 100));
  const point = (id: string, now: number) => {
    const p = swim(id, now);
    return {
      x: innerX + 35 * fishSize + p.x * Math.max(1, innerW - 70 * fishSize),
      y: waterTop + 27 * fishSize + p.y * Math.max(1, innerH - 60 * fishSize),
      facing: p.facing,
    };
  };
  // A capped cloud is explicitly counted below; no dense onsets disappear silently.
  let drawn = 0;
  c.strokeStyle = theme.text;
  for (const b of bubbles) {
    const age = (f.now - b.start) / b.life,
      origin = point(b.instrument.id, b.start);
    for (let i = 0; i < b.count && drawn < 120; i++, drawn++) {
      const seed = identity(b.instrument.id) + Math.round(b.start * 65536) + i;
      const bx = origin.x + Math.sin(age * 7 + random(seed) * 6) * 9 + (random(seed, 1) - 0.5) * 28;
      const by = origin.y - age * (origin.y - waterTop + 20) + i * 3;
      c.globalAlpha = (1 - age) * 0.8;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(bx, by, 2 + random(seed, 2) * 3, 0, Math.PI * 2);
      c.stroke();
    }
  }
  c.globalAlpha = 1;
  for (const entry of fishList) {
    const p = point(entry.instrument.id, f.now);
    c.globalAlpha = entry.instrument.muted ? 0.3 : 1;
    fish(c, p.x, p.y, fishSize, p.facing, entry.instrument.colour, f);
  }
  c.restore();
  // All labels live outside the clipped swimming area, on opaque token plates.
  c.fillStyle = theme.text;
  c.font = `bold 16px "${theme.fontDisplay}"`;
  text(
    c,
    merged ? `${String(rooms.length)} rooms` : `Room ${String(rooms[0].orbit)}`,
    x,
    y + 16,
    w,
  );
  c.font = `11px "${theme.fontMono}"`;
  c.fillStyle = theme.panel;
  c.fillRect(x + 2, y + 30, w - 4, compact ? 50 : 80);
  c.fillStyle = theme.text;
  text(
    c,
    contested
      ? 'CONTESTED'
      : requests.length
        ? 'STIRRED · shared requests'
        : 'No size / feedback request',
    x + 10,
    y + 47,
    w - 20,
  );
  if (merged) {
    text(c, `orbits ${rooms.map((r) => String(r.orbit)).join(', ')}`, x + 10, y + 64, w - 20);
    text(
      c,
      `${counted(requests.length, 'request')} · ${String(rooms.filter((r) => r.contested).length)} contested`,
      x + 10,
      y + (compact ? 77 : 81),
      w - 20,
    );
  } else if (requests.length) {
    // Keep both disagreeing authors first, ahead of repeated identical requests.
    const first =
      requests.find((r) =>
        requests.some((other) => other.setting === r.setting && other.value !== r.value),
      ) ?? requests[0];
    const other = requests.find((r) => r.setting === first.setting && r.value !== first.value);
    const ordered = other
      ? [first, other, ...requests.filter((r) => r !== first && r !== other)]
      : requests;
    ordered.slice(0, 2).forEach((r, i) => {
      const at =
        r.start === null
          ? 'constant'
          : `b${String(Math.floor(r.start) + 1)}:${String(percentage(r.start))}%`;
      text(
        c,
        compact
          ? `${r.instrument.name} ${r.setting === 'size' ? 'sz' : 'fb'} ${settingText(r.value)}`
          : `${r.instrument.name} @${at}`,
        x + 10,
        y + 63 + i * (compact ? 15 : 30),
        w - 20,
      );
      if (!compact)
        text(
          c,
          `${r.setting} ${settingText(r.value)}${i === 1 && ordered.length > 2 ? ` · +${counted(ordered.length - 2, 'request')}` : ''}`,
          x + 10,
          y + 76 + i * 30,
          w - 20,
        );
    });
  }
  // The second request's last line ends at y+106, just above the water.
  c.fillStyle = theme.panel;
  c.fillRect(x + 4, floor + 1, w - 8, footer - 6);
  c.fillStyle = theme.text;
  text(
    c,
    `${String(fishList.length)} fish · ${counted(bubbles.length, 'onset')} / ${counted(
      bubbles.reduce((n, b) => n + b.count, 0),
      'bubble',
    )}`,
    x + 10,
    floor + 16,
    w - 20,
  );
  for (let i = 0; i < legendRows; i++) {
    const entry = fishList[i],
      last = i === legendRows - 1 && fishList.length > legendRows;
    c.fillStyle = entry.instrument.colour;
    c.fillRect(x + 11, floor + 25 + i * 17, 7, 7);
    c.fillStyle = theme.text;
    const label = `${entry.instrument.name}${entry.voices > 1 ? ` ×${String(entry.voices)} voices` : ''}${entry.unknown ? ' ?' : ''}`;
    const withSend = `${label} · send ${entry.voices > 1 ? '≤' : ''}${settingText(entry.send)}`;
    text(
      c,
      last
        ? `+${String(fishList.length - i)} fish`
        : c.measureText(withSend).width <= w - 34
          ? withSend
          : label,
      x + 24,
      floor + 32 + i * 17,
      w - 34,
    );
  }
}
function draw(c: CanvasRenderingContext2D, f: ViewFrame, index: StageIndex) {
  const { theme, width: w, height: h } = f;
  c.reset();
  c.scale(f.dpr, f.dpr);
  c.fillStyle = theme.ground;
  c.fillRect(0, 0, w, h);
  const model = aquarium(f, index),
    layout = tankLayout(model.tanks, model.dry, w, h);
  c.fillStyle = theme.text;
  c.font = `bold 25px "${theme.fontDisplay}"`;
  c.fillText('Aquarium', 22, 32);
  c.font = `11px "${theme.fontMono}"`;
  c.textAlign = 'right';
  c.fillText(`bar ${String(Math.floor(f.now) + 1)} · ${String(percentage(f.now))}%`, w - 22, 31);
  c.textAlign = 'left';
  text(
    c,
    `${counted(model.tanks.length, 'tank')} · ${String(model.tanks.reduce((n, t) => n + t.fish.length, 0))} sending fish · rooms are shared${model.tanks.length > 6 ? ' · shelf' : ''}`,
    22,
    55,
    w - 44,
  );
  for (const box of layout.boxes) {
    drawTank(c, f, box);
    c.strokeStyle = theme.line;
    c.lineWidth = 5;
    line(c, box.x - 3, box.y + box.height + 3, box.x + box.width + 3, box.y + box.height + 3);
  }
  if (layout.bowl) drawDryBowl(c, f, layout.bowl);
  if (!model.tanks.length && !model.dry.fish.length)
    c.fillText('No instruments in this section', 22, h / 2);
  c.font = `11px "${theme.fontMono}"`;
  c.fillStyle = theme.text;
  text(
    c,
    w < 700
      ? 'Bubbles = send · shared size / feedback stirs everyone'
      : 'Bubbles = scored send, never a measured tail · size / feedback requests stir everyone in a room',
    22,
    h - 18,
    w - 44,
  );
}
const view: ViewDefinition = {
  id: 'aquarium',
  name: 'Aquarium',
  group: 'settings',
  tag: 'shared rooms',
  needs: 'score',
  span: 'window',
  mount(element) {
    const canvas = document.createElement('canvas'),
      c = canvas.getContext('2d');
    if (!c) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let source: ViewFrame['notes'] | undefined,
      index: StageIndex = new Map();
    return {
      frame(f) {
        if (f.width <= 0 || f.height <= 0) return;
        const w = Math.max(1, Math.round(f.width * f.dpr)),
          h = Math.max(1, Math.round(f.height * f.dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        canvas.style.width = `${String(f.width)}px`;
        canvas.style.height = `${String(f.height)}px`;
        if (source !== f.notes) {
          source = f.notes;
          index = indexStage(f.notes);
        }
        draw(c, f, index);
      },
      dispose() {
        canvas.remove();
        canvas.width = canvas.height = 0;
        source = undefined;
        index.clear();
      },
    };
  },
};
export default view;
