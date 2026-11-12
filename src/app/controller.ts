import { sections, walk, type Doc } from '../document';
import { createEditSession, type EditSession } from '../editor/session';
import type { Engine, EngineEvent, EventResult } from '../contract';
import { generate } from '../generate';
import { importStrudel } from '../import';
import { createEngine } from '../engine';
import type { SpiralInput } from '../spiral';
import { createBrowserQueries } from '../strudel/evaluate-browser';
import {
  initialState,
  editedPiece,
  setSolo,
  playbackOptions,
  loadPiece,
  loadFailure,
  selectSection,
  setFollow,
  tick,
  mergeSounds,
  observeSoundNotice,
  startCycle,
  type AppState,
} from './state';

export function createApp() {
  let state = initialState(),
    engine: Engine | null = null;
  let editor: EditSession | null = null;
  const dirtyRows = new Set<string>();
  let epoch = 0,
    windowRevision = 0,
    transportRevision = 0;
  let cachedWindow: { from: number; to: number; events: AppState['events'] } | null = null;
  let checked = false,
    starting = false;
  const queries = createBrowserQueries(),
    preflight = createBrowserQueries();
  const watchQueries = createBrowserQueries();
  let watchOpen = false,
    watchDoc: Doc | null = null,
    watchRevision = 0,
    watchBatch = -Infinity;
  let watchScore: Doc | null = null;
  let watchRanges: { from: number; to: number; events: AppState['events'] }[] = [];
  let watchMerge: { key: unknown[]; events: AppState['events'] } | null = null;
  function resetWatch() {
    ++watchRevision;
    watchQueries.cancel();
    watchRanges = [];
    watchMerge = null;
    watchBatch = -Infinity;
    watchDoc = state.doc;
    watchScore = state.doc;
    // A visual question may reveal muted notes; this copy never reaches playback.
    if (state.doc && state.rows.some((r) => r.muted || r.uses.some((u) => u.muted))) {
      watchScore = structuredClone(state.doc);
      walk(watchScore, (node) => {
        if ('muted' in node) node.muted = false;
      });
    }
  }
  function watchInput(now: number | null): SpiralInput {
    if (watchDoc !== state.doc) resetWatch();
    const cycle = now ?? state.fromCycle,
      first = Math.max(0, Math.floor(cycle) - 1);
    const last = state.sections.at(-1),
      length = last ? last.start + last.cycles : 0,
      end = length ? (Math.floor(cycle / length) + 1) * length : null;
    const held = watchScore === state.doc ? cachedWindow : null;
    const known: [number, number][] = [
      ...(held ? [[held.from, held.to] as [number, number]] : []),
      ...watchRanges.map((r) => [r.from, r.to] as [number, number]),
    ];
    const horizon = Math.floor(cycle) + 4;
    const missing = Array.from(
      { length: Math.max(0, Math.ceil(horizon - first)) },
      (_, n) => first + n,
    ).some((t) => !known.some(([a, b]) => a <= t && b >= t + 1));
    if (watchOpen && state.doc && missing && (cycle < watchBatch || cycle - watchBatch >= 4)) {
      watchBatch = cycle;
      const revision = watchRevision,
        doc = state.doc;
      const to = Math.floor(cycle) + 8;
      const gaps: [number, number][] = [];
      for (let t = first; t < to; t++)
        if (!known.some(([a, b]) => a <= t && b >= Math.min(t + 1, to))) {
          if (gaps.at(-1)?.[1] === t) gaps.at(-1)![1] = Math.min(t + 1, to);
          else gaps.push([t, Math.min(t + 1, to)]);
        }
      void Promise.all(
        gaps.map(async ([from, to]) => ({
          from,
          to,
          events: Object.fromEntries(
            await Promise.all(
              state.rows.map(async (row) => [
                row.id,
                await watchQueries.query(generate(watchScore!, { only: row.id }), from, to),
              ]),
            ),
          ),
        })),
      ).then((ranges) => {
        if (!watchOpen || revision !== watchRevision || state.doc !== doc) return;
        watchRanges = [...watchRanges.filter((r) => r.to > first), ...ranges];
      });
    }
    const key = [held, watchRanges, state.rows, first, horizon];
    if (!watchMerge || key.some((v, n) => v !== watchMerge!.key[n])) {
      const events: AppState['events'] = {};
      for (const row of state.rows) {
        const collected: EventResult['events'] = [];
        let result: EventResult | undefined;
        for (let turn = first; turn < Math.ceil(horizon); turn++) {
          const range =
            watchRanges.find((r) => r.from <= turn && r.to >= turn + 1) ??
            (held && held.from <= turn && held.to >= turn + 1 ? held : null);
          const answer = range?.events[row.id];
          if (!answer) continue;
          result = result?.error ? result : answer;
          collected.push(
            ...answer.events
              .filter(
                (e) =>
                  e.whole &&
                  ((e.whole[0] >= turn && e.whole[0] < turn + 1) ||
                    (turn === first &&
                      e.whole[0] < first &&
                      e.whole[1] > first &&
                      (e.part[0] === e.whole[0] || e.part[0] === range!.from))),
              )
              .map((e) =>
                e.whole && e.whole[0] < first
                  ? { ...e, part: [e.whole[0], e.part[1]] as [number, number] }
                  : e,
              ),
          );
        }
        if (result) events[row.id] = { ...result, events: collected };
      }
      watchMerge = { key, events };
    }
    return { ...state, events: watchMerge.events, playhead: now, known, end };
  }
  const listeners = new Set<(state: AppState) => void>();
  const history: EngineEvent[] = [];
  const update = (next: AppState) => {
    state = next;
    for (const listener of listeners) listener(state);
  };
  const message = (error: unknown) =>
    update({ ...state, message: String(error instanceof Error ? error.message : error) });
  function sounds() {
    const names = Object.values(state.events).flatMap((result) =>
      result.events.flatMap((e) => {
        const s = (e.value as { s?: unknown })?.s;
        return [s].flat().filter((name): name is string => typeof name === 'string');
      }),
    );
    return mergeSounds(state.sounds, names, engine?.sounds() ?? []);
  }
  async function askWindow(affected?: string[]) {
    queries.cancel();
    const revision = ++windowRevision,
      piece = epoch;
    const { doc, fromCycle, toCycle, rows } = state;
    if (!doc) return;
    if (affected && rows.some((row) => !state.events[row.id])) affected = undefined;
    const last = state.sections.at(-1);
    const length = last ? last.start + last.cycles : 0;
    const from = length && fromCycle < length ? 0 : fromCycle;
    const to = length && fromCycle < length ? length : toCycle;
    if (!affected && cachedWindow?.from === from && cachedWindow.to === to) {
      update({ ...state, events: cachedWindow.events, sounds: sounds() });
      return;
    }
    const results = await Promise.all(
      rows
        .filter((row) => !affected || affected.includes(row.id))
        .map(
          async (row) =>
            [row.id, await queries.query(generate(doc, { only: row.id }), from, to)] as const,
        ),
    );
    if (piece !== epoch || revision !== windowRevision) return;
    dirtyRows.clear();
    cachedWindow = {
      from,
      to,
      events: { ...(affected ? state.events : {}), ...Object.fromEntries(results) },
    };
    update({ ...state, events: cachedWindow.events });
    update({ ...state, sounds: sounds() });
  }
  function observe(event: EngineEvent) {
    history.push(event);
    if (history.length > 1000) history.shift();
    if (event.type === 'swapped' || event.type === 'committed') editor?.observe(event);
    if (event.type === 'error') message(event.message);
    if (event.type === 'transport') {
      if (!event.playing) editor?.clear();
      update({ ...state, playing: event.playing });
    }
    if (event.type === 'sounds')
      update({
        ...state,
        sounds: sounds(),
        soundNotice: observeSoundNotice(state.soundNotice, event.sounds),
      });
  }
  // All engine replacements, including solo, share a serial queue.
  let swaps = Promise.resolve();
  function replacePlayback(doc: Doc, options: Parameters<Engine['play']>[1] = {}) {
    const piece = epoch,
      transport = transportRevision;
    const work = swaps.then(() => {
      if (piece !== epoch || transport !== transportRevision) return -1;
      return engine!.play(generate(doc, playbackOptions(state)), options);
    });
    swaps = work.then(
      () => {},
      () => {},
    );
    return work;
  }
  async function play() {
    if (!state.doc || !checked || starting) return;
    const piece = epoch,
      transport = ++transportRevision;
    starting = true;
    update({ ...state, message: 'Preparing sounds…' });
    try {
      // Check the actual seek window too before the engine evaluates on the page.
      const fromCycle = startCycle(state);
      const result = await preflight.query(
        generate(state.doc!, playbackOptions(state)),
        fromCycle,
        fromCycle + 16,
      );
      if (piece !== epoch || transport !== transportRevision) return;
      if (result.error) throw Error(result.error.message);
      engine ??= await createEngine();
      // Subscribe once, including when Stop was pressed during initialization.
      if (!subscribed) {
        engine.subscribe(observe);
        subscribed = true;
      }
      if (piece !== epoch || transport !== transportRevision) return;
      const next = tick(state, fromCycle);
      if (next !== state) {
        update(next);
        void askWindow();
      }
      await replacePlayback(state.doc!, {
        fromCycle,
        discoverCycles: state.sections.map((s) => s.start),
      });
      if (piece === epoch && transport === transportRevision)
        update({ ...state, message: '', sounds: sounds() });
    } catch (error) {
      message(error);
    } finally {
      starting = false;
      update({ ...state });
    }
  }
  let subscribed = false;
  return {
    get state() {
      return state;
    },
    get editor() {
      return editor;
    },
    get engine() {
      return engine;
    },
    history,
    setWatch(open: boolean) {
      watchOpen = open;
      resetWatch();
    },
    watchInput,
    get canPlay() {
      return checked && !starting;
    },
    subscribe(listener: (state: AppState) => void) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    async load(source: string) {
      let imported;
      try {
        imported = importStrudel(source);
      } catch {
        update(loadFailure(state));
        return;
      }
      editor?.dispose();
      dirtyRows.clear();
      editor = createEditSession(imported.doc, {
        playing: () => !!engine?.playing,
        play: (doc) => replacePlayback(doc, { discoverCycles: sections(doc).map((s) => s.start) }),
        changed: (pending) => update(editedPiece(state, pending.doc)),
        refresh: (_doc: Doc, ids: string[]) => {
          if (!ids.length) return;
          cachedWindow = null;
          ids.forEach((id) => dirtyRows.add(id));
          void askWindow([...dirtyRows]);
        },
      });
      const piece = ++epoch;
      checked = false;
      cachedWindow = null;
      queries.cancel();
      preflight.cancel();
      update({ ...loadPiece(state, source, imported), message: 'Asking the score…' });
      void askWindow();
      // Also question the whole program: setup-only/opaque programs may have no rows,
      // and audio.prepare asks sixteen cycles before it commits.
      const from = Math.max(0, engine?.now() ?? 0);
      const result: EventResult = await preflight.query(generate(imported.doc), from, from + 16);
      if (piece !== epoch) return;
      checked = !result.error;
      update({
        ...state,
        cps: result.error ? null : result.cps,
        message: result.error ? `Could not play this piece: ${result.error.message}` : '',
      });
      if (checked && engine?.playing) {
        try {
          await replacePlayback(imported.doc, {
            discoverCycles: sections(imported.doc).map((s) => s.start),
          });
        } catch (error) {
          message(error);
        }
      }
    },
    solo(id: string | null) {
      const next = setSolo(state, id);
      if (next === state) return;
      const previous = state.solo,
        piece = epoch;
      update(next);
      if (engine?.playing && state.doc)
        void replacePlayback(state.doc).catch((error) => {
          if (piece !== epoch || state.solo !== id) return;
          update(setSolo(state, previous));
          message(error);
        });
    },
    play,
    dismissSoundNotice() {
      update({ ...state, soundNotice: { ...state.soundNotice, visible: false } });
    },
    stop() {
      ++transportRevision;
      editor?.clear();
      engine?.stop();
      update({ ...state, playing: false, message: '' });
    },
    select(id: string) {
      const next = selectSection(state, id);
      if (next !== state) {
        update(next);
        void askWindow();
      }
    },
    follow(value: boolean) {
      update(setFollow(state, value));
      this.frame();
    },
    frame() {
      const now = engine?.now() ?? null;
      const next = tick(state, now);
      if (next !== state) {
        update(next);
        void askWindow();
      }
      return now;
    },
  };
}
export type App = ReturnType<typeof createApp>;
