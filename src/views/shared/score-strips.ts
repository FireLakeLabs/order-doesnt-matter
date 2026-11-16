import type { ViewFrame } from '../types';
import { cycleScore, scoreArcs } from './cycle-score';
import type { ScoreStrip } from './score-mesh';

export function cycleStrips(frame: ViewFrame, cycle: number, overview = false): ScoreStrip[] {
  const strips: ScoreStrip[] = [];
  for (const band of cycleScore(frame, cycle)) {
    const instrument = frame.instruments.find((instrument) => instrument.id === band.id);
    if (!instrument) continue;
    strips.push({
      ...band,
      cycle,
      colour: band.resting ? frame.theme.muted : instrument.colour,
      muted: instrument.muted,
      width: 0.002,
      track: true,
      segments: overview ? 24 : 128,
      arcs: [{ from: 0, to: 1, start: 0, end: 0, onset: false }],
    });
    if (!band.resting)
      strips.push({
        ...band,
        cycle,
        colour: instrument.colour,
        muted: instrument.muted,
        arcs: scoreArcs(band.arcs, overview),
      });
  }
  return strips;
}
/** A score revision, palette or mute change rebuilds static buffers; time does not. */
export function scoreInventory(frame: ViewFrame) {
  return (
    frame.instruments
      .map((i) => `${i.id}:${String(i.index)}:${i.colour}:${String(i.muted)}`)
      .join('|') +
    frame.sections.map((s) => `${s.name}:${String(s.from)}:${String(s.to)}`).join('|')
  );
}
