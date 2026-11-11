import type { CreateEngine, Engine, EngineEvent, OutputTap } from '../contract';
import { message, Revision, SoundBook } from './logic';

export interface AudioBackend {
  prepare(
    code: string,
    from: number,
    revision: number,
  ): Promise<{ values: unknown[]; commit(): Promise<void> }>;
  check(value: unknown): Promise<void>;
  key?(value: unknown): string;
  resume(): Promise<void>;
  stop(): void;
  playing(): boolean;
  now(): number;
  time(): number;
  seek(cycle: number): void;
  tap: OutputTap;
}
export type Dispatch = (
  revision: number,
  value: unknown,
  cycle: number,
  time: number,
  render: () => Promise<void>,
) => Promise<void>;
/** Injection keeps queue, revision and cancellation behavior testable without audio. */
export function engineWith(
  audio: AudioBackend,
  connect: (dispatch: Dispatch, error: (e: unknown) => void) => void,
): Engine {
  const listeners = new Set<(e: EngineEvent) => void>(),
    revisions = new Revision();
  const emit = (event: EngineEvent) => {
    for (const listener of listeners) listener(event);
  };
  const error = (e: unknown) => emit({ type: 'error', message: message(e) });
  let queue = Promise.resolve(),
    epoch = 0,
    active = 0,
    enabled = false;
  const books = new Map<number, SoundBook>();
  let book = new SoundBook(audio.check, () => {});
  connect(async (revision, value, cycle, time, render) => {
    const token = epoch,
      current = books.get(revision);
    if (!enabled || !current) return;
    const ready = await current.observe(value);
    if (token !== epoch || !enabled) return;
    try {
      if (ready) await render();
      if (token !== epoch) return;
      emit({ type: 'trigger', value, cycle, time });
      if (revisions.trigger(revision)) emit({ type: 'swapped', revision, cycle, time });
    } catch (e) {
      error(e);
      throw e;
    }
  }, error);
  return {
    play(code, options = {}) {
      const token = epoch;
      const work = queue.then(async () => {
        try {
          if (options.fromCycle !== undefined && !Number.isFinite(options.fromCycle))
            throw Error('Start cycle must be finite');
          await audio.resume();
          if (token !== epoch) throw Error('Playback cancelled by stop');
          const revision = active + 1;
          const candidate = await audio.prepare(
            code,
            options.fromCycle ?? (audio.playing() ? Math.max(0, audio.now()) : 0),
            revision,
          );
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
          await Promise.all(candidate.values.map((value) => next.observe(value)));
          if (token !== epoch) {
            book = previous;
            throw Error('Playback cancelled by stop');
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
            throw Error('Playback cancelled by stop');
          }
          // Keep the immediately preceding book for notes already in the scheduler horizon.
          for (const key of books.keys()) if (key < active - 1) books.delete(key);
          if (!wasPlaying) emit({ type: 'transport', playing: true });
          return revision;
        } catch (e) {
          error(e);
          throw e;
        }
      });
      queue = work.then(
        () => {},
        () => {},
      );
      return work;
    },
    stop() {
      enabled = false;
      epoch++;
      audio.stop();
      books.clear();
      emit({ type: 'transport', playing: false });
    },
    get playing() {
      return audio.playing();
    },
    now: () => (audio.playing() ? audio.now() : null),
    audioTime: audio.time,
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
  return engineWith(audio, audio.connect);
};
