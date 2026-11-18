import type { ViewFrame, ViewNote } from '../types';
import { songSummary } from '../shared/song';
import { clamp } from '../shared/math';

export interface Stitch {
  instrument: string;
  start: number; // bar-relative, clockwise from the top-left corner
  end: number;
  onset: boolean;
  carried: boolean;
}
export interface Patch {
  bar: number;
  from: number;
  to: number;
  known: boolean;
  stitches: Stitch[];
  motif: number | null;
}
export interface QuiltRow {
  name: string;
  from: number;
  to: number;
  instruments: string[];
  patches: Patch[];
}
export interface Quilt {
  from: number;
  to: number;
  arranged: boolean;
  rows: QuiltRow[];
  patches: Patch[];
  distinct: number;
  stitches: number;
}
export function quiltRange(frame: ViewFrame): [number, number] {
  const period = frame.sections.at(-1)?.to ?? 16;
  const from = Math.max(0, Math.floor(frame.now / period)) * period;
  return [from, from + period];
}
const rounded = (n: number) => Math.round(n * 1e9) / 1e9;
/** Only repeat identity merges coincident ink; patches retain all source stitches. */
function motifNotes(stitches: Stitch[], instruments: string[]): ViewNote[] {
  const notes: ViewNote[] = [];
  instruments.forEach((instrument, index) => {
    const ring = ringGeometry(1, instruments.length, index);
    for (const carried of [false, true]) {
      const runs: { start: number; end: number; knots: Set<number> }[] = [];
      for (const stitch of stitches) {
        if (stitch.instrument !== instrument || stitch.carried !== carried) continue;
        let run = runs.at(-1);
        if (!run || stitch.start > run.end) {
          run = { start: stitch.start, end: stitch.end, knots: new Set() };
          runs.push(run);
        } else run.end = Math.max(run.end, stitch.end);
        if (stitch.onset) run.knots.add(stitch.start);
      }
      for (const run of runs)
        notes.push({
          instrument,
          start: run.start,
          end: run.end,
          hasOnset: run.knots.has(run.start),
          value: { carried, knots: [...run.knots].sort((a, b) => a - b), ring },
        });
    }
  });
  return notes;
}
function fingerprint(notes: ViewNote[]): number {
  // A bounded candidate index, not equality: shared change resolves hash collisions.
  const text = JSON.stringify(notes);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}
/** Rings compact per section (four-cycle row without sections), never per patch. */
export function indexQuilt(frame: ViewFrame): Quilt {
  const [from, to] = quiltRange(frame);
  const sections = frame.sections.length
    ? frame.sections.map((s) => ({ ...s, from: s.from + from, to: s.to + from }))
    : Array.from({ length: Math.ceil((to - from) / 4) }, (_, i) => ({
        name: 'Cycles',
        from: from + i * 4,
        to: Math.min(to, from + (i + 1) * 4),
      }));
  const order = frame.instruments.slice().sort((a, b) => a.index - b.index);
  const ids = new Set(order.map((i) => i.id));
  const buckets = new Map<number, ViewNote[]>();
  for (const note of frame.notes) {
    if (!ids.has(note.instrument)) continue;
    const start = Math.max(from, frame.from, note.start),
      end = Math.min(to, frame.to, note.end);
    for (let bar = Math.floor(start); start < end && bar < Math.ceil(end); bar++) {
      const bucket = buckets.get(bar) ?? [];
      bucket.push(note);
      buckets.set(bar, bucket);
    }
  }
  let distinct = 0;
  // The fingerprint indexes nonadjacent candidates; shared change===0 decides equality.
  // Only drawn properties participate: pitch/settings do not change a stitched ring.
  const motifs = new Map<number, { id: number; notes: ViewNote[] }[]>();
  const rows = sections.map((section) => {
    const patches: Patch[] = [];
    const members = new Set<string>();
    for (let bar = Math.floor(section.from); bar < Math.ceil(section.to); bar++) {
      const a = Math.max(bar, section.from),
        b = Math.min(bar + 1, section.to);
      const stitches: Stitch[] = [];
      for (const note of buckets.get(bar) ?? []) {
        const start = Math.max(note.start, frame.from, a),
          end = Math.min(note.end, frame.to, b);
        if (end <= start) continue;
        members.add(note.instrument);
        stitches.push({
          instrument: note.instrument,
          start: rounded(start - bar),
          end: rounded(end - bar),
          onset: note.hasOnset && note.start >= a && note.start >= frame.from,
          carried: note.start < bar,
        });
      }
      stitches.sort(
        (x, y) =>
          x.instrument.localeCompare(y.instrument) ||
          x.start - y.start ||
          x.end - y.end ||
          Number(x.onset) - Number(y.onset) ||
          Number(x.carried) - Number(y.carried),
      );
      patches.push({
        bar,
        from: a,
        to: b,
        known: frame.from <= a && frame.to >= b,
        stitches,
        motif: null,
      });
    }
    const instruments = order.filter((i) => members.has(i.id)).map((i) => i.id);
    for (const patch of patches) {
      if (!patch.known) continue;
      const ink = motifNotes(patch.stitches, instruments);
      const key = fingerprint(ink);
      const candidates = motifs.get(key) ?? [];
      const notes = ink.map((n) => ({ ...n, start: n.start + 1, end: n.end + 1 }));
      const previous = candidates.find(
        (candidate) => songSummary([...candidate.notes, ...notes], 1, 2)[0].change === 0,
      );
      if (previous) patch.motif = previous.id;
      else {
        patch.motif = distinct++;
        candidates.push({ id: patch.motif, notes: ink });
        motifs.set(key, candidates);
      }
    }
    return { ...section, instruments, patches };
  });
  const patches = rows.flatMap((row) => row.patches);
  return {
    from,
    to,
    arranged: frame.sections.length > 0,
    rows,
    patches,
    distinct,
    stitches: patches.reduce((sum, p) => sum + p.stitches.length, 0),
  };
}
export function currentPatch(quilt: Quilt, now: number): number {
  let lo = 0,
    hi = quilt.patches.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (quilt.patches[mid].from <= now) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1;
  return i >= 0 && now < quilt.patches[i].to ? i : -1;
}
export function quiltLayout(quilt: Quilt, width: number, height: number) {
  const label = width < 700 ? 92 : 126,
    left = 24 + label,
    top = 70;
  const footer = width < 700 ? 62 : 44,
    gap = 8;
  const max = Math.max(1, ...quilt.rows.map((r) => r.patches.length));
  let columns = 1,
    side = 0;
  for (let count = 1; count <= max; count++) {
    const lines = quilt.rows.reduce((sum, r) => sum + Math.ceil(r.patches.length / count), 0);
    const available = Math.min(
      (width - left - 24 - gap * (count - 1)) / count,
      (height - top - footer - gap * (lines - 1)) / Math.max(1, lines),
    );
    if (available > side) {
      side = available;
      columns = count;
    }
  }
  side = Math.max(0.1, side);
  const cells: { patch: Patch; row: QuiltRow; x: number; y: number }[] = [];
  const labels: {
    row: QuiltRow;
    x: number;
    y: number;
    from: number;
    to: number;
    continued: boolean;
  }[] = [];
  let line = 0;
  for (const row of quilt.rows) {
    for (let start = 0; start < row.patches.length; start += columns) {
      const chunk = row.patches.slice(start, start + columns),
        y = top + line * (side + gap);
      labels.push({
        row,
        x: 24,
        y,
        from: chunk[0].from,
        to: chunk[chunk.length - 1].to,
        continued: start > 0,
      });
      chunk.forEach((patch, i) => cells.push({ patch, row, x: left + i * (side + gap), y }));
      line++;
    }
  }
  return { side, columns, label, top, footer, cells, labels };
}
export type QuiltLayout = ReturnType<typeof quiltLayout>;
export function ringGeometry(side: number, count: number, index: number) {
  const texture = count > 8 && index >= 7;
  const inset =
    count <= 8
      ? side * (0.07 + (index * 0.36) / Math.max(1, count - 1))
      : side *
        (index < 7
          ? 0.07 + (index * 0.23) / 6
          : 0.35 + ((index - 7) * 0.11) / Math.max(1, count - 8));
  const gap = count <= 8 ? (side * 0.36) / Math.max(1, count - 1) : (side * 0.23) / 6;
  return {
    inset,
    length: side - 2 * inset,
    texture,
    stroke: texture ? Math.min(1.1, side * 0.015) : Math.min(side * 0.054, gap * 0.7),
  };
}
export function ringPoint(length: number, time: number): [number, number] {
  const d = clamp(time) * 4 * length;
  if (d <= length) return [d, 0];
  if (d <= 2 * length) return [length, d - length];
  if (d <= 3 * length) return [3 * length - d, length];
  return [0, 4 * length - d];
}
export function ringSegment(length: number, start: number, end: number): [number, number][] {
  const a = clamp(start),
    b = clamp(end);
  const points = [ringPoint(length, a)];
  for (const corner of [0.25, 0.5, 0.75])
    if (corner > a && corner < b) points.push(ringPoint(length, corner));
  points.push(ringPoint(length, b));
  return points;
}

export function stitchAt(stitch: Stitch, phase: number) {
  return { end: Math.min(stitch.end, clamp(phase)), knot: stitch.onset && phase >= stitch.start };
}
