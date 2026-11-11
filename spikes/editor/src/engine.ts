import type { Doc } from "../../import/src/document";
import { generate } from "./adapter";
import { Sounds } from "./sounds";
export interface Dispatch {
  revision: number;
  target: number;
  begin: number;
  value: unknown;
}
type Repl = {
  evaluate(code: string, autoplay: boolean): Promise<unknown>;
  stop(): void;
  state: { error?: Error };
  scheduler: {
    started: boolean;
    seconds_at_cps_change: number;
    num_cycles_at_cps_change: number;
    cps: number;
    latency: number;
    lastEnd: number;
  };
};
export class Engine {
  repl?: Repl;
  sounds?: Sounds;
  onSoundsChanged = () => {};
  private initializing?: Promise<void>;
  playing = false;
  revision = 0;
  dispatches: Dispatch[] = [];
  private web?: typeof import("@strudel/web");
  private startCycle = 0;
  private queue = Promise.resolve();
  private transportVersion = 0;
  init(): Promise<void> {
    return (this.initializing ??= this.initialize());
  }
  private async initialize() {
    this.web = await import("@strudel/web");
    this.sounds = new Sounds(this.web, () => this.onSoundsChanged());
    this.repl = await this.web.initStrudel({
      prebake: () => this.sounds?.defaults(),
      defaultOutput: async (
        hap: { value: unknown },
        deadline: number,
        duration: number,
        cps: number,
        t: number,
      ) => {
        const value =
          hap.value && typeof hap.value === "object"
            ? { ...hap.value }
            : hap.value;
        await this.sounds?.observe(value);
        try {
          await this.web?.webaudioOutput(hap, deadline, duration, cps, t);
        } catch (e) {
          this.sounds?.failed(value, e);
        }
      },
      sync: false,
      miniAllStrings: false,
      editPattern: (p: {
        onTrigger(
          fn: (
            h: { whole: { begin: unknown }; value: unknown },
            t: number,
            cps: number,
            target: number,
          ) => void,
          dominant: boolean,
        ): unknown;
      }) => {
        const revision = this.revision;
        return p.onTrigger((h, _t, _cps, target) => {
          this.dispatches.push({
            revision,
            target,
            begin: Number(h.whole.begin),
            value: h.value,
          });
          if (this.dispatches.length > 2000) this.dispatches.shift();
        }, false);
      },
    });
  }
  async play(doc: Doc, fromCycle = 0) {
    const transportVersion = ++this.transportVersion;
    await this.init();
    if (transportVersion !== this.transportVersion) return;
    await this.sounds?.inspect(doc);
    if (transportVersion !== this.transportVersion) return;
    await this.web?.getAudioContext().resume();
    await this.web?.initAudio();
    if (transportVersion !== this.transportVersion) return;
    this.startCycle = fromCycle;
    // Cyclist's first tick starts from lastEnd; set it before autostart.
    if (this.repl) {
      this.repl.scheduler.lastEnd = fromCycle;
      this.repl.scheduler.num_cycles_at_cps_change = fromCycle;
      this.repl.scheduler.seconds_at_cps_change = this.audioTime();
    }
    this.playing = true;
    await this.swap(doc);
  }
  async inspect(doc: Doc) {
    await this.init();
    await this.sounds?.inspect(doc);
  }
  async swap(doc: Doc) {
    const source = generate(doc),
      transportVersion = this.transportVersion;
    const work = this.queue.then(async () => {
      if (
        !this.repl ||
        !this.playing ||
        transportVersion !== this.transportVersion
      )
        return;
      this.revision++;
      await this.repl.evaluate(source, true);
      if (this.repl.state.error) throw this.repl.state.error;
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  stop() {
    this.transportVersion++;
    this.playing = false;
    this.repl?.stop();
  }
  phase() {
    const s = this.repl?.scheduler;
    if (!s?.started || !this.web) return 0;
    return Math.max(
      this.startCycle,
      s.num_cycles_at_cps_change +
        (this.web.getAudioContext().currentTime -
          s.seconds_at_cps_change -
          s.latency) *
          s.cps,
    );
  }
  audioTime() {
    return this.web ? this.web.getAudioContext().currentTime : 0;
  }
  horizon() {
    return this.repl?.scheduler.lastEnd ?? 0;
  }
}
