import type { ViewFrame, ViewNote } from '../types';
import { songSummary } from '../shared/song';
import { clamp } from '../shared/math';

export interface Piece {
  bar: number;
  known: boolean;
  notes: ViewNote[]; // clipped, bar-relative, including every setting and source fragment
  match: number | null; // earliest equal bar; never an approximate match
  section: string;
}
export interface Stacker {
  from: number;
  to: number;
  pieces: Piece[];
  arranged: boolean;
  order: string[];
}
export function stackerRange(frame: ViewFrame): [number, number] {
  const period = frame.sections.at(-1)?.to ?? 16;
  const from = Math.max(0, Math.floor(frame.now / period)) * period;
  return [from, from + period];
}
/** Comparison uses the shared multiset equality, including pitch, sampled settings,
 * onset and 1e-9 cycle relative timing. No setting is omitted to force clears. */
export function indexStacker(frame: ViewFrame): Stacker {
  const [from, to] = stackerRange(frame);
  const order = frame.instruments
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((i) => i.id);
  const pieces: Piece[] = [];
  for (let bar = from; bar < to; bar++) {
    const notes = frame.notes
      .filter((n) => n.start < bar + 1 && n.end > bar)
      .map((n) => ({
        ...n,
        start: Math.max(n.start, bar) - bar,
        end: Math.min(n.end, bar + 1) - bar,
        hasOnset: n.hasOnset && n.start >= bar,
      }));
    const known = frame.from <= bar && frame.to >= bar + 1;
    const candidate = known
      ? pieces.find(
          (p) =>
            p.known &&
            p.notes.length === notes.length &&
            songSummary(
              [...p.notes, ...notes.map((n) => ({ ...n, start: n.start + 1, end: n.end + 1 }))],
              1,
              2,
            )[0].change === 0,
        )
      : undefined;
    pieces.push({
      bar,
      known,
      notes,
      match: candidate?.bar ?? null,
      section:
        frame.sections.find((s) => bar - from >= s.from && bar - from < s.to)?.name ??
        'Unsectioned',
    });
  }
  return { from, to, pieces, order, arranged: frame.sections.length > 0 };
}
/** Prefix only: repeats clear the incoming piece; original material remains.
 * Buried pieces remain in this model and participate in future comparisons. */
export function stackAt(score: Stacker, now: number, capacity: number) {
  const completed = score.pieces.filter((p) => p.bar + 1 <= now);
  const stack = completed.filter((p) => p.known && p.match === null);
  const clears = completed.filter((p) => p.known && p.match !== null);
  const current = score.pieces.find((p) => p.bar <= now && now < p.bar + 1);
  const buried = Math.max(0, stack.length - capacity);
  return {
    completed,
    stack,
    clears,
    buried,
    visible: stack.slice(buried),
    current,
    next: current
      ? (score.pieces.find((p) => p.bar === current.bar + 1) ??
        (score.arranged ? score.pieces[0] : undefined))
      : undefined,
    phase: clamp(now - (current?.bar ?? now)),
    flash: clears.at(-1)?.bar === Math.floor(now) - 1 && now % 1 < 0.28 ? clears.at(-1) : undefined,
    unknown: completed.filter((p) => !p.known).length,
  };
}
/** Oldest unique bars scroll below the visible floor; reserve three compact
 * rows for the enlarged falling piece. Buried rows stay counted, never deleted. */
export function stackerLayout(width: number, height: number, parts: number) {
  const narrow = width < 700;
  const x = narrow ? 36 : Math.max(140, width * 0.17);
  const right = narrow ? 148 : Math.max(180, width * 0.21);
  const top = 74,
    bottom = height - 48;
  const wellWidth = Math.max(1, width - x - right);
  const pieceHeight = Math.max(26, parts * 1.7 + 7);
  const capacity = Math.max(1, Math.floor((bottom - top) / pieceHeight) - 3);
  return { x, top, bottom, wellWidth, pieceHeight, capacity, side: x + wellWidth + 22, narrow };
}
export interface Patch {
  start: number;
  end: number;
  count: number;
}
/** Fixed part rows and real endpoints. Only overlapping or visually inseparable
 * spans merge; their counts conserve every note, including coincident chords. */
export function notePatches(piece: Piece, instrument: string, width: number): Patch[] {
  const notes = piece.notes
    .filter((n) => n.instrument === instrument)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const patches: Patch[] = [];
  for (const n of notes) {
    const last = patches.at(-1);
    if (last && (n.start < last.end || (n.start - last.start) * width < 3)) {
      last.end = Math.max(last.end, n.end);
      last.count++;
    } else patches.push({ start: n.start, end: n.end, count: 1 });
  }
  return patches;
}
