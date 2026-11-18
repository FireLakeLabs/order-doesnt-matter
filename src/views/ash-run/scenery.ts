import type { ViewFrame } from '../types';
import { line } from '../shared/retro-2d';
import { random } from '../shared/particles';
import { district, parallaxRates, type Scene, type Data } from './model';
import { world } from './city';

export const palettes = [
  { wall: '#38262f', rim: '#78515a', dark: '#211820', detail: '#503640' },
  { wall: '#34303b', rim: '#756878', dark: '#1d1923', detail: '#514957' },
  { wall: '#2b2430', rim: '#7a6872', dark: '#141017', detail: '#443844' },
  { wall: '#343033', rim: '#766666', dark: '#1c1b22', detail: '#51464b' },
];
/** Geometry is indexed by distance alone, including towers that carry musical windows. */
type WindowCity = Pick<Scene, 'distance' | 'district' | 'buildings' | 'x' | 'y'>;

export function skyline(f: ViewFrame, s: Pick<Scene, 'distance' | 'district'>, layer: number) {
  const tile = f.width * [0.14, 0.21, 0.28][layer];
  const travel = s.distance * parallaxRates[layer];
  const first = Math.floor(travel / tile) - 1;
  return Array.from({ length: Math.ceil(f.width / tile) + 4 }, (_, offset) => {
    const index = first + offset;
    return {
      index,
      x: index * tile - travel,
      top:
        f.height *
        (s.district.index === 3
          ? 0.57 - random(index * 173 + layer * 31) * 0.08 + layer * 0.045
          : [0.5, 0.59, 0.68][layer] - random(index * 173 + layer * 31) * [0.2, 0.27, 0.2][layer]),
      width: tile * (0.6 + random(index * 277) * 0.3),
    };
  });
}
function facadeWindows(b: ReturnType<typeof skyline>[number]) {
  return Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: Math.max(1, Math.floor((b.width - 20) / 20)) }, (_, column) => ({
      row,
      column,
      x: b.x + 10 + column * 20,
      y: b.top + 12 + row * 18,
    })),
  ).flat();
}
/** All skyline and facade fills are opaque; distance is conveyed by value. */
export function background(c: CanvasRenderingContext2D, f: ViewFrame, s: Scene, layer: number) {
  const colours = ['#49343d', '#352831', '#251e29'];
  for (const { x, top, width, index } of skyline(f, s, layer)) {
    c.fillStyle = colours[layer];
    c.fillRect(x, top, width, f.height - top);
    if (s.district.index === 3) {
      c.beginPath();
      c.moveTo(x, top);
      for (let tooth = 0; tooth < 4; tooth++) {
        c.lineTo(x + (width * (tooth + 0.85)) / 4, top - f.height * 0.025);
        c.lineTo(x + (width * (tooth + 0.85)) / 4, top);
      }
      c.lineTo(x + width, top);
      c.fill();
    }
    if (s.district.index === 0) {
      c.fillRect(x + width * 0.15, top - 16, 7, 17);
      c.fillRect(x + width * 0.75, top - 11, 7, 12);
    }

    c.fillRect(x + width * 0.18, top - 5, width * 0.64, 6);
    if (layer === 1 && index % 3 === 0) {
      c.strokeStyle = colours[layer];
      c.lineWidth = 2;
      line(c, x + width * 0.72, top, x + width * 0.72, top - f.height * 0.08);
    }
    if (layer > 0) {
      c.fillStyle = layer === 1 ? '#54404b' : '#3c303e';
      for (const w of facadeWindows({ x, top, width, index })) c.fillRect(w.x, w.y, 10, 7);
    }
  }
}
function partWindows(f: ViewFrame, s: WindowCity, part: number) {
  const count = Math.max(1, f.instruments.length);
  return [1, 2].flatMap((layer) =>
    skyline(f, s, layer).flatMap((b) => {
      const cells = facadeWindows(b);
      const stripes = Math.ceil(count / cells.length);
      return cells.flatMap((w, ordinal) => {
        if (
          ordinal % count !== part % count &&
          !(part >= cells.length && ordinal === part % cells.length)
        )
          return [];
        const offsetX = w.x - b.x + (Math.floor(part / cells.length) * 10) / stripes;
        return [
          {
            layer,
            building: b.index,
            row: w.row,
            column: w.column,
            offsetX,
            offsetY: w.y - b.top,
            x: b.x + offsetX,
            y: w.y,
            width: 10 / stripes,
          },
        ];
      });
    }),
  );
}
type WindowCell = ReturnType<typeof partWindows>[number];
function visibleWindow(
  f: ViewFrame,
  s: WindowCity,
  w: WindowCell,
  near: ReturnType<typeof skyline>,
) {
  return (
    w.x >= 0 &&
    w.x + w.width <= f.width &&
    !(
      w.layer === 1 &&
      near.some((n) => w.x < n.x + n.width && w.x + w.width > n.x && w.y + 7 >= n.top - 5)
    ) &&
    !s.buildings.some((n) => w.x < s.x(n.end) && w.x + w.width > s.x(n.start) && w.y + 7 >= s.y(n))
  );
}
export function windowLights(f: ViewFrame, s: Scene, data: Data) {
  const near = skyline(f, s, 2);
  const towers = [1, 2].flatMap((layer) => skyline(f, s, layer).map((b) => ({ ...b, layer })));
  return [...data.parts].flatMap(([id, events]) => {
    if ([s.roles.kick, s.roles.snare, s.roles.openHat, s.roles.walker].includes(id)) return [];
    const instrument = f.instruments.find((i) => i.id === id);
    const colour = instrument?.colour ?? f.theme.accent;
    const part = instrument?.index ?? 0;
    const groups = new Map<number, typeof events>();
    for (const e of events) {
      const group = groups.get(e.note.start) ?? [];
      group.push(e);
      groups.set(e.note.start, group);
    }
    return [...groups].flatMap(([start, group]) => {
      if (f.now < start || !group.some((e) => f.now < Math.max(e.note.end, start + f.cps * 0.18)))
        return [];
      // Assign the whole onset group before checking held-note visibility.
      const at = { ...f, now: start };
      const city = { ...world(at), district: district(at) };
      const horizon = skyline(at, city, 2);
      const pool = partWindows(at, city, part).filter((w) => visibleWindow(at, city, w, horizon));
      if (!pool.length) return [];
      const voices = group.toSorted((a, b) => a.seed - b.seed);
      const first = Math.floor(random(voices[0].seed) * pool.length);
      const counts = Array<number>(Math.min(voices.length, pool.length)).fill(0);
      voices.forEach((e, rank) => {
        if (f.now < Math.max(e.note.end, start + f.cps * 0.18))
          counts[Math.min(rank, pool.length - 1)]++;
      });
      return counts.flatMap((count, rank) => {
        if (!count) return [];
        // Continue through the next tower; overflow is counted on the final cell.
        const anchor = pool[(first + rank) % pool.length];
        const b = towers.find((b) => b.layer === anchor.layer && b.index === anchor.building);
        if (!b) return [];
        const light = {
          ...anchor,
          id,
          colour,
          count,
          x: b.x + anchor.offsetX,
          y: b.top + anchor.offsetY,
        };
        return visibleWindow(f, s, light, near) ? [light] : [];
      });
    });
  });
}
export function windows(c: CanvasRenderingContext2D, f: ViewFrame, s: Scene, data: Data) {
  c.save();
  c.textAlign = 'left';
  c.font = `10px "${f.theme.fontMono}"`;
  for (const light of windowLights(f, s, data)) {
    c.fillStyle = light.colour;
    c.fillRect(light.x, light.y, light.width, 7);
    if (light.count > 1) {
      const label = `×${String(light.count)}`;
      const width = c.measureText(label).width + 6;
      const x = Math.max(0, Math.min(f.width - width, light.x));
      c.fillStyle = '#14111c';
      c.fillRect(x, light.y - 11, width, 10);
      c.fillStyle = light.colour;
      c.fillText(label, x + 3, light.y - 3);
    }
  }
  c.restore();
}

export function roofs(c: CanvasRenderingContext2D, f: ViewFrame, s: Scene) {
  const p = palettes[s.district.index];
  const u = s.size;
  for (const b of s.buildings) {
    const x = s.x(b.start),
      right = s.x(b.end),
      y = s.y(b),
      width = right - x;
    if (right < -u || x > f.width + u) continue;
    c.fillStyle = p.wall;
    c.fillRect(x, y, width, f.height - y);
    c.fillStyle = p.rim;
    c.fillRect(x - 2, y, width + 4, u * 0.14);
    c.fillStyle = '#a48a91';
    c.fillRect(x - 2, y, width + 4, 1.5);
    const floor = u * 0.78;
    for (let wy = y + u * 0.56; wy < f.height; wy += floor) {
      c.fillStyle = p.dark;
      c.fillRect(x + u * 0.14, wy, width - u * 0.45, u * 0.27);
      c.strokeStyle = p.wall;
      c.lineWidth = u * 0.06;
      for (let wx = x + u * 0.4; wx < right - u * 0.3; wx += u * 0.44)
        line(c, wx, wy, wx, wy + u * 0.27);
      if (s.district.index === 0) {
        c.strokeStyle = p.detail;
        c.lineWidth = 1;
        line(c, x, wy + u * 0.4, right, wy + u * 0.4);
      }
      if (s.district.index === 1) {
        c.strokeStyle = p.rim;
        c.lineWidth = 3;
        for (let wx = x + u * 0.3; wx < right; wx += u * 1.4)
          line(c, wx, wy - u * 0.5, wx, wy + floor * 0.5);
      }
    }
    // Vents sit behind the running line, so they do not demand unscored jumps.
    const vent = x + width * 0.18;
    c.fillStyle = p.detail;
    c.fillRect(vent, y - u * 0.29, u * 0.78, u * 0.29);
    c.strokeStyle = p.dark;
    c.lineWidth = 2;
    for (let k = 1; k < 3; k++)
      line(c, vent + 5, y - k * u * 0.09, vent + u * 0.7, y - k * u * 0.09);
    const tank = x + width * 0.7;
    if (b.index % 2 === 0) {
      c.strokeStyle = p.dark;
      c.lineWidth = 3;
      line(c, tank, y, tank + u * 0.08, y - u * 0.45);
      line(c, tank + u * 0.55, y, tank + u * 0.47, y - u * 0.45);
      c.fillStyle = p.detail;
      c.beginPath();
      c.moveTo(tank - u * 0.08, y - u * 0.45);
      c.lineTo(tank - u * 0.08, y - u * 1.05);
      c.lineTo(tank + u * 0.27, y - u * 1.29);
      c.lineTo(tank + u * 0.63, y - u * 1.05);
      c.lineTo(tank + u * 0.63, y - u * 0.45);
      c.fill();
      line(c, tank - u * 0.08, y - u * 0.65, tank + u * 0.63, y - u * 0.65);
    } else {
      c.strokeStyle = p.detail;
      c.lineWidth = 3;
      line(c, tank, y, tank, y - u * 1.3);
      line(c, tank - u * 0.18, y - u, tank + u * 0.2, y - u);
      line(c, tank - u * 0.1, y - u * 0.8, tank + u * 0.1, y - u * 0.8);
    }
    // External fire escape makes the facade legible below the roofline.
    c.strokeStyle = p.dark;
    c.lineWidth = 2;
    for (let fy = y + u * 0.4; fy < f.height; fy += floor) {
      line(c, right - u * 0.42, fy, right - u * 0.02, fy);
      line(c, right - u * 0.38, fy, right - u * 0.06, fy + floor);
    }
    line(c, right - u * 0.42, y + u * 0.4, right - u * 0.42, f.height);
    line(c, right - u * 0.02, y + u * 0.4, right - u * 0.02, f.height);
  }
  // District silhouettes: scaffold/crane, office mast, dock gantry or chimneys.
  const period = f.width + 240;
  const travel = s.distance * 0.17 + f.width * 0.09 + 100;
  const x = f.width + 100 - (((travel % period) + period) % period),
    y = f.height * 0.73;
  c.strokeStyle = p.detail;
  c.fillStyle = p.detail;
  c.lineWidth = 4;
  if (s.district.index === 1 || s.district.index === 3) {
    line(c, x, y, x, f.height * 0.23);
    line(c, x + 13, y, x + 13, f.height * 0.23);
    line(c, x - 90, f.height * 0.23, x + 45, f.height * 0.23);
    line(c, x - 65, f.height * 0.23, x - 65, f.height * 0.46);
    c.fillRect(x - 73, f.height * 0.46, 16, 12);
    for (let yy = f.height * 0.26; yy < y; yy += 30) {
      line(c, x, yy, x + 13, yy + 15);
      line(c, x + 13, yy + 15, x, yy + 30);
    }
  }
}
