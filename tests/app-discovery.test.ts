import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { engineWith, type AudioBackend } from '../src/engine';
import { createApp } from '../src/app/controller';
import { createRetention, documentJSON } from '../src/app/retention';
import { walk, type Setting } from '../src/document';
import type { Engine } from '../src/contract';

const port = vi.hoisted(() => ({ create: undefined as undefined | (() => Promise<Engine>) }));
vi.mock('../src/engine', async (original) => ({
  ...(await original<typeof import('../src/engine')>()),
  createEngine: () => port.create!(),
}));
vi.mock('../src/strudel/evaluate-browser', () => ({
  createBrowserQueries: () => ({
    query: async () => ({ events: [], cps: 0.5, error: null }),
    cancel() {},
  }),
}));

test('controller scopes Kiln reuse across edit/Undo, solo, Stop/Play, open and recovery', async () => {
  vi.useFakeTimers();
  let playing = false;
  const starts: number[][] = [];
  const audio: AudioBackend = {
    async preflight(_code, _from, windows) {
      starts.push(windows);
      return { values: [{ s: 'late' }], discoveryValues: [{ s: 'late' }] };
    },
    prepare: async () => ({
      values: [],
      commit: async () => {
        playing = true;
      },
    }),
    check: async () => {},
    resume: async () => {},
    stop: () => {
      playing = false;
    },
    playing: () => playing,
    now: () => 4,
    time: () => 0,
    outputLatency: () => 0,
    seek() {},
    tap: {
      sampleRate: 48000,
      analyse: () => {
        throw Error('Unused fake analysis');
      },
      rms: async () => 0,
    },
  };
  port.create = async () => engineWith(audio, () => {});
  const retention = createRetention({ storage: () => ({ getItem: () => null, setItem() {} }) });
  const app = createApp({ retention });
  try {
    await app.load(readFileSync('corpus/programs/piece-kiln.strudel', 'utf8'));
    const original = app.state.doc!;
    let cutoff = '';
    walk(original, (n) => {
      if ('name' in n && n.name === 'cutoff') cutoff = (n as Setting).id;
    });
    await app.play();
    app.editor!.edit(cutoff, 900);
    await vi.advanceTimersByTimeAsync(100);
    app.editor!.undo();
    await vi.advanceTimersByTimeAsync(100);
    expect(starts).toEqual([[0, 4, 12, 28], [], []]);
    app.solo(app.state.rows[0].id);
    await vi.advanceTimersByTimeAsync(100);
    expect(starts.at(-1)).toEqual([0, 4, 12, 28]);
    app.stop();
    await app.play();
    expect(starts.at(-1)).toEqual([0, 4, 12, 28]);
    await app.openDocument(documentJSON(original));
    await app.play();
    expect(starts.at(-1)).toEqual([0, 4, 12, 28]);
    app.stop();
    const recovered = createApp({
      retention: createRetention({
        storage: () => ({ getItem: () => documentJSON(original), setItem() {} }),
      }),
    });
    await recovered.recover();
    await recovered.play();
    recovered.stop();
    recovered.editor?.dispose();
    expect(starts.at(-1)).toEqual([0, 4, 12, 28]);
    await app.load('s("sine").gain(slider(.4))');
    await app.play();
    expect(starts.at(-1)).toEqual([]);
  } finally {
    app.stop();
    app.editor?.dispose();
    vi.useRealTimers();
  }
});
