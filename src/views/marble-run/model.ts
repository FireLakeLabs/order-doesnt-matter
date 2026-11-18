import type { ViewFrame, ViewNote } from '../types';
import { roleEvidence } from '../shared/roles';
import { clamp } from '../shared/math';
import { pitchClass } from '../shared/pitch';
import { flightProgress, noteProgress } from '../shared/timing';
import { flash } from '../shared/retro-2d';

export function indexMarbles(notes: ViewNote[]) {
  return roleEvidence(notes);
}
export type MarbleScore = ReturnType<typeof indexMarbles>;
export interface Target {
  key: string;
  kind: 'bar' | 'drum' | 'cymbal';
  pitch?: number;
  x: number;
  y: number;
  length: number;
}
export interface Machine {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  targets: Target[];
}
/** Part slots follow document order, including resting parts. Pitch coordinates use
 * absolute MIDI, never the currently present siblings or a changing pitch range. */
export function machineLayout(frame: ViewFrame, score: MarbleScore): Machine[] {
  const parts = [...frame.instruments].sort((a, b) => a.index - b.index);
  const top = frame.height * 0.33;
  const available = Math.max(1, frame.height - top - 58);
  const columns = Math.max(
    1,
    Math.min(
      parts.length,
      Math.floor(frame.width / 100),
      Math.ceil(Math.sqrt((parts.length * frame.width) / available)),
    ),
  );
  const rows = Math.ceil(parts.length / columns);
  const height = Math.max(1, (frame.height - top - 58) / Math.max(1, rows));
  const width = (frame.width - 32) / columns;
  return parts.map((part, i) => {
    const x = 16 + (i % columns) * width;
    const y = top + Math.floor(i / columns) * height;
    const evidence = score.get(part.id);
    const pitches = [
      ...new Set(evidence?.events.map((e) => e.pitch).filter((p) => p !== undefined)),
    ].sort((a, b) => b - a);
    const targets: Target[] = pitches.map((pitch) => ({
      key: String(pitch),
      kind: 'bar',
      pitch,
      x: x + 18,
      // Fixed chromatic rows, with octaves slightly staggered: the rack folds
      // registers instead of recomputing a range from whichever siblings remain.
      y:
        y +
        10 +
        ((11 - pitchClass(pitch)) / 12) * Math.max(1, height - 58) +
        (((Math.floor(pitch / 12) % 4) + 4) % 4) * 0.7,
      length: (width - 40) * (0.15 + 0.8 / (1 + Math.exp((pitch - 36) / 12))),
    }));
    if (evidence?.events.some((e) => e.pitch === undefined))
      targets.push({
        key: 'unpitched',
        kind: evidence.density >= 2 && evidence.duration <= 0.15 ? 'cymbal' : 'drum',
        x: x + width / 2,
        y: y + height * 0.48,
        length: Math.max(8, width * 0.56),
      });
    return { id: part.id, x, y, width, height, targets };
  });
}
export function marbleRadius(note: ViewNote) {
  const gain = Number(note.value.gain ?? 1);
  return 3 + 7 * Math.sqrt(clamp(Number.isFinite(gain) ? gain : 1, 0, 2) / 2);
}
export function marbleAt(
  note: ViewNote,
  target: Target,
  frame: Pick<ViewFrame, 'now' | 'lookAhead' | 'cps' | 'width' | 'height'>,
) {
  const flying =
    note.hasOnset && frame.now >= note.start - frame.lookAhead && frame.now < note.start;
  const held = frame.now >= note.start && frame.now < note.end;
  const hit = flash(note, frame);
  const progress = flightProgress(note, frame.now, frame.lookAhead);
  const startX = frame.width / 2,
    startY = 92;
  const endX = target.x,
    endY = target.y - marbleRadius(note);
  const controlY = Math.min(60, frame.height * 0.12);
  const x = flying
    ? startX + (endX - startX) * progress
    : target.x +
      (target.kind === 'bar' && held ? noteProgress(note, frame.now) * target.length : 0);
  const y = flying
    ? (1 - progress) ** 2 * startY + 2 * (1 - progress) * progress * controlY + progress ** 2 * endY
    : endY;
  return { x, y, flying, held, hit, progress, radius: marbleRadius(note), carried: !note.hasOnset };
}
export interface MarbleMark {
  target: Target;
  x: number;
  y: number;
  radius: number;
  count: number;
  flying: boolean;
  carried: boolean;
}
/** Spatial buckets merge only crowded parts; their counts still sum to every
 * visible source note. Onset-free fragments are carried, never relaunched. */
export function machineState(machine: Machine, score: MarbleScore, frame: ViewFrame) {
  const events = score.get(machine.id)?.events ?? [];
  const live = events.flatMap(({ note, pitch }) => {
    const target = machine.targets.find(
      (t) => t.key === (pitch === undefined ? 'unpitched' : String(pitch)),
    );
    if (!target) return [];
    const state = marbleAt(note, target, frame);
    return state.flying || state.held || state.hit > 0 ? [{ ...state, target }] : [];
  });
  const marks = new Map<string, MarbleMark>();
  const hits = new Map<string, { strength: number; count: number }>();
  let flying = 0,
    rolling = 0,
    carried = 0;
  live.forEach((state, i) => {
    if (state.hit > 0) {
      const hit = hits.get(state.target.key);
      hits.set(state.target.key, {
        strength: Math.max(hit?.strength ?? 0, state.hit),
        count: (hit?.count ?? 0) + 1,
      });
    }
    if (!state.flying && !state.held) return;
    if (state.flying) flying++;
    else if (state.carried) carried++;
    else rolling++;
    const key =
      live.length > 24
        ? `${state.target.key}/${String(state.flying)}/${String(state.carried)}/${String(Math.floor(state.x / 12))}/${String(Math.floor(state.y / 12))}`
        : String(i);
    const old = marks.get(key);
    if (old) {
      old.x = (old.x * old.count + state.x) / (old.count + 1);
      old.y = (old.y * old.count + state.y) / (old.count + 1);
      old.radius = Math.max(old.radius, state.radius);
      old.count++;
    } else
      marks.set(key, {
        target: state.target,
        x: state.x,
        y: state.y,
        radius: state.radius,
        count: 1,
        flying: state.flying,
        carried: state.carried,
      });
  });
  return { marks: [...marks.values()], hits, flying, rolling, carried, merged: live.length > 24 };
}
