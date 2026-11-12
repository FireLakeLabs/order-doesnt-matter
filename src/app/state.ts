import type { EventResult, ImportResult, SheetSoundState } from '../contract';
import { instruments, sections, type Doc, type Instrument, type SongSection } from '../document';

export interface AppState {
  solo: string | null;
  source: string;
  doc: Doc | null;
  rows: Instrument[];
  sections: SongSection[];
  warnings: ImportResult['warnings'];
  selected: string | null;
  follow: boolean;
  fromCycle: number;
  toCycle: number;
  events: Record<string, EventResult>;
  sounds: SheetSoundState[];
  soundNotice: { visible: boolean; failures: string[] };
  playing: boolean;
  loadError: string;
  message: string;
  cps: number | null;
}
export const initialState = (): AppState => ({
  solo: null,
  source: '',
  doc: null,
  rows: [],
  sections: [],
  warnings: [],
  selected: null,
  follow: true,
  fromCycle: 0,
  toCycle: 4,
  events: {},
  sounds: [],
  soundNotice: { visible: false, failures: [] },
  playing: false,
  loadError: '',
  message: '',
  cps: null,
});
export function loadPiece(state: AppState, source: string, imported: ImportResult): AppState {
  const parts = sections(imported.doc);
  return {
    ...initialState(),
    source,
    doc: imported.doc,
    rows: instruments(imported.doc),
    sections: parts,
    warnings: imported.warnings,
    selected: parts[0]?.id ?? null,
    toCycle: parts[0]?.cycles ?? 4,
    playing: state.playing,
  };
}
export const loadFailure = (state: AppState): AppState => ({
  ...state,
  loadError:
    'Could not read this Strudel. Check the text and try Load again. Your previous piece is still here.',
});
export function selectSection(state: AppState, id: string): AppState {
  const part = state.sections.find((p) => p.id === id);
  return part
    ? {
        ...state,
        selected: id,
        follow: false,
        fromCycle: part.start,
        toCycle: part.start + part.cycles,
      }
    : state;
}
/** Follow uses absolute cycles, including repeats, rather than assuming random scores repeat. */
export function tick(state: AppState, cycle: number | null): AppState {
  if (!state.follow || cycle === null || !Number.isFinite(cycle)) return state;
  cycle = Math.max(0, cycle);
  const total = state.sections.at(-1);
  const length = total ? total.start + total.cycles : 0;
  const offset = length ? Math.floor(cycle / length) * length : 0;
  const part = state.sections.find(
    (p) => cycle - offset >= p.start && cycle - offset < p.start + p.cycles,
  );
  const fromCycle = part ? offset + part.start : Math.floor(cycle / 4) * 4;
  const toCycle = fromCycle + (part?.cycles ?? 4);
  if (fromCycle === state.fromCycle && toCycle === state.toCycle) return state;
  return { ...state, fromCycle, toCycle, selected: part?.id ?? null };
}
export const setFollow = (state: AppState, follow: boolean): AppState => ({ ...state, follow });
export const startCycle = (state: AppState) =>
  !state.follow && state.selected
    ? (state.sections.find((p) => p.id === state.selected)?.start ?? 0)
    : 0;
export function mergeSounds(
  previous: SheetSoundState[],
  names: string[],
  updates: SheetSoundState[],
): SheetSoundState[] {
  const before = new Map(previous.map((s) => [s.name, s])),
    latest = new Map(updates.map((s) => [s.name, s]));
  return [
    ...new Map(
      names.map((name) => {
        const base = name.split(':')[0];
        const sound: SheetSoundState = latest.get(name) ??
          latest.get(base) ??
          before.get(name) ??
          before.get(base) ?? { name, state: 'not-loaded' };
        return [sound.name, sound];
      }),
    ).values(),
  ];
}

/** A repeated snapshot cannot reopen a dismissed notice. A new failed load can. */
export function observeSoundNotice(
  previous: AppState['soundNotice'],
  updates: SheetSoundState[],
): AppState['soundNotice'] {
  const failures = updates
    .filter(
      (s) => s.state === 'missing' && s.detail?.includes('Default collections could not load'),
    )
    .map((s) => s.name);
  return {
    visible: previous.visible || failures.some((name) => !previous.failures.includes(name)),
    failures,
  };
}

/** Solo belongs to this loaded piece, outside document history. */
export function setSolo(state: AppState, id: string | null): AppState {
  return id === state.solo || (id !== null && !state.rows.some((r) => r.id === id))
    ? state
    : { ...state, solo: id };
}
export const playbackOptions = (state: Pick<AppState, 'solo'>) =>
  state.solo ? { only: state.solo } : {};

/** Recompute the pinned window by occurrence identity after arrangement edits. */
export function editedPiece(state: AppState, doc: Doc): AppState {
  const parts = sections(doc);
  const selected =
    parts.find((p) => p.id === state.selected) ??
    parts[
      Math.min(
        Math.max(
          0,
          state.sections.findIndex((p) => p.id === state.selected),
        ),
        parts.length - 1,
      )
    ];
  const rows = instruments(doc),
    ids = new Set(rows.map((row) => row.id));
  const next = {
    ...state,
    doc,
    rows,
    events: Object.fromEntries(Object.entries(state.events).filter(([id]) => ids.has(id))),
    solo: state.solo && ids.has(state.solo) ? state.solo : null,
    sections: parts,
    selected: selected?.id ?? null,
  };
  const total = parts.at(-1);
  const length = total ? total.start + total.cycles : 0;
  const offset = state.follow && length ? Math.floor(state.fromCycle / length) * length : 0;
  return {
    ...next,
    fromCycle: selected ? offset + selected.start : state.fromCycle,
    toCycle: selected ? offset + selected.start + selected.cycles : state.toCycle,
  };
}
