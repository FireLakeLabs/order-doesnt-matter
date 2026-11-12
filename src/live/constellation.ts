import type { LiveModel } from './model';

type Point = { x: number; y: number };
export type Planet = Point & {
  id: string;
  r: number;
  target: number;
  labelWidth: number;
  inside: boolean;
};
export type Region = {
  orbit: number;
  circles: (Point & { r: number })[];
  links: { from: Point; to: Point }[];
  label: Point & { width: number; height: number };
};
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
/** Equal reservation circles keep centres independent of counts and the clock.
 * Greedy tangencies cluster each room before placing its neighbours. Space is
 * stretched vertically by 1.15 to leave room for labels and onset rings. */
function pack(
  ids: { id: string; room: number | null }[],
  width: number,
  height: number,
  r: number,
  seed: number,
  phase: number,
) {
  const placed: (Point & { id: string; room: number | null })[] = [];
  for (const item of ids) {
    const members = placed.filter((p) => p.room === item.room);
    const anchor = members.length
      ? {
          x: members.reduce((s, p) => s + p.x, 0) / members.length,
          y: members.reduce((s, p) => s + p.y, 0) / members.length,
        }
      : { x: width * seed, y: r };
    const candidates: Point[] = placed.length ? [] : [anchor];
    for (const p of placed)
      for (let k = 0; k < 24; k++) {
        const angle = (k * Math.PI) / 12 + phase;
        candidates.push({ x: p.x + 2 * r * Math.cos(angle), y: p.y + 2 * r * Math.sin(angle) });
      }
    for (let a = 0; a < placed.length; a++)
      for (const b of placed.slice(a + 1)) {
        const p = placed[a],
          d = distance(p, b);
        if (d > 4 * r || d < 0.001) continue;
        const h = Math.sqrt(Math.max(0, 4 * r * r - (d * d) / 4));
        for (const sign of [-1, 1])
          candidates.push({
            x: (p.x + b.x) / 2 + (sign * h * (p.y - b.y)) / d,
            y: (p.y + b.y) / 2 + (sign * h * (b.x - p.x)) / d,
          });
      }
    let best: Point | undefined,
      score = Infinity;
    for (const p of candidates) {
      if (
        p.x < r - 0.001 ||
        p.x > width - r + 0.001 ||
        p.y < r - 0.001 ||
        p.y > height - r + 0.001 ||
        placed.some((q) => distance(p, q) < 2 * r - 0.001)
      )
        continue;
      // A narrow bridge to the nearest member must also miss other rooms.
      const nearest = members.toSorted((a, b) => distance(p, a) - distance(p, b))[0];
      if (
        item.room !== null &&
        nearest &&
        placed.some((q) => q.room !== item.room && segmentDistance(q, p, nearest) < r + 6)
      )
        continue;
      const value = distance(p, anchor) + p.y * 0.08 + Math.abs(p.x - width / 2) * 0.05;
      if (value < score) {
        best = p;
        score = value;
      }
    }
    if (!best) return null;
    placed.push({ ...item, ...best });
  }
  return placed;
}
/** R = sqrt(density * width * height / (pi * count)); density is 0.28 up to
 * ten instruments and falls linearly to 0.17 at thirty. Actual r is R times
 * (0.9 + 0.1 * sqrt(clamp(starts, 0, 32) / 32)). If packing cannot fit, R
 * shrinks in 3% steps. Only the list, rooms and box determine that ceiling. */
export function constellationLayout(model: LiveModel, box: { width: number; height: number }) {
  if (!model.instruments.length)
    return { planets: [] as Planet[], regions: [] as Region[], height: 128 };
  const ids = [
    ...model.rooms.flatMap((room) => room.members.map((id) => ({ id, room: room.orbit }))),
    ...model.instruments.filter((i) => i.room === null).map((i) => ({ id: i.id, room: null })),
  ];
  const density = 0.28 - 0.11 * Math.min(1, Math.max(0, (ids.length - 10) / 20));
  let radius = Math.sqrt((density * box.width * box.height) / (Math.PI * ids.length));
  const top = model.rooms.some((room) => room.members.length) ? 34 : 10;
  function finish(packed: NonNullable<ReturnType<typeof pack>>, radius: number) {
    const minX = Math.min(...packed.map((p) => p.x - radius - 6));
    const maxX = Math.max(...packed.map((p) => p.x + radius + 6));
    const shift = (box.width - maxX + minX) / 2 - minX;
    const centres = packed.map((p) => ({ ...p, x: p.x + shift, y: p.y * 1.15 + top }));
    const instruments = new Map(model.instruments.map((i) => [i.id, i]));
    const planets = centres.map((p) => {
      const i = instruments.get(p.id)!;
      const r = radius * (0.9 + 0.1 * Math.sqrt(Math.min(32, Math.max(0, i.noteStarts ?? 0)) / 32));
      return {
        id: p.id,
        x: p.x,
        y: p.y,
        r,
        target: Math.max(44, 2 * r),
        labelWidth: Math.max(44, 2 * radius + 10),
        inside: i.name.length * 6.4 <= r * 1.7 && r >= 18,
      };
    });
    const regions: Region[] = model.rooms
      .filter((room) => room.members.length)
      .map((room) => {
        const members = centres.filter((p) => p.room === room.orbit);
        const circles = members.map((p) => ({ x: p.x, y: p.y, r: radius + 5 }));
        const links = members.slice(1).map((p, n) => ({
          from: p,
          to: members.slice(0, n + 1).toSorted((a, b) => distance(p, a) - distance(p, b))[0],
        }));
        const left = Math.min(...circles.map((c) => c.x - c.r));
        const upper = Math.min(...circles.map((c) => c.y - c.r));
        return {
          orbit: room.orbit,
          circles,
          links,
          label: {
            x: Math.max(8, left),
            y: Math.max(0, upper - 24),
            width: Math.min(box.width - 16, Math.max(90, 2 * radius + 8)),
            height:
              !room.conflict && (room.reverb === 'varies' || room.delay === 'varies') ? 36 : 24,
          },
        };
      });
    const intersects = (a: Region['label'], b: Region['label']) =>
      a.x < b.x + b.width + 3 &&
      a.x + a.width + 3 > b.x &&
      a.y < b.y + b.height + 3 &&
      a.y + a.height + 3 > b.y;
    const settled: Region['label'][] = [];
    for (const region of regions) {
      const { width, height } = region.label;
      const candidates = region.circles.flatMap((c) => [
        { x: c.x - width / 2, y: c.y - c.r - height - 3 },
        { x: c.x - c.r, y: c.y - c.r - height - 3 },
        { x: c.x - width / 2, y: c.y + c.r + 3 },
        { x: c.x - c.r - width - 3, y: c.y - height / 2 },
        { x: c.x + c.r + 3, y: c.y - height / 2 },
      ]);
      // The edge candidates normally suffice; scanning remaining empty gaps also
      // handles a tiny room tucked between two larger clusters.
      for (let y = 0; y <= box.height - height; y += 6)
        for (let x = 8; x <= box.width - width - 8; x += 6) candidates.push({ x, y });
      const label = candidates
        .map((p) => ({ ...p, width, height }))
        .filter(
          (l) =>
            l.x >= 4 &&
            l.y >= 0 &&
            l.x + width <= box.width - 4 &&
            l.y + height <= box.height &&
            !settled.some((other) => intersects(l, other)) &&
            planets.every((p) => {
              const dx = p.x - Math.max(l.x, Math.min(l.x + width, p.x));
              const dy = p.y - Math.max(l.y, Math.min(l.y + height, p.y));
              const name = {
                x: p.x - p.labelWidth / 2,
                y: p.y + radius + 3,
                width: p.labelWidth,
                height: 14,
              };
              const mark = { x: p.x - 24, y: p.y - radius - 16, width: 48, height: 14 };
              return (
                Math.hypot(dx, dy) > radius + 4 &&
                !intersects(l, name) &&
                (radius * 0.9 >= 18 || !intersects(l, mark))
              );
            }),
        )
        .toSorted((a, b) => {
          const score = (l: Region['label']) =>
            Math.min(
              ...region.circles.map(
                (c) => Math.hypot(c.x - (l.x + width / 2), c.y - (l.y + height / 2)) - c.r,
              ),
            );
          return score(a) - score(b);
        })[0];
      if (!label) return null;
      region.label = label;
      settled.push(region.label);
    }
    const bottom = Math.max(
      ...planets.map((p) => p.y + radius + (p.inside ? 8 : 19)),
      ...regions.map((r) => r.label.y + r.label.height),
    );
    return { planets, regions, height: Math.min(box.height, Math.max(128, bottom + 8)) };
  }
  for (;;) {
    for (const seed of [0.5, 0.33, 0.67])
      for (const phase of [0.23, 0, 0.44]) {
        const packed = pack(
          ids,
          box.width - 16,
          (box.height - top - 14) / 1.15,
          radius + 6,
          seed,
          phase,
        );
        const layout = packed && finish(packed, radius);
        if (layout) return layout;
      }
    radius *= 0.97;
  }
}
/** One filled path unions padded member circles and narrow connecting necks. */
export function regionPath(region: Region) {
  return (
    region.circles
      .map(
        (c) =>
          `M${c.x + c.r},${c.y}a${c.r},${c.r} 0 1 1 ${-2 * c.r},0a${c.r},${c.r} 0 1 1 ${2 * c.r},0Z`,
      )
      .join(' ') +
    region.links
      .map(({ from: a, to: b }) => {
        const d = distance(a, b) || 1,
          x = ((b.y - a.y) * 6) / d,
          y = ((a.x - b.x) * 6) / d;
        return `M${a.x + x},${a.y + y}L${b.x + x},${b.y + y}L${b.x - x},${b.y - y}L${a.x - x},${a.y - y}Z`;
      })
      .join(' ')
  );
}
