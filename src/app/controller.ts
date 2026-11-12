import { instruments, sections, walk, type Doc } from '../document';
import { createEditSession, type EditSession } from '../editor/session';
import type { Engine, EngineEvent, EventResult } from '../contract';
import { generate } from '../generate';
import { importStrudel } from '../import';
import { createEngine } from '../engine';
import { createBrowserQueries } from '../strudel/evaluate-browser';
import {
  initialState,
  loadPiece,
  loadFailure,
  selectSection,
  setFollow,
  tick,
  mergeSounds,
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
    if (event.type === 'swapped') editor?.observe(event);
    if (event.type === 'error') message(event.message);
    if (event.type === 'transport') {
      if (!event.playing) editor?.clear();
      update({ ...state, playing: event.playing });
    }
    if (event.type === 'sounds') update({ ...state, sounds: sounds() });
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
      const result = await preflight.query(generate(state.doc!), fromCycle, fromCycle + 16);
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
      await engine.play(generate(state.doc!), {
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
        play: (doc) =>
          engine!.play(generate(doc), { discoverCycles: sections(doc).map((s) => s.start) }),
        changed: (pending) =>
          update({
            ...state,
            doc: pending.doc,
            rows: instruments(pending.doc),
            sections: sections(pending.doc),
          }),
        refresh: (doc: Doc, targets: string[]) => {
          cachedWindow = null;
          const ids = instruments(doc)
            .filter((row) => {
              let found = false;
              walk(
                {
                  version: 1,
                  body: [
                    { kind: 'shared', id: 'scan', tier: 1, name: 'scan', pattern: row.pattern },
                  ],
                },
                (node) => {
                  found ||= targets.includes(node.id);
                },
              );
              return (
                found ||
                row.uses.some((use) =>
                  use.layers.some(
                    (l) =>
                      targets.includes(l.id) ||
                      (l.kind === 'settings' && l.settings.some((s) => targets.includes(s.id))),
                  ),
                )
              );
            })
            .map((row) => row.id);
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
          await engine.play(generate(imported.doc), {
            discoverCycles: sections(imported.doc).map((s) => s.start),
          });
        } catch (error) {
          message(error);
        }
      }
    },
    play,
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
