import { initStrudel, getAudioContext, initAudio } from '@strudel/web';
import type { Event } from './scene';
export type Hap = { whole: { begin: number; end: number }; value: Record<string, unknown>; hasOnset(): boolean };
export type Pattern = { queryArc(a: number, b: number): Hap[]; onTrigger(fn: (hap: Hap, time: number, cps: number, target: number) => void, dominant: boolean): Pattern };
export type Sample = { revision: number; gesture: string; eventAt: number; swappedAt: number; latency: number; audioAtSwap: number; queriedThrough: number; code: string };
export type Trigger = { revision: number; loggedAt: number; audioNow: number; target: number; begin: number; note: unknown; voice: unknown; gain: unknown; ghost: unknown };
type Repl = { evaluate(code: string, autoplay: boolean): Promise<Pattern | undefined>; scheduler: { now(): number; lastEnd: number; cps: number; started: boolean; seconds_at_cps_change: number; num_cycles_at_cps_change: number; latency: number }; stop(): void; state: { error?: Error } };
export function query(pattern: Pattern): Event[] {
  return pattern.queryArc(0, 1).map(h => ({ begin: Number(h.whole.begin), end: Number(h.whole.end), note: Number(h.value.note), voice: String(h.value.voice), step: String(h.value.step), ghost: Boolean(h.value.ghost), lpf: Number(h.value.cutoff), gain: Number(h.value.gain) }));
}
export class Engine {
  repl?: Repl; samples: Sample[] = []; triggers: Trigger[] = []; revision = 0; playing = false; private queue = Promise.resolve(); private evaluatingRevision = 0;
  async init(): Promise<void> {
    this.repl = await initStrudel({ sync: false, miniAllStrings: false,
      editPattern: (p: Pattern) => { const revision = this.evaluatingRevision; return p.onTrigger((h, _t, _cps, target) => {
        this.triggers.push({ revision, loggedAt: performance.now(), audioNow: getAudioContext().currentTime, target, begin: Number(h.whole.begin), note: h.value.note, voice: h.value.voice, gain: h.value.gain, ghost: h.value.ghost });
        if (this.triggers.length > 5000) this.triggers.shift();
      }, false); },
    });
  }
  update(code: string, gesture: string, eventAt: number): Promise<Event[]> {
    const revision = ++this.revision;
    const work = this.queue.then(async () => {
      if (!this.repl) throw new Error('Engine not ready');
      this.evaluatingRevision = revision;
      const p = await this.repl.evaluate(code, this.playing);
      if (!p || this.repl.state.error) throw this.repl.state.error ?? new Error('No pattern');
      const swappedAt = performance.now();
      this.samples.push({ revision, gesture, eventAt, swappedAt, latency: swappedAt - eventAt, audioAtSwap: getAudioContext().currentTime, queriedThrough: this.repl.scheduler.lastEnd, code });
      return query(p);
    });
    this.queue = work.then(() => undefined, () => undefined);
    return work;
  }
  async play(code: string): Promise<void> { this.playing = true; await getAudioContext().resume(); await initAudio(); await this.update(code, 'play', performance.now()); }
  stop(): void { this.playing = false; this.repl?.stop(); }
  audioInfo() { const a = getAudioContext(); return { state: a.state, sampleRate: a.sampleRate, baseLatency: a.baseLatency, outputLatency: a.outputLatency ?? 0 }; }
  phase(): number {
    const s = this.repl?.scheduler;
    if (!s?.started) return 0;
    // Invert Cyclist's targetTime equation, rather than its query-ahead now().
    return s.num_cycles_at_cps_change + (getAudioContext().currentTime - s.seconds_at_cps_change - s.latency) * s.cps;
  }
}
