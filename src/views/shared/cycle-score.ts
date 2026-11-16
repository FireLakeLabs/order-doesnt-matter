import type { ViewFrame } from '../types';
import { bandLayout, cycleArcs, occupancy, DENSE_AT } from './ring-model';

/** Membership belongs to the cycle being drawn, including a future section. */
export function cycleScore(frame: ViewFrame, cycle: number) {
  const notes = frame.notes.filter((note) => note.start < cycle + 1 && note.end > cycle);
  const present = new Set(notes.map((note) => note.instrument));
  const bands = bandLayout({
    ...frame,
    now: cycle + 0.5,
    from: cycle,
    to: cycle + 1,
    sections: [],
    notes,
    instruments: frame.instruments.map((instrument) => ({
      ...instrument,
      inSection: present.has(instrument.id),
    })),
  });
  return bands.map((band) => ({
    ...band,
    arcs: cycleArcs(
      notes.filter((note) => note.instrument === band.id),
      cycle,
    ),
  }));
}

/** Coarse occupancy preserves every span's area when a whole song is compressed. */
export function occupancyArcs(arcs: ReturnType<typeof cycleArcs>, bins = 64) {
  const texture = occupancy(arcs, bins);
  return Array.from({ length: bins }, (_, bin) => ({
    from: bin / bins,
    to: (bin + 1) / bins,
    start: texture[bin * 4 + 1],
    end: texture[bin * 4 + 2],
    onset: texture[bin * 4 + 3] > 0,
    coverage: texture[bin * 4],
  })).filter((arc) => arc.coverage > 0);
}
export function scoreArcs(arcs: ReturnType<typeof cycleArcs>, overview = false) {
  return overview || arcs.length >= DENSE_AT
    ? occupancyArcs(arcs)
    : arcs.map((arc) => ({ ...arc, coverage: 1 }));
}
