import type { ViewFrame, ViewNote } from '../types';
import { roleEvidence, drumEvidence } from '../shared/roles';
import { scoredNotes } from '../shared/scored-notes';
import { noteProgress } from '../shared/timing';
import { clamp } from '../shared/math';
import { sectionAt } from '../shared/ring-model';

export type Move = 'jab' | 'guard' | 'heavy' | 'bass blow' | 'special';
/** Rhythm/pitch evidence only: sample selectors (n) are not MIDI pitches.
 * Dense short rhythms jab; sparse offbeats step/guard; low pitches and
 * downbeat/backbeat rhythms hit hard. Timbral identity is not in the contract. */
export function indexBout(source: ViewNote[]) {
  const notes = scoredNotes(source);
  const evidence = roleEvidence(notes.map((n) => ({ ...n, value: { ...n.value, n: undefined } })));
  const moves = new Map<string, Move>();
  for (const p of evidence.values()) {
    const drum = drumEvidence(p);
    moves.set(
      p.id,
      Number.isFinite(p.meanPitch)
        ? p.meanPitch <= 48
          ? 'bass blow'
          : 'jab'
        : p.density >= 3 && p.duration <= 0.25
          ? 'jab'
          : drum && (drum.downbeats > 0 || p.density <= 1.5)
            ? 'heavy'
            : 'guard',
    );
  }
  return { notes, moves };
}
export type BoutScore = ReturnType<typeof indexBout>;
export const held = (n: ViewNote) => n.end - n.start > 0.25;
export function rankFighters(score: BoutScore, frame: ViewFrame, from: number) {
  const to = from + Math.max(1, frame.lookAhead);
  const counts = new Map<string, number>();
  for (const n of score.notes)
    if (n.hasOnset && n.start >= from && n.start < to)
      counts.set(n.instrument, (counts.get(n.instrument) ?? 0) + 1);
  return frame.instruments
    .filter((i) => (counts.get(i.id) ?? 0) > 0)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.index - b.index)
    .slice(0, 2)
    .map((part) => ({ part, count: counts.get(part.id) ?? 0 }));
}
/** Onset is the exact extension peak; pre-onset anticipation has negative
 * extension, followed by recoil. Held specials charge only in [start,end). */
export function gesture(note: ViewNote, role: Move, now: number) {
  const move = held(note) ? 'special' : role;
  const time = move === 'special' ? note.end : note.start;
  const age = now - time;
  const recovery = move === 'jab' ? 0.15 : move === 'bass blow' ? 0.3 : 0.23;
  const charging = move === 'special' && note.start <= now && now < note.end;
  const windup = note.hasOnset && move !== 'special' && age < 0 && age >= -0.055;
  const active =
    charging || windup || ((note.hasOnset || held(note)) && age >= 0 && age < recovery);
  const power = active && age >= 0 ? (1 - age / recovery) ** 2 : 0;
  return {
    note,
    move,
    time,
    age,
    active,
    power,
    charging,
    charge: charging ? noteProgress(note, now) : 0,
    extension: windup ? -(1 + age / 0.055) * 0.25 : power,
  };
}
export function fighterAt(score: BoutScore, id: string, now: number) {
  const layers = score.notes
    .filter((n) => n.instrument === id)
    .map((n) => gesture(n, score.moves.get(id) ?? 'jab', now))
    .filter((g) => g.active);
  const ordered = layers
    .slice()
    .sort(
      (a, b) => Number(b.charging) - Number(a.charging) || b.power - a.power || b.time - a.time,
    );
  const lead = ordered.at(0);
  return {
    layers,
    lead,
    count: layers.length,
    charge: Math.max(0, ...layers.map((g) => g.charge)),
    extension: lead?.extension ?? 0,
    label: lead
      ? lead.charging
        ? 'charging special'
        : lead.age < 0
          ? `wind-up ${lead.move}`
          : lead.move === 'guard'
            ? 'step / guard'
            : lead.power > 0.55
              ? lead.move
              : `${lead.move} recoil`
      : 'guard',
  };
}
export type FighterState = ReturnType<typeof fighterAt>;
export function boutState(score: BoutScore, frame: ViewFrame) {
  const from = Math.floor(frame.now),
    to = from + Math.max(1, frame.lookAhead);
  const fighters = rankFighters(score, frame, from).map((fighter) => ({
    ...fighter,
    noteCount: score.notes.filter(
      (n) => n.instrument === fighter.part.id && n.start < to && n.end > from,
    ).length,
  }));
  const previous = from > 0 ? rankFighters(score, frame, from - 1) : fighters;
  const tag = clamp((frame.now - from) / 0.3);
  const windowNotes = score.notes.filter((n) => n.start < to && n.end > from);
  const total = windowNotes.length;
  const ids = new Set(fighters.map((f) => f.part.id));
  const arena = frame.instruments
    .filter((i) => !ids.has(i.id) && windowNotes.some((n) => n.instrument === i.id))
    .sort((a, b) => a.index - b.index)
    .map((part) => {
      const notes = windowNotes.filter((n) => n.instrument === part.id);
      const holds = notes.filter((n) => held(n) && n.start <= frame.now && frame.now < n.end);
      const pulses = notes.filter(
        (n) => n.hasOnset && n.start <= frame.now && frame.now - n.start < 0.18,
      );
      return {
        part,
        notes,
        holds,
        pulses,
        light: Math.max(0, ...pulses.map((n) => 1 - (frame.now - n.start) / 0.18)),
        progress: holds.map((n) => noteProgress(n, frame.now)),
      };
    });
  const a = fighters[0]?.part.id,
    b = fighters[1]?.part.id;
  const coincident = new Map<number, { left: number; right: number }>();
  for (const n of score.notes) {
    if (!n.hasOnset || n.start > frame.now || frame.now - n.start >= 0.16) continue;
    if (n.instrument !== a && n.instrument !== b) continue;
    const group = coincident.get(n.start) ?? { left: 0, right: 0 };
    if (n.instrument === a) group.left++;
    else group.right++;
    coincident.set(n.start, group);
  }
  const clashes = [...coincident]
    .filter(([, g]) => g.left && g.right)
    .map(([time, g]) => ({ time, count: g.left + g.right }))
    .sort((a, b) => a.time - b.time);
  const section = sectionAt(frame);
  const period = frame.sections.at(-1)?.to ?? 0;
  const offset = period > 0 ? Math.floor(frame.now / period) * period : 0;
  const ordinal = section
    ? frame.sections.findIndex((s) => Math.abs(s.from + offset - section.from) < 1e-8) + 1
    : 1;
  return {
    from,
    to,
    total,
    windowNotes,
    fighters,
    previous,
    tag,
    arena,
    clashes,
    round: ordinal,
    section: section?.name ?? 'FREE SPAR',
    departures: previous.filter((f) => !ids.has(f.part.id)),
  };
}
export function boutLayout(width: number, height: number) {
  const footer = width < 700 ? 112 : 92;
  const feet = height - footer - 58;
  const scale = Math.max(0.1, Math.min((width - 40) / 450, (feet - 106) / 245));
  return {
    footer,
    feet,
    scale,
    left: width * (width < 700 ? 0.28 : 0.36),
    right: width * (width < 700 ? 0.72 : 0.64),
    top: 100,
  };
}
