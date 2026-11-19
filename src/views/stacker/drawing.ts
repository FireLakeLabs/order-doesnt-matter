import type { Piece, Stacker } from './model';
import { notePatches, stackAt, stackerLayout } from './model';
import { clamp } from '../shared/math';

// Bar number and density badges live beyond the note-span field.
const GUTTER = 68;

export interface Block {
  instrument: string;
  lane: number;
  band: number;
  bands: number;
  start: number;
  end: number;
  count: number;
}
export interface Form {
  piece: Piece;
  first: number;
  rows: number;
  blocks: Block[];
  crowded: number;
}
/** A part owns index % 6, independent of which siblings end or sound. Only the
 * whole rigid piece is cropped to its occupied lane bounds. Simultaneous parts
 * sharing a lane become a counted, coloured band texture inside that block row. */
export function pieceForm(piece: Piece, order: string[], width: number): Form {
  const blocks: Block[] = [];
  let first = 6,
    last = -1,
    crowded = 0;
  for (let lane = 0; lane < 6; lane++) {
    const members = order.filter(
      (id, index) => index % 6 === lane && piece.notes.some((n) => n.instrument === id),
    );
    members.forEach((id, band) => {
      for (const patch of notePatches(piece, id, width)) {
        blocks.push({ ...patch, instrument: id, lane, band, bands: members.length });
        if (patch.count > 1 || members.length > 1) crowded += patch.count;
        first = Math.min(first, lane);
        last = Math.max(last, lane);
      }
    });
  }
  return {
    piece,
    first: last < 0 ? 0 : first,
    rows: last < 0 ? 1 : last - first + 1,
    blocks,
    crowded,
  };
}
export function formIndex(score: Stacker, width: number, height: number) {
  const inkWidth = Math.max(1, stackerLayout(width, height, score.order.length).wellWidth - GUTTER);
  return new Map(score.pieces.map((p) => [p.bar, pieceForm(p, score.order, inkWidth)]));
}
/** Drawing capacity only: the music model, its logical prefix and repeat identity
 * are untouched. Reserve a current piece and 64 px of falling room, then fit the
 * newest complete rigid pieces. Their part rows stay 14–22 CSS px tall. */
export function drawingLayout(
  score: Stacker,
  now: number,
  width: number,
  height: number,
  forms = formIndex(score, width, height),
) {
  const box = stackerLayout(width, height, score.order.length);
  const inkWidth = Math.max(1, box.wellWidth - GUTTER);
  const cell = Math.max(14, Math.min(22, (box.bottom - box.top) / 28));
  const all = stackAt(score, now, score.pieces.length);
  const current = all.current ? forms.get(all.current.bar) : undefined;
  const currentHeight = (current?.rows ?? 1) * cell;
  const budget = Math.max(0, box.bottom - box.top - currentHeight - 64);
  let capacity = 0,
    pixels = 0;
  for (const p of all.stack.slice().reverse()) {
    const h = (forms.get(p.bar)?.rows ?? 1) * cell;
    if (pixels + h > budget) break;
    pixels += h;
    capacity++;
  }
  const state = stackAt(score, now, capacity);
  let y = box.bottom;
  const placed = state.visible.map((p) => {
    const form = forms.get(p.bar) ?? pieceForm(p, score.order, inkWidth);
    y -= form.rows * cell;
    return { form, y };
  });
  const flash = state.flash ? forms.get(state.flash.bar) : undefined;
  // Insert the repeat directly above its matching original for the transient
  // lock/flash. If that original is buried, the repeat appears at the floor.
  // It then collapses out; everything above drops back to the unchanged prefix.
  const collapse = state.flash ? clamp((state.phase - 0.07) / 0.21) : 1;
  const eased = collapse * collapse * (3 - 2 * collapse);
  const lift = flash ? flash.rows * cell * (1 - eased) : 0;
  const matched = placed.find((p) => p.form.piece.bar === state.flash?.match);
  const anchor = matched?.y ?? box.bottom;
  return {
    ...box,
    inkWidth,
    cell,
    capacity,
    state,
    current,
    currentHeight,
    forms,
    placed,
    stackTop: y,
    landing: y - currentHeight,
    flash,
    lift,
    anchor,
    collapse: eased,
  };
}
