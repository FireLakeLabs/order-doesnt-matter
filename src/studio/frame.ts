import type { AppState } from '../app/state';
import type { EventResult } from '../contract';
import { liveModel } from '../live/model';
import type { ViewDefinition, ViewFrame, ViewNote, ViewTheme } from '../views/types';
import { instrumentColour, viewTheme } from './themes';
import { instrumentInventory } from './instrument-names';

export interface ScoreWindow {
  from: number;
  to: number;
  events: Record<string, EventResult>;
}
export function neededRange(
  span: ViewDefinition['span'],
  now: number,
  lookAhead: number,
  sections: AppState['sections'],
) {
  const last = sections.at(-1);
  const length = last ? last.start + last.cycles : 16;
  if (span === 'song') {
    const from = Math.max(0, Math.floor(now / length) * length);
    return { from, to: from + length };
  }
  const block = Math.max(0, Math.floor(now / 4) * 4);
  return { from: Math.max(0, block - 4), to: block + lookAhead + 8 };
}
const bag = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : { value };
/** Preserve fragments and signals; whole spans may overlap a question boundary. */
export function viewNotes(score: ScoreWindow): ViewNote[] {
  return Object.entries(score.events).flatMap(([instrument, result]) =>
    result.error
      ? []
      : result.events.flatMap((event) => {
          const [start, end] = event.whole ?? event.part;
          return end > score.from && start < score.to
            ? [
                {
                  instrument,
                  start,
                  end,
                  hasOnset: event.whole !== null && event.part[0] === event.whole[0],
                  value: bag(event.value),
                },
              ]
            : [];
        }),
  );
}
export interface FrameInput {
  state: AppState;
  score: ScoreWindow;
  notes: ViewNote[];
  now: number;
  cps: number;
  playing: boolean;
  theme: ViewTheme;
  lookAhead: number;
  trails: 0 | 1 | 2;
  width: number;
  height: number;
  dpr: number;
}
/** DOM-free host adapter. now has already been corrected at the runtime boundary. */
export function buildFrame(input: FrameInput): ViewFrame {
  const { state, score, notes, now, theme, lookAhead, trails, width, height, dpr } = input;
  const live = liveModel({
    rows: state.rows,
    sections: state.sections,
    events: score.events,
    sounds: state.sounds,
    solo: state.solo,
    playhead: now,
    fromCycle: score.from,
    toCycle: score.to,
  });
  const { names } = instrumentInventory(state);
  const members = sectionMembership(state, now);
  return {
    now,
    playing: input.playing,
    cps: input.cps,
    notes,
    from: score.from,
    to: score.to,
    instruments: live.instruments.map((instrument, index) => ({
      id: instrument.id,
      name: names[index],
      index,
      colour: instrumentColour(theme.name, index),
      sounding:
        input.playing &&
        !instrument.silenced &&
        notes.some(
          (note) =>
            note.instrument === instrument.id &&
            note.hasOnset &&
            note.start <= now &&
            note.end > now,
        ),
      inSection: members?.has(instrument.id) ?? instrument.inSection,
      muted: instrument.silenced,
    })),
    sections: state.sections.map((section) => ({
      name: section.name,
      from: section.start,
      to: section.start + section.cycles,
    })),
    rooms: live.rooms.map(({ orbit, members }) => ({ orbit, members })),
    lookAhead,
    trails,
    theme: viewTheme(theme),
    width,
    height,
    dpr,
  };
}

/** Use score ancestry, independent of mute/solo and the editor's pinned section. */
export function sectionMembership(
  state: Pick<AppState, 'rows' | 'sections'>,
  now: number,
): Set<string> | null {
  const last = state.sections.at(-1);
  if (!last) return null;
  const length = last.start + last.cycles;
  const cycle = ((now % length) + length) % length;
  const section = state.sections.find(
    (part) => cycle >= part.start && cycle < part.start + part.cycles,
  );
  if (!section) return null;
  return new Set(
    state.rows
      .filter((row) => row.uses.some((use) => use.path.some((node) => node.id === section.id)))
      .map((row) => row.id),
  );
}
export function playingSplit(state: Pick<AppState, 'rows' | 'sections'>, now: number) {
  const members = sectionMembership(state, now);
  return {
    playing: state.rows.filter((row) => !members || members.has(row.id)),
    resting: state.rows.filter((row) => members && !members.has(row.id)),
  };
}
/** A scored-note level, not an audio measurement. Polyphony adds energy. */
export function noteLevel(notes: ViewNote[], instrument: string, now: number): number {
  const power = notes.reduce((sum, note) => {
    if (note.instrument !== instrument || !note.hasOnset || note.start > now || note.end <= now)
      return sum;
    const gain =
      typeof note.value.gain === 'number' && Number.isFinite(note.value.gain) ? note.value.gain : 1;
    return sum + gain * gain;
  }, 0);
  return Math.min(1, Math.sqrt(power));
}
