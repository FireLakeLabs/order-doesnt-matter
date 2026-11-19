import type { ViewFrame, ViewNote } from '../types';
import { scoredNotes } from '../shared/scored-notes';
import { roleEvidence } from '../shared/roles';
import { pitch } from '../shared/pitch';
import { clamp } from '../shared/math';

export const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export function gardenRange(f: ViewFrame): [number, number] {
  const length = f.sections.at(-1)?.to ?? 16;
  const from = Math.max(0, Math.floor(f.now / length)) * length;
  return [from, from + length];
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function seed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
const number = (v: unknown, fallback: number) => {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n) ? n : fallback;
};
export function leafStyle(n: ViewNote) {
  const settings = Object.fromEntries(
    Object.entries(n.value).filter(
      ([k]) => !['note', 'n', 'freq', 'gain', 'room', 'orbit'].includes(k),
    ),
  );
  const shape = seed(canonical(settings));
  return {
    pitch: pitch(n.value),
    gain: clamp(number(n.value.gain, 1), 0, 2),
    send: clamp(number(n.value.room, 0)),
    shape,
    // Bar-relative identity makes exact repeated material grow the same sprig.
    curl:
      seed(
        canonical([
          n.instrument,
          Math.round((n.start - Math.floor(n.start)) * 1e9),
          pitch(n.value),
          settings,
        ]),
      ) / 0xffffffff,
  };
}
export function indexGarden(f: ViewFrame) {
  const [from, to] = gardenRange(f);
  const records = f.notes.filter((n) => n.start < to && n.end > from);
  const notes = scoredNotes(records);
  const evidence = roleEvidence(notes);
  const ids = new Set([...f.instruments.map((p) => p.id), ...notes.map((n) => n.instrument)]);
  const ordered = [...ids].sort(
    (a, b) =>
      (f.instruments.find((p) => p.id === a)?.index ?? Infinity) -
        (f.instruments.find((p) => p.id === b)?.index ?? Infinity) || a.localeCompare(b),
  );
  const plants = ordered.map((id, index) => {
    const e = evidence.get(id);
    const leaves = notes
      .filter((n) => n.instrument === id)
      .map((note) => ({ note, ...leafStyle(note) }))
      .sort(
        (a, b) => a.note.start - b.note.start || canonical(a.note).localeCompare(canonical(b.note)),
      );
    return { id, index, low: e?.low ?? Infinity, high: e?.high ?? -Infinity, leaves };
  });
  const sections = f.sections.length
    ? f.sections.map((s, index) => ({
        ...s,
        from: s.from + from,
        to: s.to + from,
        season: index % 4,
      }))
    : [{ name: 'Queried cycles', from, to, season: 0 }];
  return {
    from,
    to,
    plants,
    sections,
    total: notes.length,
    continuations: records.length - notes.length,
    fragments: notes.filter((n) => !n.hasOnset).length,
    knownFrom: Math.max(from, f.from),
    knownTo: Math.min(to, f.to),
  };
}
export type Garden = ReturnType<typeof indexGarden>;
export type Plant = Garden['plants'][number];
export type Leaf = Plant['leaves'][number];
export function gardenLayout(g: Garden, width: number, height: number) {
  const left = width < 700 ? 62 : 82,
    right = width - 28;
  const columns = Math.max(1, Math.floor((width - 32) / 155));
  const legendRows = Math.ceil(g.plants.length / columns);
  const bottom = height - 66 - legendRows * 19;
  const top = 118;
  const band = Math.max(1, (bottom - top) / Math.max(1, g.plants.length));
  const x = (time: number) => left + ((time - g.from) / (g.to - g.from)) * (right - left);
  const weights = g.plants.map((p) => (Number.isFinite(p.low) && p.high > p.low ? 3 : 1));
  const unit =
    (bottom - top) /
    Math.max(
      1,
      weights.reduce((a, v) => a + v, 0),
    );
  const plantBand = (p: Plant) => Math.max(1, unit * weights[p.index]);
  const base = (p: Plant) =>
    top + unit * weights.slice(0, p.index).reduce((a, v) => a + v, 0) + plantBand(p) * 0.92;
  // Each plant bends independently. Guides follow the same curve, so pitch is
  // a fixed vertical distance above its own vine, regardless of sibling lifetimes.
  const vineY = (p: Plant, time: number) =>
    base(p) +
    Math.sin(((time - g.from) * Math.PI) / 2 + (seed(p.id) / 0xffffffff) * Math.PI * 2) *
      Math.min(10, plantBand(p) * 0.16);
  const y = (p: Plant, midi: number | undefined, time = g.from) =>
    vineY(p, Math.floor(time)) -
    plantBand(p) *
      (midi === undefined ? 0.3 : 0.12 + (0.65 * (midi - p.low)) / Math.max(1, p.high - p.low));
  const sprigY = (p: Plant, time: number) =>
    vineY(p, Math.floor(time)) +
    Math.sin((time - Math.floor(time)) * Math.PI * 2) * Math.min(4, plantBand(p) * 0.1);
  return {
    left,
    right,
    top,
    bottom,
    band,
    columns,
    legendRows,
    x,
    base,
    y,
    vineY,
    sprigY,
    plantBand,
  };
}
export type Layout = ReturnType<typeof gardenLayout>;
/** One gain scale for the whole garden, independent of the space a plant needs for pitch. */
export function leafRadius(gain: number, box: Layout) {
  return Math.max(5, Math.min(13, box.band * 0.4)) * (0.35 + Math.sqrt(gain) * 0.7);
}
/** Fixed time bins and exact pitch. Every member remains available for counts and inspection. */
export function leafClusters(g: Garden, box: Layout) {
  const binsPerBar = Math.max(1, Math.floor((box.right - box.left) / (g.to - g.from) / 21));
  return g.plants.flatMap((plant) => {
    const groups = new Map<string, Leaf[]>();
    for (const leaf of plant.leaves) {
      const start = Math.max(g.from, leaf.note.start);
      const bin = Math.floor((start - g.from) * binsPerBar + 1e-9);
      const key = `${String(bin)}:${String(leaf.pitch)}`;
      const group = groups.get(key) ?? [];
      group.push(leaf);
      groups.set(key, group);
    }
    return [...groups.values()].map((leaves) => ({
      plant,
      leaves,
      start: Math.min(...leaves.map((l) => Math.max(g.from, l.note.start))),
      end: Math.max(...leaves.map((l) => l.note.start)),
      pitch: leaves[0].pitch,
      gain: Math.max(...leaves.map((l) => l.gain)),
      send: Math.max(...leaves.map((l) => l.send)),
      shapes: [...new Set(leaves.map((l) => l.shape))],
    }));
  });
}
export type Cluster = ReturnType<typeof leafClusters>[number];
export function gardenMoment(g: Garden, clusters: Cluster[], now: number) {
  const grown = g.plants.reduce(
    (n, p) => n + p.leaves.filter((l) => l.note.start <= now).length,
    0,
  );
  const crowded = clusters.filter((c) => c.leaves.length > 1);
  return {
    plants: g.plants.length,
    season: seasons[g.sections.find((s) => s.from <= now && s.to > now)?.season ?? 0],
    grown,
    total: g.total,
    waiting: g.total - grown,
    clusters: crowded.length,
    clusteredLeaves: crowded.reduce((n, c) => n + c.leaves.length, 0),
  };
}

/** Reserve real clear space beside blooms; a hidden tag stays in the footer total. */
export function clusterTags(clusters: Cluster[], box: Layout, measure: (text: string) => number) {
  const blooms = clusters.map((cluster) => {
    const x = box.x(cluster.start),
      y = box.y(cluster.plant, cluster.pitch, cluster.start);
    const r = leafRadius(cluster.gain, box);
    return {
      left: x - 2.4 * r - 3,
      right: x + 2.4 * r + 3,
      top: y - 2 * r - 3,
      bottom: y + 1.2 * r + 3,
    };
  });
  const placed: { cluster: Cluster; x: number; y: number; width: number }[] = [];
  let hidden = 0;
  clusters.forEach((cluster, i) => {
    if (cluster.leaves.length < 2) return;
    const n = String(cluster.leaves.length),
      width = measure(`${n}/${n}`) + 8;
    const bloom = blooms[i],
      cx = box.x(cluster.start),
      cy = box.y(cluster.plant, cluster.pitch, cluster.start);
    const choices = [
      [bloom.right + 6, cy + 4],
      [bloom.left - width - 3, cy + 4],
      [cx - width / 2, bloom.top - 6],
      [cx - width / 2, bloom.bottom + 18],
    ];
    const choice = choices.find(([x, y]) => {
      const left = x - 3,
        right = left + width,
        top = y - 12,
        bottom = y + 4;
      if (left < box.left || right > box.right || top < box.top || bottom > box.bottom)
        return false;
      if (blooms.some((b) => left < b.right && right > b.left && top < b.bottom && bottom > b.top))
        return false;
      return !placed.some(
        (p) => left < p.x - 3 + p.width && right > p.x - 3 && top < p.y + 4 && bottom > p.y - 12,
      );
    });
    if (choice) placed.push({ cluster, x: choice[0], y: choice[1], width });
    else hidden++;
  });
  return { placed, hidden };
}
export type ClusterTags = ReturnType<typeof clusterTags>;
