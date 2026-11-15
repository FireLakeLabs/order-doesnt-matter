import { migrate, sections, walk, type Doc } from '../document';
import { createEditSession, type EditSession } from '../editor/session';
import type { Engine, EngineEvent, EventResult, ImportWarning } from '../contract';
import { generate } from '../generate';
import { discoveryIdentity } from '../generate/discovery';
import { importStrudel } from '../import';
import { createEngine } from '../engine';
import { createRetention, documentJSON, readDocument } from './retention';
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

export function createApp(
  options: {
    retention?: ReturnType<typeof createRetention>;
    confirmReplacement?: () => Promise<boolean>;
  } = {},
) {
  let retention = options.retention ?? createRetention();
  let practice = false,
    preparing = false;
  const work = new Set<Promise<unknown>>();
  function track<T>(task: Promise<T>): Promise<T> {
    work.add(task);
    void task.finally(() => work.delete(task)).catch(() => {});
    return task;
  }
  let engineActivation = -1,
    playbackFailed = false;
  let engineCreation: Promise<Engine> | undefined;
  let loadRevision = 0,
    restoredDocument = false,
    loading = 0;
  let state = initialState(),
    engine: Engine | null = null;
  let editor: EditSession | null = null;
  let discoveryScope = {};
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
      end = length ? (Math.floor(Math.max(0, cycle) / length) + 1) * length : null;
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
    return {
      ...state,
      events: watchMerge.events,
      playhead: now,
      outputLatency: engine?.outputLatency() ?? 0,
      known,
      end,
    };
  }
  const listeners = new Set<(state: AppState) => void>();
  const history: EngineEvent[] = [];
  const update = (next: AppState) => {
    if (state.doc !== next.doc) retention.record(next.doc);
    state = next;
    for (const listener of listeners) listener(state);
  };
  let playbackNotice: string | undefined;
  const message = (error: unknown, warning = false) => {
    const text = String(error instanceof Error ? error.message : error);
    playbackNotice = warning ? text : undefined;
    update({ ...state, message: text });
  };
  function sounds() {
    const names = Object.values(state.events).flatMap((result) =>
      result.events.flatMap((e) => {
        const s = (e.value as { s?: unknown })?.s;
        return [s].flat().filter((name): name is string => typeof name === 'string');
      }),
    );
    return mergeSounds(state.sounds, names, engine?.sounds() ?? []);
  }
  const askWindow = (affected?: string[]) => track(questionWindow(affected));
  async function questionWindow(affected?: string[]) {
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
    if (switching || engineActivation !== epoch) return;
    if (event.type === 'swapped' || event.type === 'committed' || event.type === 'trigger')
      editor?.observe(event);
    if (event.type === 'error') message(event.message, !!event.reason);
    if (event.type === 'transport') {
      if (!event.playing) editor?.stopped();
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
  let switching = false;
  function replacePlayback(
    doc: Doc,
    options: Parameters<Engine['play']>[1] = {},
    whole = false,
    current?: () => boolean,
  ) {
    const piece = epoch,
      transport = transportRevision;
    const work = swaps.then(async () => {
      if (piece !== epoch || transport !== transportRevision || current?.() === false) return -1;
      const identity = discoveryIdentity(doc);
      engineActivation = piece;
      const revision = await engine!.play(
        generate(doc, { ...(whole ? {} : playbackOptions(state)), instrumentTags: true }),
        {
          discoverCycles: sections(doc).map((s) => s.start),
          ...options,
          discovery: identity
            ? { scope: discoveryScope, identity: `${whole ? '' : (state.solo ?? '')}:${identity}` }
            : undefined,
        },
      );
      if (piece !== epoch || transport !== transportRevision) {
        engine?.stop();
        return -1;
      }
      if (current?.() === false) {
        // A newer edit/load during engine preparation owns the score. Restore it
        // inside this queue slot, before another replacement can run.
        if (state.doc && engine?.playing && piece === epoch && transport === transportRevision)
          await engine.play(
            generate(state.doc, { ...playbackOptions(state), instrumentTags: true }),
            { discoverCycles: sections(state.doc).map((s) => s.start) },
          );
        return -1;
      }
      return revision;
    });
    swaps = work.then(
      () => {},
      () => {},
    );
    return work;
  }
  const play = () => track(startPlayback());
  async function startPlayback() {
    if (!state.doc || !checked || starting || loading) return;
    const piece = epoch,
      transport = ++transportRevision;
    starting = true;
    playbackFailed = false;
    discoveryScope = {};
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
      engine ??= await (engineCreation ??= createEngine().catch((error) => {
        engineCreation = undefined;
        throw error;
      }));
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
        update({
          ...state,
          message: state.message === 'Preparing sounds…' ? '' : state.message,
          sounds: sounds(),
        });
    } catch (error) {
      if (piece === epoch && transport === transportRevision) {
        playbackFailed = true;
        message(error);
      }
    } finally {
      if (piece === epoch && transport === transportRevision) {
        starting = false;
        update({ ...state });
      }
    }
  }
  let subscribed = false;
  const loadDocument = (...args: Parameters<typeof installDocument>) =>
    track(installDocument(...args));
  async function installDocument(
    value: unknown,
    source = '',
    warnings: ImportWarning[] = [],
    restore = true,
  ) {
    const request = ++loadRevision,
      before = state.doc;
    let doc: Doc;
    try {
      doc = migrate(value);
      generate(doc);
    } catch (error) {
      update({ ...state, loadError: `Could not open document: ${String(error)}` });
      return;
    }
    if (
      (restoredDocument ||
        editor?.canUndo ||
        editor?.canRedo ||
        (retention.candidate && documentJSON(doc) !== documentJSON(retention.candidate))) &&
      !practice &&
      options.confirmReplacement &&
      !(await options.confirmReplacement())
    )
      return;
    if (request !== loadRevision || state.doc !== before) return;
    loading = request;
    discoveryScope = {};
    update({ ...state, loadError: '' });
    try {
      // Stage replacements before touching the existing session, history or transport.
      let result: EventResult | undefined;
      if (before || restore) {
        const from = restore ? 0 : Math.max(0, engine?.now() ?? 0);
        result = await preflight.query(generate(doc), from, from + 16);
        if (request !== loadRevision || state.doc !== before) return;
        if (result.error) {
          update({ ...state, loadError: `Could not play this piece: ${result.error.message}` });
          return;
        }
        if (!restore && engine?.playing) {
          try {
            const revision = await replacePlayback(
              doc,
              { discoverCycles: sections(doc).map((s) => s.start) },
              true,
              () => request === loadRevision && state.doc === before,
            );
            if (revision < 0) return;
          } catch (error) {
            if (request !== loadRevision) return;
            update({ ...state, loadError: String(error) });
            return;
          }
        }
      }
      if (request !== loadRevision) return;
      if (restore) {
        ++transportRevision;
        engine?.stop();
      }
      editor?.dispose();
      dirtyRows.clear();
      const ownEditor = createEditSession(doc, {
        playing: () => !!engine?.playing,
        play: (doc) => replacePlayback(doc, { discoverCycles: sections(doc).map((s) => s.start) }),
        changed: (pending) => {
          if (editor === ownEditor) update(editedPiece(state, pending.doc));
        },
        refresh: (_doc: Doc, ids: string[]) => {
          if (editor !== ownEditor || !ids.length) return;
          cachedWindow = null;
          ids.forEach((id) => dirtyRows.add(id));
          void askWindow([...dirtyRows]);
        },
      });
      editor = ownEditor;
      const piece = ++epoch;
      if (engine?.playing) engineActivation = piece;
      discoveryScope = {};
      checked = false;
      cachedWindow = null;
      queries.cancel();
      restoredDocument = restore;
      retention.adopt();
      update({ ...loadPiece(state, source, { doc, warnings }), message: 'Asking the score…' });
      const answers = askWindow();
      result ??= await preflight.query(generate(doc), 0, 16);
      if (piece !== epoch) return;
      checked = !result.error;
      update({
        ...state,
        cps: result.error ? null : result.cps,
        message: result.error ? `Could not play this piece: ${result.error.message}` : '',
      });
      await answers;
    } finally {
      if (loading === request) {
        loading = 0;
        update({ ...state });
      }
    }
  }
  let original: {
    state: AppState;
    editor: EditSession | null;
    retention: typeof retention;
    cachedWindow: { from: number; to: number; events: AppState['events'] } | null;
    checked: boolean;
    restoredDocument: boolean;
    playbackNotice: string | undefined;
  } | null = null;
  function invalidate() {
    switching = true;
    ++epoch;
    ++loadRevision;
    ++transportRevision;
    ++windowRevision;
    queries.cancel();
    preflight.cancel();
    resetWatch();
    starting = false;
    loading = 0;
    engine?.stop();
    discoveryScope = {};
    dirtyRows.clear();
    switching = false;
  }
  return {
    get warning() {
      return !!state.message && state.message === playbackNotice;
    },
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
      if (watchOpen === open) return;
      watchOpen = open;
      resetWatch();
    },
    watchInput,
    get canPlay() {
      return checked && !starting && !loading;
    },
    subscribe(listener: (state: AppState) => void) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    get retention() {
      return retention;
    },
    get activation() {
      return epoch;
    },
    get practice() {
      return practice;
    },
    get preparing() {
      return preparing;
    },
    /** Wait for submitted work, including validation, queued swaps and score answers.
     * Cancellation leaves the original active; display-pending sparse notes do not block. */
    async beginPractice(signal: AbortSignal, park: () => void = () => {}) {
      if (practice || preparing) return false;
      preparing = true;
      try {
        do {
          await editor?.settle();
          await Promise.allSettled([...work, swaps]);
          if (signal.aborted) return false;
        } while (work.size);
        if (
          signal.aborted ||
          !(await (editor?.settle() ?? Promise.resolve(true))) ||
          playbackFailed ||
          state.loadError ||
          (state.doc && (!checked || Object.values(state.events).some((e) => e.error)))
        )
          return false;
        park();
        original = {
          state,
          editor,
          retention,
          cachedWindow,
          checked,
          restoredDocument,
          playbackNotice,
        };
        editor?.suspend(true);
        invalidate();
        practice = true;
        retention = createRetention({ persistent: false });
        editor = null;
        state = initialState();
        checked = false;
        restoredDocument = false;
        cachedWindow = null;
        playbackNotice = undefined;
        playbackFailed = false;
        update(state);
        return true;
      } finally {
        preparing = false;
      }
    },
    endPractice(restore: () => void = () => {}) {
      if (!practice || !original) return;
      invalidate();
      editor?.dispose();
      ({ state, editor, retention, cachedWindow, checked, restoredDocument, playbackNotice } =
        original);
      original = null;
      practice = false;
      restore();
      editor?.suspend(false);
      // Stop never clears original history or adds an edit.
      state = { ...state, playing: false };
      update(state);
    },
    loadDocument,
    async openDocument(text: string) {
      try {
        await loadDocument(readDocument(text));
      } catch (error) {
        update({ ...state, loadError: `Could not open document: ${String(error)}` });
      }
    },
    async recover() {
      if (retention.candidate) await loadDocument(retention.candidate);
    },
    downloadDocument() {
      return state.doc ? documentJSON(state.doc) : null;
    },
    exportStrudel() {
      return state.doc ? generate(state.doc) : null;
    },
    async load(source: string) {
      try {
        const imported = importStrudel(source);
        await loadDocument(imported.doc, source, imported.warnings, false);
      } catch {
        update(loadFailure(state));
      }
    },
    solo(id: string | null) {
      const next = setSolo(state, id);
      if (next === state) return;
      discoveryScope = {};
      const previous = state.solo,
        piece = epoch;
      update(next);
      if (engine?.playing && state.doc)
        void track(
          replacePlayback(state.doc).catch((error) => {
            if (piece !== epoch || state.solo !== id) return;
            playbackFailed = true;
            update(setSolo(state, previous));
            message(error);
          }),
        );
    },
    play,
    dismissSoundNotice() {
      update({ ...state, soundNotice: { ...state.soundNotice, visible: false } });
    },
    stop() {
      discoveryScope = {};
      ++transportRevision;
      starting = false;
      playbackFailed = false;
      engine?.stop();
      editor?.stopped();
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
      if (now !== null) editor?.observe({ type: 'progress', cycle: now });
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
