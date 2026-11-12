import type { CreateEngine, Engine, EngineEvent, OutputTap } from '../contract';
import { message, Revision, SoundBook } from './logic';
import { PlaybackNotice, PlaybackOverrun, PREFLIGHT_TIMEOUT } from './playback-limits';

export interface AudioBackend {
  prepare(
    code: string,
    from: number,
    revision: number,
  ): Promise<{ values: unknown[]; commit(): Promise<void> }>;
  preflight(code: string, from: number, starts: number[]): Promise<unknown[]>;
  check(value: unknown): Promise<void>;
  key?(value: unknown): string;
  resume(): Promise<void>;
  stop(): void;
  playing(): boolean;
  now(): number;
  time(): number;
  outputLatency(): number;
  seek(cycle: number): void;
  tap: OutputTap;
}
export type Dispatch = (
  revision: number,
  value: unknown,
  cycle: number,
  time: number,
  render: () => Promise<void>,
  instrument?: string,
) => Promise<void>;
export type SilentWindow = (revision: number, cycle: number, time: number) => void;
/** Injection keeps queue, revision and cancellation behavior testable without audio. */
export function engineWith(
  audio: AudioBackend,
  connect: (dispatch: Dispatch, error: (e: unknown) => void, silent: SilentWindow) => void,
): Engine {
  const listeners = new Set<(e: EngineEvent) => void>(),
    revisions = new Revision();
  const emit = (event: EngineEvent) => {
    for (const listener of listeners) listener(event);
  };
  const error = (e: unknown) => {
    if (e instanceof PlaybackOverrun) {
      overrun = { epoch, error: e };
      // A first tick may run inside clock.start(), before Strudel sets started.
      // Wait until that stack unwinds; the guard already drops all further haps.
      queueMicrotask(stop);
    }
    emit({
      type: 'error',
      message: message(e),
      ...(e instanceof PlaybackNotice ? { reason: e.reason } : {}),
    });
  };
  let queue = Promise.resolve(),
    epoch = 0,
    active = 0,
    enabled = false;
  let overrun: { epoch: number; error: PlaybackOverrun } | undefined;
  const cancelled = (token: number) =>
    overrun?.epoch === token ? overrun.error : Error('Playback cancelled by stop');
  const books = new Map<number, SoundBook>();
  let book = new SoundBook(audio.check, () => {});
  connect(
    async (revision, value, cycle, time, render, instrument) => {
      const token = epoch,
        current = books.get(revision);
      if (!enabled || !current) return;
      const ready = await current.observe(value);
      if (token !== epoch || !enabled) return;
      try {
        if (ready) await render();
        if (token !== epoch) return;
        emit({
          type: 'trigger',
          value,
          cycle,
          time,
          revision,
          ...(instrument ? { instrument } : {}),
        });
        if (revisions.trigger(revision)) emit({ type: 'swapped', revision, cycle, time });
      } catch (e) {
        error(e);
        throw e;
      }
    },
    error,
    (revision, cycle, time) => {
      if (enabled && books.has(revision) && revisions.commit(revision))
        emit({ type: 'committed', revision, cycle, time });
    },
  );
  function stop() {
    enabled = false;
    epoch++;
    audio.stop();
    books.clear();
    emit({ type: 'transport', playing: false });
  }
  return {
    play(code, options = {}) {
      const token = epoch;
      const work = queue.then(async () => {
        try {
          if (options.fromCycle !== undefined && !Number.isFinite(options.fromCycle))
            throw Error('Start cycle must be finite');
          await audio.resume();
          if (token !== epoch) throw cancelled(token);
          const from = options.fromCycle ?? (audio.playing() ? Math.max(0, audio.now()) : 0);
          const discovered = await audio.preflight(
            code,
            from,
            (options.discoverCycles ?? []).slice(0, 32),
          );
          if (token !== epoch) throw cancelled(token);
          const revision = active + 1;
          const candidate = await audio.prepare(code, from, revision);
          const next = new SoundBook(
            audio.check,
            () => {
              if (book === next) emit({ type: 'sounds', sounds: next.list() });
            },
            audio.key,
          );
          const previous = book;
          book = next;
          emit({ type: 'sounds', sounds: [] });
          await Promise.all(
            [...candidate.values, ...discovered].map((value) => next.observe(value)),
          );
          if (token !== epoch) {
            book = previous;
            throw cancelled(token);
          }
          const wasPlaying = audio.playing();
          if (options.fromCycle !== undefined && wasPlaying) audio.stop();
          if (!audio.playing()) audio.seek(options.fromCycle ?? 0);
          books.set(revision, next);
          active = revisions.next();
          enabled = true;
          try {
            await candidate.commit();
          } catch (e) {
            book = previous;
            enabled = wasPlaying;
            throw e;
          }
          if (token !== epoch) {
            audio.stop();
            throw cancelled(token);
          }
          // Keep the immediately preceding book for notes already in the scheduler horizon.
          for (const key of books.keys()) if (key < active - 1) books.delete(key);
          if (!wasPlaying) emit({ type: 'transport', playing: true });
          return revision;
        } catch (e) {
          if (e !== overrun?.error) error(e);
          throw e;
        }
      });
      queue = work.then(
        () => {},
        () => {},
      );
      return work;
    },
    stop,
    get playing() {
      return audio.playing();
    },
    now: () => (audio.playing() ? audio.now() : null),
    audioTime: audio.time,
    outputLatency: audio.outputLatency,
    sounds: () => book.list(),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    tap: () => audio.tap,
  };
}
export const createEngine: CreateEngine = async () => {
  const { createAudio } = await import('../strudel/audio');
  const audio = await createAudio();
  const { createBrowserQueries } = await import('../strudel/evaluate-browser');
  const queries = createBrowserQueries();
  return engineWith(
    {
      ...audio,
      async preflight(code, from, starts) {
        const result = await queries.preflight(code, from, starts, audio.cps());
        if (result.error)
          throw Error(
            result.error.phase === 'timeout'
              ? PREFLIGHT_TIMEOUT
              : 'This program could not be checked, so it was not played.',
          );
        return result.events.map((e) => e.value);
      },
    },
    audio.connect,
  );
};
