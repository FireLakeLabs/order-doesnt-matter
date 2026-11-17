import type { ViewDefinition, ViewFrame, ViewNote } from './types';
import {
  TAU,
  brightness,
  layout,
  moons,
  pulse,
  rhythm,
  type Disc,
  type Layout,
  visibleSettings,
} from './constellation/geometry';

const nameFont = (theme: ViewFrame['theme']) => `13px "${theme.fontDisplay}"`;

const circle = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  c.beginPath();
  c.arc(x, y, Math.max(0, r), 0, TAU);
};
function drawDisc(
  c: CanvasRenderingContext2D,
  disc: Disc,
  frame: ViewFrame,
  notes: ViewNote[],
  bins: Float32Array,
  collapsed: boolean,
) {
  const { theme, now } = frame;
  const { x, y, radius: r, instrument } = disc;
  const flash = instrument.muted ? 0 : pulse(notes, now, frame.cps);
  c.save();
  c.globalAlpha = instrument.muted ? 0.35 : 1;
  c.strokeStyle = instrument.colour;
  c.fillStyle = instrument.colour;
  if (instrument.sounding || flash > 0) {
    c.save();
    c.globalAlpha *= 0.18 + flash * 0.35;
    if (theme.glow) {
      c.shadowColor = instrument.colour;
      c.shadowBlur = 22 + flash * 16;
    }
    c.lineWidth = 2 + flash * 4;
    circle(c, x, y, r + 6 + flash * 5);
    c.stroke();
    c.restore();
  }
  c.globalAlpha *= theme.glow ? 0.12 : 0.18;
  circle(c, x, y, r);
  c.fill();
  c.globalAlpha = instrument.muted ? 0.35 : 1;
  c.lineWidth = 1.5;
  circle(c, x, y, r);
  c.stroke();
  c.save();
  c.globalAlpha *= 0.3;
  circle(c, x, y, r + 30);
  c.setLineDash([2, 5]);
  c.stroke();
  c.restore();
  const ring = r * 0.72;
  c.lineWidth = Math.max(3, r * 0.17);
  c.save();
  c.globalAlpha *= 0.16;
  circle(c, x, y, ring);
  c.stroke();
  c.restore();
  // Adjacent occupied bins are painted as one real-time arc, including all dense notes.
  for (let i = 0; i < bins.length; ) {
    if (!bins[i]) {
      i++;
      continue;
    }
    const start = i;
    let coverage = 0;
    while (i < bins.length && bins[i]) coverage = Math.max(coverage, bins[i++]);
    const a = (start / bins.length - (now - Math.floor(now))) * TAU - Math.PI / 2;
    c.save();
    c.globalAlpha *= 0.35 + coverage * 0.65;
    c.beginPath();
    c.arc(x, y, ring, a, a + ((i - start) / bins.length) * TAU);
    c.stroke();
    c.restore();
  }
  c.fillStyle = theme.text;
  circle(c, x, y - ring, 2.5);
  c.fill();
  const rewrites = instrument.rewrites;
  c.font = `10px "${theme.fontMono}"`;
  c.textAlign = 'center';
  for (let i = 0; i < rewrites.length; i++) {
    const angle = -Math.PI / 2 + (i / rewrites.length) * TAU;
    const rr = rewrites.length === 1 ? 0 : r * 0.4;
    const size = Math.min(18, r * 0.65, Math.max(10, (r * 2) / Math.max(2, rewrites.length)));
    const sx = x + Math.cos(angle) * rr,
      sy = y + Math.sin(angle) * rr;
    c.fillStyle = theme.accent;
    c.fillRect(sx - size / 2, sy - size / 2, size, size);
    c.fillStyle = theme.ground;
    c.fillText(String(i + 1), sx, sy + 3);
  }
  c.font = nameFont(theme);
  c.fillStyle = theme.text;
  c.fillText(instrument.name, x, y + r + 25, disc.cell.w - 12);
  c.font = `11px "${theme.fontMono}"`;
  for (const moon of disc.moons) {
    const moving = moon.setting.kind === 'values' || moon.setting.kind === 'signal';
    c.save();
    c.lineWidth = 1.5;
    c.strokeStyle = instrument.colour;
    c.fillStyle = moving ? instrument.colour : theme.ground;
    c.globalAlpha *= moving ? brightness(notes, moon.setting, now) : 0.85;
    circle(c, moon.x, moon.y, moon.radius);
    c.fill();
    c.stroke();
    c.restore();
    c.fillStyle = theme.text;
    const left = moon.box.x < moon.x - moon.radius - 1;
    c.textAlign = left ? 'right' : 'left';
    c.fillText(moon.label, moon.x + (left ? -1 : 1) * (moon.radius + 6), moon.y + 4);
  }
  if (collapsed) {
    c.textAlign = 'center';
    c.fillStyle = theme.panel;
    c.strokeStyle = instrument.colour;
    circle(c, x + r * 0.8, y - r * 0.7, 13);
    c.fill();
    c.stroke();
    c.fillStyle = theme.text;
    c.fillText(String(visibleSettings(instrument).length), x + r * 0.8, y - r * 0.7 + 4);
  }
  c.restore();
}
function regions(c: CanvasRenderingContext2D, drawing: Layout, frame: ViewFrame) {
  for (const room of frame.rooms) {
    const members = drawing.discs.filter((disc) => room.members.includes(disc.instrument.id));
    if (!members.length) continue;
    const boxes = members.map((disc) => {
      const reach = disc.radius + 45;
      const left = Math.min(disc.x - reach, ...disc.moons.map((m) => m.box.x - 12));
      const right = Math.max(disc.x + reach, ...disc.moons.map((m) => m.box.x + m.box.w + 12));
      const top = Math.min(disc.y - reach, ...disc.moons.map((m) => m.box.y - 12));
      const bottom = Math.max(disc.y + reach, ...disc.moons.map((m) => m.box.y + m.box.h + 12));
      return {
        x: Math.max(disc.cell.x - 4, left),
        y: Math.max(disc.cell.y - 10, top - 16),
        right: Math.min(disc.cell.x + disc.cell.w + 4, right),
        bottom: Math.min(disc.cell.y + disc.cell.h + 4, bottom),
      };
    });
    const x = Math.min(...boxes.map((b) => b.x)),
      y = Math.min(...boxes.map((b) => b.y));
    const right = Math.max(...boxes.map((b) => b.right)),
      bottom = Math.max(...boxes.map((b) => b.bottom));
    const enclosesOther = drawing.discs.some(
      (disc) =>
        !room.members.includes(disc.instrument.id) &&
        disc.x > x &&
        disc.x < right &&
        disc.y > y &&
        disc.y < bottom,
    );
    c.save();
    c.fillStyle = members[0].instrument.colour;
    c.strokeStyle = members[0].instrument.colour;
    c.beginPath();
    if (!enclosesOther) c.roundRect(x, y, right - x, bottom - y, Math.min(50, (bottom - y) / 3));
    else
      for (const box of boxes) c.roundRect(box.x, box.y, box.right - box.x, box.bottom - box.y, 20);
    if (frame.theme.glow) {
      c.shadowColor = members[0].instrument.colour;
      c.shadowBlur = 22;
      c.globalAlpha = 0.07;
      c.fill();
    } else {
      c.globalAlpha = 0.35;
      c.setLineDash([1, 5]);
      c.stroke();
      c.clip();
      c.beginPath();
      for (let dx = x + 10; dx < right; dx += 12)
        for (let dy = y + 10; dy < bottom; dy += 12) c.rect(dx, dy, 1, 1);
      c.fill();
    }
    c.restore();
    c.fillStyle = frame.theme.muted;
    c.font = `11px "${frame.theme.fontMono}"`;
    c.textAlign = 'left';
    c.fillText(`Room ${String(room.orbit)}`, x + 12, y + 14);
  }
}

const view: ViewDefinition = {
  id: 'constellation',
  group: 'settings',
  name: 'Constellation',
  tag: 'settings, rooms',
  span: 'song',
  mount(element) {
    const canvas = document.createElement('canvas');
    element.append(canvas);
    const c = canvas.getContext('2d');
    if (!c) {
      canvas.remove();
      throw Error('Canvas 2D is unavailable');
    }
    let drawing: Layout | undefined;
    let key = '';
    let previousNotes: ViewNote[] | undefined;
    let cycle = NaN;
    let noteMap = new Map<string, ViewNote[]>();
    let rings = new Map<string, Float32Array>();
    let pointer = { x: -1, y: -1 };
    const move = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    const leave = () => {
      pointer = { x: -1, y: -1 };
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    return {
      frame(frame) {
        const { width, height, dpr, theme } = frame;
        if (
          canvas.width !== Math.round(width * dpr) ||
          canvas.height !== Math.round(height * dpr)
        ) {
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
          canvas.style.width = `${String(width)}px`;
          canvas.style.height = `${String(height)}px`;
        }
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.fillStyle = theme.ground;
        c.fillRect(0, 0, canvas.width, canvas.height);
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.font = `11px "${theme.fontMono}"`;
        const measureName = (text: string) => {
          c.save();
          c.font = nameFont(theme);
          const width = c.measureText(text).width;
          c.restore();
          return width;
        };
        const length = frame.sections.at(-1)?.to ?? 0;
        const phase = length ? ((frame.now % length) + length) % length : frame.now;
        const section =
          frame.sections.find((s) => phase >= s.from && phase < s.to)?.from ??
          Math.floor(frame.now / 4) * 4;
        const nextKey = JSON.stringify([
          section,
          width,
          height,
          theme.fontMono,
          theme.fontDisplay,
          frame.instruments.map((i) => [i.id, i.inSection, i.room, i.name, i.settings]),
          frame.rooms,
        ]);
        if (nextKey !== key || previousNotes !== frame.notes) {
          drawing = layout(frame, (text) => c.measureText(text).width, measureName);
          key = nextKey;
        }
        if (previousNotes !== frame.notes || cycle !== Math.floor(frame.now)) {
          if (previousNotes !== frame.notes) {
            noteMap = new Map();
            for (const note of frame.notes) {
              let notes = noteMap.get(note.instrument);
              if (!notes) {
                notes = [];
                noteMap.set(note.instrument, notes);
              }
              notes.push(note);
            }
          }
          cycle = Math.floor(frame.now);
          previousNotes = frame.notes;
          rings = new Map([...noteMap].map(([id, notes]) => [id, rhythm(notes, cycle)]));
        }
        if (!drawing) return;
        // Host flags and palette change independently of the cached spatial arrangement.
        const instruments = new Map(frame.instruments.map((i) => [i.id, i]));
        for (const disc of drawing.discs) {
          const instrument = instruments.get(disc.instrument.id);
          if (instrument) disc.instrument = instrument;
        }
        regions(c, drawing, frame);
        c.fillStyle = theme.muted;
        c.textAlign = 'left';
        c.font = `11px "${theme.fontMono}"`;
        c.fillText('SETTINGS ○ CONSTANT  ● MOVING     REWRITES ▣ IN ORDER', 20, 26, width - 40);
        for (const disc of drawing.discs)
          drawDisc(
            c,
            disc,
            frame,
            noteMap.get(disc.instrument.id) ?? [],
            rings.get(disc.instrument.id) ?? new Float32Array(256),
            drawing.dense,
          );
        if (drawing.dense) {
          const hovered = drawing.discs.find(
            (d) => Math.hypot(pointer.x - d.x, pointer.y - d.y) <= d.radius + 16,
          );
          const box = drawing.detail;
          if (hovered) {
            const enlarged: Disc = {
              ...hovered,
              x: box.x + box.w / 2,
              y: box.y + box.h / 2,
              radius: Math.min(width, height) * 0.07,
              cell: box,
              moons: [],
            };
            c.font = `11px "${theme.fontMono}"`;
            enlarged.moons = moons(enlarged, (text) => c.measureText(text).width, measureName);
            drawDisc(
              c,
              enlarged,
              frame,
              noteMap.get(hovered.instrument.id) ?? [],
              rings.get(hovered.instrument.id) ?? new Float32Array(256),
              false,
            );
          } else {
            c.fillStyle = theme.muted;
            c.textAlign = 'center';
            c.fillText('Hover a disc to unfold its settings', box.x + box.w / 2, box.y + box.h / 2);
          }
        }
        if (drawing.resting.length) {
          const box = drawing.rest;
          c.textAlign = 'left';
          c.font = `11px "${theme.fontMono}"`;
          c.fillStyle = theme.muted;
          c.fillText('Resting in this section', box.x, box.y);
          const cols = width >= 900 ? 1 : 3;
          for (const [index, instrument] of drawing.resting.entries()) {
            const x = box.x + ((index % cols) * box.w) / cols,
              y = box.y + 26 + Math.floor(index / cols) * 22;
            c.strokeStyle = theme.muted;
            circle(c, x + 4, y - 4, 3);
            c.stroke();
            c.fillText(instrument.name, x + 14, y, box.w / cols - 20);
          }
        }
      },
      dispose() {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerleave', leave);
        canvas.remove();
        canvas.width = 0;
        canvas.height = 0;
        drawing = undefined;
        noteMap.clear();
        rings.clear();
        previousNotes = undefined;
      },
    };
  },
};
export default view;
