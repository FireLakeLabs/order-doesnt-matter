import type { ViewFrame, ViewNote } from '../types';
import { roleEvidence } from '../shared/roles';
import { clamp } from '../shared/math';
import { scoredNotes } from '../shared/scored-notes';
import { flightProgress, noteProgress } from '../shared/timing';
import { flash } from '../shared/retro-2d';

export function indexMarbles(notes: ViewNote[]) {
  return roleEvidence(scoredNotes(notes));
}
export type MarbleScore = ReturnType<typeof indexMarbles>;
export interface Target {
  key: string;
  kind: 'bar' | 'drum' | 'cymbal';
  pitch?: number;
  x: number;
  y: number;
  length: number;
  thickness: number;
  station: number | null;
}
export interface Machine {
  id: string;
  targets: Target[];
}
export function runGeometry(frame: Pick<ViewFrame, 'width' | 'height'>) {
  const footer = frame.width < 700 ? 112 : 84;
  const floor = frame.height - footer - 20;
  const hopperX = frame.width * 0.48;
  const hopperY = Math.max(86, frame.height * 0.15);
  const rackX = frame.width * 0.7;
  const labelX = frame.width - 43;
  return {
    footer,
    floor,
    hopperX,
    hopperY,
    rackX,
    labelX,
    labelWidth: 35,
    barRight: labelX - 19,
    pitchTop: hopperY + 60,
    pitchBottom: floor - 24,
  };
}
/** Absolute MIDI has a fixed, continuous height on the xylophone. No octave wrap
 * or changing sampled pitch extent can move a held marble to another bar. */
export function pitchY(pitch: number, frame: Pick<ViewFrame, 'width' | 'height'>) {
  const box = runGeometry(frame);
  return box.pitchBottom - (box.pitchBottom - box.pitchTop) / (1 + Math.exp(-(pitch - 42) / 12));
}
/** Four physical percussion stations and one shared xylophone. Document identity
 * routes each part to a station; window-local role evidence chooses its surface.
 * Sharing stations in crowded pieces keeps every routed marble and its count. */
export function machineLayout(frame: ViewFrame, score: MarbleScore): Machine[] {
  const box = runGeometry(frame);
  const depth = clamp((box.floor - box.hopperY) * 0.16, 30, 65);
  const anchors = [
    [frame.width * 0.16, box.floor - depth, Math.min(158, frame.width * 0.17)],
    [frame.width * 0.36, box.floor - depth * 1.8, Math.min(126, frame.width * 0.14)],
    [
      frame.width * 0.49,
      box.floor - (box.floor - box.hopperY) * 0.45,
      Math.min(132, frame.width * 0.14),
    ],
    [
      frame.width * 0.62,
      box.floor - (box.floor - box.hopperY) * 0.65,
      Math.min(116, frame.width * 0.12),
    ],
  ];
  return [...frame.instruments]
    .sort((a, b) => a.index - b.index)
    .map((part) => {
      const evidence = score.get(part.id);
      const pitches = [
        ...new Set(evidence?.events.map((e) => e.pitch).filter((p) => p !== undefined)),
      ].sort((a, b) => b - a);
      const targets: Target[] = pitches.map((pitch) => ({
        key: String(pitch),
        kind: 'bar',
        pitch,
        station: null,
        x: box.rackX,
        y: pitchY(pitch, frame),
        length: (box.barRight - box.rackX) * (0.45 + 0.5 / (1 + Math.exp((pitch - 48) / 18))),
        thickness: clamp((pitchY(pitch - 0.5, frame) - pitchY(pitch + 0.5, frame)) * 0.86, 0.6, 10),
      }));
      if (evidence?.events.some((e) => e.pitch === undefined)) {
        const station = (part.index + 2) % 4;
        const [x, y, length] = anchors[station];
        targets.push({
          key: 'unpitched',
          kind: evidence.density >= 2 && evidence.duration <= 0.15 ? 'cymbal' : 'drum',
          station,
          x,
          y,
          length,
          thickness: 0,
        });
      }
      return { id: part.id, targets };
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
  const { hopperX: startX, hopperY: startY } = runGeometry(frame);
  const endX = target.x,
    endY = target.y - marbleRadius(note);
  const controlY = Math.max(18, startY - 76);
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
  const hits = new Map<string, number>();
  let flying = 0,
    rolling = 0,
    carried = 0;
  live.forEach((state, i) => {
    if (state.hit > 0) {
      hits.set(state.target.key, Math.max(hits.get(state.target.key) ?? 0, state.hit));
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
