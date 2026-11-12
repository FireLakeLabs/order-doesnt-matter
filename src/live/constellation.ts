import type { LiveModel } from './model';

export type Planet = {
  id: string;
  x: number;
  y: number;
  r: number;
  target: number;
  labelWidth: number;
};
export type Region = {
  orbit: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: { x: number; y: number };
};
/** Disjoint room bands make membership unambiguous, including a separate band
 * for instruments with no room. Neither counts nor the clock affect centres.
 * Radii are 4–11 CSS px, with a tighter upper bound in crowded boxes. */
export function constellationLayout(model: LiveModel, box: { width: number; height: number }) {
  const groups = [
    ...model.rooms.map((r) => ({ orbit: r.orbit, ids: r.members })),
    { orbit: null, ids: model.instruments.filter((i) => i.room === null).map((i) => i.id) },
  ].filter((g) => g.ids.length);
  const planets: Planet[] = [],
    regions: Region[] = [];
  if (!groups.length) return { planets, regions };
  const width = box.width - 16;
  const heading = 30;
  const available = box.height - 16 - groups.filter((g) => g.orbit !== null).length * heading;
  // Choose the grid with the largest minimum spacing. Each room can leave its
  // final row partly empty; its neighbours cannot spill into that room.
  let columns = 1,
    best = 0;
  for (let c = 1; c <= model.instruments.length; c++) {
    const rows = groups.reduce((sum, g) => sum + Math.ceil(g.ids.length / c), 0);
    const spacing = Math.min(width / c, available / rows);
    if (spacing > best) {
      best = spacing;
      columns = c;
    }
  }
  const rowCount = groups.reduce((sum, g) => sum + Math.ceil(g.ids.length / columns), 0);
  const cellHeight = available / rowCount,
    cellWidth = width / columns;
  const named = model.instruments.length <= 12;
  const maxRadius = Math.min(11, (cellHeight - (named ? 18 : 4)) / 2, (cellWidth - 8) / 2);
  const instruments = new Map(model.instruments.map((i) => [i.id, i]));
  let top = 8;
  for (const group of groups) {
    const rows = Math.ceil(group.ids.length / columns);
    const titleHeight = group.orbit === null ? 0 : heading;
    const height = rows * cellHeight + titleHeight;
    if (group.orbit !== null)
      regions.push({
        orbit: group.orbit,
        x: 4,
        y: top - 2,
        width: box.width - 8,
        height: height - 2,
        label: { x: 10, y: top + 2 },
      });
    group.ids.forEach((id, n) => {
      const count = instruments.get(id)?.noteStarts ?? 0;
      const row = Math.floor(n / columns),
        col = n % columns;
      const inRow = Math.min(columns, group.ids.length - row * columns);
      planets.push({
        id,
        x: 8 + (width - inRow * cellWidth) / 2 + (col + 0.5) * cellWidth,
        y: top + titleHeight + (row + 0.5) * cellHeight - (named ? 7 : 0),
        r: Math.max(4, Math.min(maxRadius, 5 + Math.sqrt(count))),
        target: Math.min(44, cellHeight - 2, cellWidth - 2),
        labelWidth: cellWidth - 4,
      });
    });
    top += height;
  }
  return { planets, regions };
}
