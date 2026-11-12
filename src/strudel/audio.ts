// Use the web bundle's exports together: it owns its audio context and registry.
import {
  initStrudel,
  webaudioOutput,
  getAudioContext,
  initAudio,
  getSound,
  getSampleInfo,
  loadBuffer,
  samples,
  getSuperdoughAudioController,
} from '@strudel/web';
import { silence } from '@strudel/core';
import { playheadCycle, seekTo } from './index';
import type { Hap, Pattern } from './index';
import type { AudioBackend, Dispatch, SilentWindow } from '../engine';
import { soundName } from '../engine/logic';
import { createTap } from './audio-tap';
import { guarded, schedulingBoundary } from './audio-pattern';

export const defaultCollections = [
  ...['tidal-drum-machines', 'piano', 'Dirt-Samples', 'EmuSP12', 'vcsl', 'mridangam'].map(
    (name) => `https://raw.githubusercontent.com/felixroos/dough-samples/main/${name}.json`,
  ),
  'https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json',
];
async function defaults() {
  const results = await Promise.allSettled(
    defaultCollections.map(async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(6500) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const map = await response.json();
      return { map, base: map._base ?? new URL('.', url).href };
    }),
  );
  let unavailable = results.some((result) => result.status === 'rejected');
  for (const result of results)
    if (result.status === 'fulfilled') {
      try {
        await samples(result.value.map, result.value.base);
      } catch {
        unavailable = true;
      }
    }
  return unavailable;
}
export async function createAudio({
  inspect,
}: { inspect?: (pattern: Pattern, cps: number) => void } = {}): Promise<
  Omit<AudioBackend, 'preflight'> & {
    cps(): number;
    connect(dispatch: Dispatch, error: (e: unknown) => void, silent: SilentWindow): void;
  }
> {
  let dispatch: Dispatch = async () => {},
    silent: SilentWindow = () => {},
    failed: (error: unknown) => void = () => {};
  const revisions = new WeakMap<Hap, number>();
  let committing: Promise<void>[] | undefined;
  let capture: ((p: Pattern) => Pattern) | undefined,
    installed = silence;
  const repl = await initStrudel({
    sync: false,
    miniAllStrings: false,
    editPattern: (p) => (capture ? capture(p) : p),
    defaultOutput: (hap, deadline, duration, cps, time) => {
      const work = dispatch(
        revisions.get(hap) ?? 0,
        hap.value && typeof hap.value === 'object' ? { ...hap.value } : hap.value,
        Number(hap.whole?.begin ?? hap.part.begin),
        time,
        () => webaudioOutput(hap, deadline, duration, cps, time),
      );
      committing?.push(work);
      return work;
    },
  });
  const unavailable = await defaults(),
    context = getAudioContext();
  // Depends on Superdough's private final gain, downstream of all orbit effects.
  const tap = await createTap(context, getSuperdoughAudioController().output.destinationGain);
  return {
    connect(output, error, empty) {
      silent = empty;
      dispatch = output;
      failed = error;
    },
    async prepare(code, _from, revision) {
      let candidate: Pattern | undefined;
      const oldCps = repl.scheduler.cps;
      // Depends on REPL editPattern running before setPattern, and evaluate(false)
      // retaining a running transport. Capture the result while reinstalling the old pattern.
      capture = (p) => {
        candidate = p;
        return installed;
      };
      let cps: number;
      try {
        await repl.evaluate(code, false);
        if (repl.state.error) throw repl.state.error;
        cps = repl.scheduler.cps;
      } finally {
        capture = undefined;
        repl.setCps(oldCps);
      }
      if (!candidate) throw Error('Strudel evaluation produced no pattern');
      const pattern = candidate;
      inspect?.(pattern, cps);
      const wrapped = guarded(
        pattern,
        failed,
        (hap) => revisions.set(hap, revision),
        (state) => {
          const { cycle, time } = schedulingBoundary(repl.scheduler, state);
          silent(revision, cycle, time);
        },
      );
      return {
        values: [],
        async commit() {
          const previous = installed,
            wasPlaying = repl.scheduler.started;
          committing = [];
          try {
            repl.setCps(cps);
            await repl.setPattern(wrapped, true);
            await Promise.all(committing);
            installed = wrapped;
          } catch (error) {
            repl.setCps(oldCps);
            await repl.setPattern(previous, false);
            if (!wasPlaying) repl.stop();
            throw error;
          } finally {
            committing = undefined;
          }
        },
      };
    },
    key(value) {
      const name = soundName(value),
        sound = getSound(name);
      try {
        return (
          name + (sound?.data.type === 'sample' ? getSampleInfo(value, sound.data.samples).url : '')
        );
      } catch {
        return name + JSON.stringify(value);
      }
    },
    async check(value) {
      const name = soundName(value),
        sound = getSound(name);
      if (!sound)
        throw Error(
          `Unknown sound "${name}". Register it with samples(...).${unavailable ? ' Default collections could not load (offline or network error).' : ''}`,
        );
      if (sound.data.type !== 'sample') return;
      try {
        const { url } = getSampleInfo(value, sound.data.samples);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            loadBuffer(url, context, name),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(Error('Download timed out; check your connection')),
                7000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        throw Error(
          `File for "${name}" failed to load. Check its URL and connection (possibly offline): ${String(error)}`,
        );
      }
    },
    async resume() {
      await context.resume();
      await initAudio();
    },
    stop: () => repl.stop(),
    playing: () => repl.scheduler.started,
    now: () => playheadCycle(repl.scheduler),
    time: () => context.currentTime,
    cps: () => repl.scheduler.cps,
    seek: (cycle) => {
      // The accessor validates phase anchors; Cyclist initializes one only on its first tick.
      repl.scheduler.seconds_at_cps_change ??= context.currentTime;
      seekTo(repl.scheduler, cycle, context.currentTime);
    },
    tap,
  };
}
