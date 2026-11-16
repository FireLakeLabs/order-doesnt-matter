import { createApp } from '../app/controller';
import { replacement } from './replacement';
import { examples } from '../app/examples';
import { livePlayhead } from '../live/playhead';
import { createStore } from './store';
import { actualCps, createTransportStore, wrapCycle } from './transport';
import { checkLoop, checkSpeed } from '../engine/transport';
import type { CycleLoop, PlaybackSpeed } from '../contract';

export const transport = createTransportStore();
// Page lifetime ownership. React effects never create controllers, workers or audio.
export const app = createApp({
  confirmReplacement: () => replacement.request(),
  configureEngine(engine) {
    engine.setSpeed(transport.getSnapshot().speed);
    void engine.setLoop(transport.getSnapshot().loop).catch(() => {
      // The engine reports playback errors; Stop can cancel this setup.
    });
  },
});
export const store = createStore(app);
let held = 0;
let paused = false;
let resumeScrub = false;
let seeking = 0;
let generation = 0;
export const runtime = {
  app,
  store,
  transport,
  getCps() {
    return actualCps(app.state.cps ?? 0.5, transport.getSnapshot().speed);
  },
  getPlayhead(cps?: number) {
    if (transport.getSnapshot().scrubbing || seeking) return held;
    const now = app.frame();
    if (now !== null)
      held = wrapCycle(
        livePlayhead(now, cps ?? this.getCps(), app.engine?.outputLatency()) ?? 0,
        transport.getSnapshot().loop,
      );
    return Math.max(0, held);
  },
  sample() {
    const cps = this.getCps();
    return {
      now: this.getPlayhead(cps),
      cps,
      playing: app.state.playing && !transport.getSnapshot().scrubbing,
    };
  },
  async play() {
    const token = generation;
    await app.play(paused ? held : transport.getSnapshot().loop?.from);
    if (token === generation && app.state.playing) paused = false;
  },
  pause() {
    this.getPlayhead();
    generation++;
    resumeScrub = false;
    app.stop();
    paused = true;
  },
  stop() {
    this.pause();
    held = 0;
    paused = false;
    transport.update({ scrubbing: false });
  },
  setSpeed(speed: PlaybackSpeed) {
    checkSpeed(speed);
    app.engine?.setSpeed(speed);
    transport.update({ speed });
  },
  async seek(cycle: number) {
    if (!Number.isFinite(cycle)) return;
    const position = wrapCycle(Math.max(0, cycle), transport.getSnapshot().loop);
    const token = ++generation;
    held = position;
    paused = !app.state.playing;
    if (!app.engine?.playing) return;
    seeking++;
    try {
      await app.engine.seek(position);
    } catch {
      /* The engine reports failures through the controller's existing notice. */
    } finally {
      seeking--;
      if (token === generation && !app.state.playing) paused = true;
    }
  },
  step(direction: -1 | 1) {
    if (!app.state.playing && !transport.getSnapshot().scrubbing)
      void this.seek(held + direction / 4);
  },
  beginScrub() {
    if (transport.getSnapshot().scrubbing) return;
    this.getPlayhead();
    const playing = app.state.playing;
    this.pause();
    app.engine?.silence();
    resumeScrub = playing;
    transport.update({ scrubbing: true });
  },
  scrubTo(cycle: number) {
    if (transport.getSnapshot().scrubbing && Number.isFinite(cycle)) held = Math.max(0, cycle);
  },
  async endScrub() {
    if (!transport.getSnapshot().scrubbing) return;
    const resume = resumeScrub;
    resumeScrub = false;
    held = wrapCycle(held, transport.getSnapshot().loop);
    transport.update({ scrubbing: false });
    if (resume) await this.play();
  },
  async setLoop(loop: CycleLoop | null) {
    checkLoop(loop);
    try {
      await app.engine?.setLoop(loop);
      transport.update({ loop, marking: false });
      held = wrapCycle(held, loop);
    } catch {
      /* Retain the previous range when preflight rejects the new one. */
    }
  },
  toggleLoop() {
    if (transport.getSnapshot().loop) void this.setLoop(null);
    else transport.update({ marking: !transport.getSnapshot().marking });
  },
  async replaceWork(load: () => Promise<void>) {
    const before = app.activation;
    await load();
    if (before !== app.activation) {
      generation++;
      await this.setLoop(null);
      held = 0;
      paused = false;
      resumeScrub = false;
      transport.update({ scrubbing: false, marking: false });
    }
  },
  load(source: string) {
    return this.replaceWork(() => app.load(source));
  },
  recover() {
    return this.replaceWork(() => app.recover());
  },
  openDocument(text: string) {
    return this.replaceWork(() => app.openDocument(text));
  },
};
// Recovery is explicit, exactly as on the original page. Never overwrite a candidate.
export const ready = app.retention.candidate ? Promise.resolve() : runtime.load(examples[0].source);
