import type { CreateEngine, Engine, EngineEvent, OutputTap } from '../contract';
import { checkLoop, checkSpeed, wrapCycle } from './transport';
import type { CycleLoop, PlaybackSpeed } from '../contract';
import { message, Revision, SoundBook } from './logic';
import { PlaybackNotice, PlaybackOverrun, PREFLIGHT_TIMEOUT } from './playback-limits';

export interface AudioBackend {
  prepare(
    code: string,
    from: number,
    revision: number,
  ): Promise<{ values: unknown[]; commit(): Promise<void> }>;
  preflight(
    code: string,
    from: number,
    starts: number[],
  ): Promise<{ values: unknown[]; discoveryValues: unknown[] }>;
  check(value: unknown): Promise<void>;
  key?(value: unknown): string;
  resume(): Promise<void>;
  stop(): void;
  playing(): boolean;
  now(): number;
  time(): number;
  outputLatency(): number;
  seek(cycle: number): void;
  setSpeed?(speed: PlaybackSpeed): void;
  setLoop?(loop: CycleLoop | null): void;
  silence?(): void;
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
// Audio engines share Strudel's page registry. Unmodelled evaluation can mutate
// it permanently; new engines do not make it pure again. Reload does.
const pageRegistry = { epoch: 0, trusted: true };
/** Injection keeps queue, revision and cancellation behavior testable without audio. */
export function engineWith(
  audio: AudioBackend,
  connect: (dispatch: Dispatch, error: (e: unknown) => void, silent: SilentWindow) => void,
  registry = { epoch: 0, trusted: true },
): Engine {
  let saved: { code: string; options: Parameters<Engine['play']>[1] } | undefined;
  let loop: CycleLoop | null = null;
  let triggerEpoch = 0;
  let inventory:
    | { scope: object; identity: string; starts: string; values: unknown[]; registry: number }
    | undefined;
  let discoveryRevision = 0;
  const clearInventory = () => {
    inventory = undefined;
    discoveryRevision++;
  };
  const listeners = new Set<(e: EngineEvent) => void>(),
    revisions = new Revision();
  const emit = (event: EngineEvent) => {
    for (const listener of listeners) listener(event);
  };
  const error = (e: unknown) => {
    clearInventory();
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
        generation = triggerEpoch,
        current = books.get(revision);
      if (!enabled || !current) return;
      const ready = await current.observe(value);
      if (token !== epoch || generation !== triggerEpoch || !enabled) return;
      try {
        if (ready) await render();
        if (token !== epoch || generation !== triggerEpoch) return;
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
    clearInventory();
    enabled = false;
    epoch++;
    triggerEpoch++;
    audio.stop();
    books.clear();
    emit({ type: 'transport', playing: false });
  }
  async function waitForSwaps(token: number) {
    let pending: Promise<void>;
    do {
      pending = queue;
      await pending;
    } while (pending !== queue);
    return token === epoch;
  }
  const engine: Engine = {
    setSpeed(speed) {
      checkSpeed(speed);
      audio.setSpeed?.(speed);
    },
    async setLoop(next) {
      checkLoop(next);
      const token = epoch;
      if (!(await waitForSwaps(token))) throw cancelled(token);
      const copy = next ? { ...next } : null;
      if (saved && audio.playing()) {
        await engine.play(saved.code, {
          ...saved.options,
          fromCycle: wrapCycle(Math.max(0, audio.now()), copy),
          loop: copy,
          discardScheduledAudio: true,
        });
      } else {
        loop = copy;
        audio.setLoop?.(copy);
      }
    },
    async seek(cycle) {
      if (!Number.isFinite(cycle) || cycle < 0)
        throw Error('Seek cycle must be finite and positive');
      const token = epoch;
      if (!(await waitForSwaps(token))) return;
      if (saved && audio.playing())
        await engine.play(saved.code, {
          ...saved.options,
          fromCycle: wrapCycle(cycle, loop),
          loop,
          discardScheduledAudio: true,
        });
      else audio.seek(wrapCycle(cycle, loop));
    },
    silence: () => audio.silence?.(),
    play(code, options = {}) {
      const token = epoch;
      const work = queue.then(async () => {
        try {
          if (options.fromCycle !== undefined && !Number.isFinite(options.fromCycle))
            throw Error('Start cycle must be finite');
          if (options.loop !== undefined) checkLoop(options.loop);
          await audio.resume();
          if (token !== epoch) throw cancelled(token);
          const from = options.fromCycle ?? (audio.playing() ? Math.max(0, audio.now()) : 0);
          const proof = options.discovery,
            starts = (options.discoverCycles ?? []).slice(0, 32),
            startKey = JSON.stringify(starts),
            generation = discoveryRevision,
            registryEpoch = registry.epoch;
          const reuse =
            proof &&
            registry.trusted &&
            inventory?.scope === proof.scope &&
            inventory.identity === proof.identity &&
            inventory.starts === startKey &&
            inventory.registry === registryEpoch
              ? inventory.values
              : [];
          // A loop can wrap before the destination window ends. Check and load
          // every part of the range, including cycles behind the seek position.
          const checkingLoop = options.loop === undefined ? loop : options.loop;
          const discovered = { values: [] as unknown[], discoveryValues: [] as unknown[] };
          for (let start = checkingLoop?.from ?? from; ; start += 16) {
            const result = await audio.preflight(
              code,
              start,
              reuse.length || start !== (checkingLoop?.from ?? from) ? [] : starts,
            );
            if (token !== epoch) throw cancelled(token);
            discovered.values.push(...result.values);
            discovered.discoveryValues.push(...result.discoveryValues);
            if (!checkingLoop || start + 16 >= checkingLoop.to) break;
          }
          const staleInventory = () =>
            reuse.length &&
            (generation !== discoveryRevision ||
              registry.epoch !== registryEpoch ||
              !registry.trusted);
          if (staleInventory())
            throw Error('Section inventory changed during playback preparation');
          const revision = active + 1;
          if (!proof) {
            registry.trusted = false;
            registry.epoch++;
          }
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
            [...candidate.values, ...discovered.values, ...reuse].map((value) =>
              next.observe(value),
            ),
          );
          if (token !== epoch) {
            book = previous;
            throw cancelled(token);
          }
          if (staleInventory()) {
            book = previous;
            throw Error('Section inventory changed during playback preparation');
          }
          const wasPlaying = audio.playing();
          if (options.fromCycle !== undefined && wasPlaying) {
            audio.stop();
            if (options.discardScheduledAudio) {
              triggerEpoch++;
              audio.silence?.();
              books.clear();
            }
          }
          if (options.loop !== undefined) loop = options.loop ? { ...options.loop } : null;
          audio.setLoop?.(loop);
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
          if (
            proof &&
            registry.trusted &&
            registry.epoch === registryEpoch &&
            generation === discoveryRevision
          )
            inventory = {
              ...proof,
              starts: startKey,
              values: reuse.length ? reuse : discovered.discoveryValues,
              registry: registryEpoch,
            };
          else clearInventory();
          saved = { code, options };
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
  return engine;
}
export const createEngine: CreateEngine = async () => {
  pageRegistry.epoch++;
  const { createAudio } = await import('../strudel/audio');
  const audio = await createAudio();
  pageRegistry.epoch++;
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
        return {
          values: result.events.map((e) => e.value),
          discoveryValues: result.discoveryValues ?? [],
        };
      },
    },
    audio.connect,
    pageRegistry,
  );
};
