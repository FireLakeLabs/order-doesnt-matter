import { instruments } from '../document';
import { importStrudel } from '../import';
import { createSpiral, type SpiralInput } from './view';
import { turnNotes } from '../live/model';
const host = document.getElementById('harness')!;
const view = createSpiral(host);
const row = instruments(importStrudel('s("sawtooth")').doc)[0];
const rows = Array.from({ length: 30 }, (_, n) => ({
  ...row,
  id: String(n),
  name: `Instrument ${n + 1}`,
}));
const input: SpiralInput = {
  rows,
  sections: [],
  sounds: [],
  solo: null,
  playhead: 1.5,
  fromCycle: 0,
  toCycle: 5,
  known: [[0, 5]],
  end: null,
  events: Object.fromEntries(
    rows.map((r, n) => [
      r.id,
      {
        cps: 1,
        error: null,
        opaqueValues: false,
        events: Array.from({ length: n < 20 ? 67 : 66 }, (_, j) => {
          const start = j / 20;
          return {
            whole: [start, start + 0.04],
            part: [start, start + 0.04],
            hasOnset: true,
            value: { s: 'sawtooth' },
          };
        }),
      },
    ]),
  ),
};
view.update(input);
Object.assign(window, {
  odmSpiral: view,
  odmSpiralHarness: {
    input,
    render(now: number) {
      input.playhead = now;
      view.update(input);
    },
    async measure() {
      const times: number[] = [],
        notes = turnNotes(input, 0, 5);
      for (let n = 0; n < 300; n++) {
        await new Promise(requestAnimationFrame);
        input.playhead = 1 + n / 600;
        view.update(input);
        times.push(view.drawMs);
      }
      times.sort((a, b) => a - b);
      return { frames: times.length, notes: notes.length, median: times[150], worst: times.at(-1) };
    },
  },
});
