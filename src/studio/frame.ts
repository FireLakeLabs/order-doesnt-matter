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
  return {
    now,
    playing: state.playing,
    cps: state.cps ?? 0.5,
    notes,
    from: score.from,
    to: score.to,
    instruments: live.instruments.map((instrument, index) => ({
      id: instrument.id,
      name: names[index],
      index,
      colour: instrumentColour(theme.name, index),
      sounding:
        state.playing &&
        !instrument.silenced &&
        notes.some(
          (note) =>
            note.instrument === instrument.id &&
            note.hasOnset &&
            note.start <= now &&
            note.end > now,
        ),
      inSection: instrument.inSection,
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
