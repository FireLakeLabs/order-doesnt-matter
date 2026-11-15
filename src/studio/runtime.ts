import { createApp } from '../app/controller';
import { createRetention } from '../app/retention';
import { examples } from '../app/examples';
import { livePlayhead } from '../live/playhead';
import { createStore } from './store';

// Page lifetime ownership. React effects never create controllers, workers or audio.
// Studio does not overwrite the existing page's recovery document.
export const app = createApp({ retention: createRetention({ persistent: false }) });
export const store = createStore(app);
let held = 0;
let paused = false;
export const runtime = {
  app,
  store,
  getPlayhead() {
    const now = app.frame();
    if (now !== null)
      held = livePlayhead(now, app.state.cps ?? 0.5, app.engine?.outputLatency()) ?? 0;
    return Math.max(0, held);
  },
  async play() {
    // The controller owns preparation, transport cancellation and swaps.
    await app.play(paused ? held : undefined);
    if (app.state.playing) paused = false;
  },
  pause() {
    this.getPlayhead();
    app.stop();
    paused = true;
  },
  stop() {
    app.stop();
    held = 0;
    paused = false;
  },
  async load(source: string) {
    await app.load(source);
    if (!app.state.loadError) {
      held = 0;
      paused = false;
    }
  },
};
export const ready = runtime.load(examples[0].source);
