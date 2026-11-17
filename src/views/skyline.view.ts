import type { ViewDefinition, ViewFrame } from './types';
import { cityLayout, cityRange, cityReadout, floorInk, indexCity } from './skyline/model';
import type { City, CityLayout } from './skyline/model';
import { random } from './shared/particles';

type PaintedFloor = ReturnType<typeof floorInk> & {
  colour: string;
  x: number;
  y: number;
  bar: number;
};
function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text.length && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function drawBase(ctx: CanvasRenderingContext2D, city: City, box: CityLayout, frame: ViewFrame) {
  const { width, height, theme } = frame;
  const pocket = theme.name === 'pocket';
  const sky = ctx.createLinearGradient(0, 0, 0, box.street);
  sky.addColorStop(0, theme.ground);
  sky.addColorStop(1, theme.panel);
  ctx.fillStyle = pocket ? theme.ground : sky;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = theme.text;
  for (let n = 0; n < 24; n++) {
    ctx.globalAlpha = pocket ? 1 : 0.2 + random(n, 2) * 0.3;
    ctx.fillRect(
      24 + random(n) * (width - 48),
      box.top + random(n, 1) * (box.street - box.top) * 0.6,
      1,
      1,
    );
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  ctx.font = `22px "${theme.fontDisplay}"`;
  ctx.fillStyle = theme.text;
  ctx.fillText('Skyline', 24, 32);
  ctx.font = `10px "${theme.fontMono}"`;
  const cell = (width - 48) / box.columns;
  frame.instruments
    .slice()
    .sort((a, b) => a.index - b.index)
    .forEach((row, i) => {
      const x = 24 + (i % box.columns) * cell,
        y = 56 + Math.floor(i / box.columns) * 16;
      ctx.fillStyle = row.colour;
      ctx.fillRect(x, y - 7, 6, 7);
      ctx.fillStyle = theme.muted;
      ctx.fillText(fit(ctx, row.name, cell - 18), x + 12, y);
    });
  if (city.buildings.some((b) => b.knownFrom > b.bar || b.knownTo < b.bar + 1)) {
    ctx.fillStyle = theme.muted;
    ctx.fillText('UNASKED CYCLES · SCAFFOLD', 24, box.top - 16);
  }
  for (const building of city.buildings) {
    const x = box.x(building.bar),
      h = Math.max(5, building.floors.length * box.pitch + 8);
    ctx.fillStyle = theme.panel;
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1;
    ctx.fillRect(x, box.street - h, box.buildingWidth, h);
    ctx.strokeRect(x, box.street - h, box.buildingWidth, h);
    // Coverage, rather than empty notes, distinguishes scaffolding from silence.
    const known = building.knownTo > building.knownFrom;
    const unknown = known
      ? [
          [building.bar, building.knownFrom],
          [building.knownTo, building.bar + 1],
        ]
      : [[building.bar, building.bar + 1]];
    for (const [a, b] of unknown) {
      if (b <= a) continue;
      const left = x + (a - building.bar) * box.buildingWidth;
      const w = (b - a) * box.buildingWidth,
        sh = box.street - box.top;
      ctx.strokeStyle = theme.muted;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(left, box.top, w, sh);
      ctx.setLineDash([]);
      for (let y = box.top; y < box.street; y += 24) {
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + w, Math.min(box.street, y + 24));
        ctx.moveTo(left + w, y);
        ctx.lineTo(left, Math.min(box.street, y + 24));
        ctx.stroke();
      }
    }
  }
  ctx.fillStyle = theme.panel;
  ctx.fillRect(0, box.street + 1, width, height - box.street);
  ctx.strokeStyle = theme.line;
  ctx.beginPath();
  ctx.moveTo(0, box.street);
  ctx.lineTo(width, box.street);
  ctx.stroke();
  ctx.font = `11px "${theme.fontMono}"`;
  for (const district of city.districts) {
    const left = box.x(district.from),
      right = box.x(district.to) - box.step * 0.12;
    const y = height - 48;
    ctx.strokeStyle = theme.muted;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.text;
    ctx.fillText(
      fit(ctx, district.name.toUpperCase(), right - left - 4),
      (left + right) / 2,
      y + 16,
    );
  }
  if (!city.arranged) {
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.muted;
    ctx.fillText(`${String(city.from + 1)}–${String(city.to)} · SAMPLED CYCLES`, 24, height - 34);
  }
}
function drawWindows(
  ctx: CanvasRenderingContext2D,
  floors: PaintedFloor[],
  box: CityLayout,
  frame: ViewFrame,
) {
  const { theme, now, height } = frame;
  const pocket = theme.name === 'pocket',
    print = pocket || theme.name === 'riso';
  for (const floor of floors) {
    for (const window of floor.windows) {
      const lit = window.start <= now;
      const current = Math.floor(now) === floor.bar;
      const active = !floor.dense && lit && now < window.end && current;
      const x = floor.x + window.x;
      const gap = floor.dense ? 0 : Math.min(1, window.width * 0.18);
      const w = Math.max(0.01, window.width - gap),
        h = box.windowHeight;
      ctx.fillStyle = floor.colour;
      ctx.strokeStyle = print && !lit ? theme.line : floor.colour;
      ctx.globalAlpha = print ? 1 : lit ? (current ? (active ? 1 : 0.85) : 0.55) : 0.12;
      if (active && theme.glow) {
        ctx.shadowColor = floor.colour;
        ctx.shadowBlur = 8;
      }
      if (print && !lit) {
        ctx.lineWidth = 1;
        if (floor.dense) {
          ctx.beginPath();
          ctx.moveTo(x, floor.y + h / 2);
          ctx.lineTo(x + w, floor.y + h / 2);
          ctx.stroke();
        } else ctx.strokeRect(x, floor.y, Math.max(0.1, w - 1), h);
      } else ctx.fillRect(x, floor.y, w, h);
      ctx.shadowBlur = 0;
      // A shallow reflection keeps the city legible without competing with districts.
      const reflectedY = box.street + (box.street - floor.y - h) * 0.1 + 3;
      if (reflectedY + h * 0.1 < height - 55 && lit) {
        ctx.globalAlpha = pocket ? 1 : 0.18;
        ctx.fillRect(x, reflectedY, w, pocket ? 1 : h * 0.1);
      }
    }
  }
  ctx.globalAlpha = 1;
}
function drawLive(
  ctx: CanvasRenderingContext2D,
  city: City,
  box: CityLayout,
  floors: PaintedFloor[],
  frame: ViewFrame,
) {
  const { now, theme, width, height } = frame;
  const bar = Math.floor(now),
    x = box.x(bar) + box.inset + (now - bar) * box.innerWidth;
  ctx.save();
  ctx.beginPath();
  ctx.rect(24, box.top - 12, width - 48, box.street - box.top + 12);
  ctx.clip();
  ctx.strokeStyle = theme.accent;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.moveTo(x, box.street);
  ctx.lineTo(x - 55, box.top - 12);
  ctx.lineTo(x + 55, box.top - 12);
  ctx.closePath();
  if (theme.name === 'pocket') {
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    ctx.globalAlpha = 0.09;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(x, box.street);
  ctx.lineTo(x, box.top - 12);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  drawWindows(ctx, floors, box, frame);
  ctx.textAlign = 'right';
  ctx.font = `11px "${theme.fontMono}"`;
  ctx.fillStyle = theme.accent;
  ctx.fillText(
    `bar ${String(bar + 1)}${city.arranged ? ` of ${String(city.to)}` : ''} · ${String(Math.round((now - bar) * 100))}%`,
    width - 24,
    30,
  );
  const counts = cityReadout(city, now);
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.muted;
  ctx.font = `10px "${theme.fontMono}"`;
  const dense = floors.some((floor) => floor.dense);
  ctx.fillText(
    `LIT ${String(counts.lit)}/${String(counts.total)} WINDOWS · BAR ${String(bar + 1)}: ${String(counts.currentLit)}/${String(counts.currentTotal)}`,
    24,
    height - 12,
  );
  if (width > 850) {
    ctx.textAlign = 'right';
    ctx.fillText(
      city.silhouette
        ? 'SILHOUETTE · ALL NOTES COUNTED'
        : dense
          ? 'DENSE FLOORS → BANDS'
          : 'ONE WINDOW PER NOTE',
      width - 24,
      height - 12,
    );
  }
}
const view: ViewDefinition = {
  id: 'skyline',
  name: 'Skyline',
  group: 'song',
  tag: 'whole song',
  span: 'song',
  mount(element) {
    const canvas = document.createElement('canvas'),
      backing = document.createElement('canvas');
    const ctx = canvas.getContext('2d'),
      base = backing.getContext('2d');
    if (!ctx || !base) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let city: City | undefined, notes: ViewFrame['notes'] | undefined;
    let box: CityLayout | undefined,
      floors: PaintedFloor[] = [];
    let scoreKey = '',
      paintKey = '';
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const nextScore = JSON.stringify([
          cityRange(frame),
          frame.from,
          frame.to,
          frame.sections,
          frame.instruments.map(({ id, index }) => [id, index]),
        ]);
        const changed = !city || notes !== frame.notes || scoreKey !== nextScore;
        if (changed) {
          city = indexCity(frame);
          notes = frame.notes;
          scoreKey = nextScore;
        }
        if (!city) return;
        const nextPaint = JSON.stringify([
          frame.width,
          frame.height,
          frame.dpr,
          frame.theme,
          document.fonts.check(`12px "${frame.theme.fontMono}"`),
          document.fonts.check(`22px "${frame.theme.fontDisplay}"`),
          frame.instruments.map(({ id, name, colour }) => [id, name, colour]),
        ]);
        if (changed || nextPaint !== paintKey) {
          const layout = cityLayout(city, frame.width, frame.height, frame.instruments.length);
          box = layout;
          const silhouette = city.silhouette;
          const colours = new Map(frame.instruments.map((i) => [i.id, i.colour]));
          floors = city.buildings.flatMap((building) =>
            building.floors.map((floor, i) => ({
              ...floorInk(floor, building.bar, layout.innerWidth, silhouette),
              colour: colours.get(floor.instrument) ?? frame.theme.text,
              bar: building.bar,
              x: layout.x(building.bar) + layout.inset,
              y: layout.y(i),
            })),
          );
          canvas.width = backing.width = Math.max(1, Math.round(frame.width * frame.dpr));
          canvas.height = backing.height = Math.max(1, Math.round(frame.height * frame.dpr));
          canvas.style.width = `${String(frame.width)}px`;
          canvas.style.height = `${String(frame.height)}px`;
          base.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
          drawBase(base, city, box, frame);
          paintKey = nextPaint;
        }
        if (!box) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(backing, 0, 0);
        ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
        drawLive(ctx, city, box, floors, frame);
      },
      dispose() {
        canvas.remove();
        canvas.width = backing.width = 0;
        canvas.height = backing.height = 0;
        city = undefined;
        notes = undefined;
        box = undefined;
        floors = [];
      },
    };
  },
};
export default view;
