import { expect, it, vi } from 'vitest';
import type { Engine } from '../src/contract';
import { createApp } from '../src/app/controller';
import { engineWith, type AudioBackend, type Dispatch } from '../src/engine';
import { replaceFromSource } from '../src/document/edits/source-node';
import { sheetModel } from '../src/sheet/model';
import { queryEventsNode } from './node-query';

let engine: Engine;
vi.mock('../src/engine', async (original) => ({
  ...(await original<typeof import('../src/engine')>()),
  createEngine: async () => engine,
}));
vi.mock('../src/strudel/evaluate-browser', () => ({
  createBrowserQueries: () => ({ query: queryEventsNode, cancel() {} }),
}));

// Real controller, edit coordinator, engine queue/SoundBook, importer, generator
// and Strudel queries. Only the browser worker and actual audio backend are replaced.
function backend() {
  const checks = new Map<string, { resolve(): void; reject(error: Error): void }>();
  let playing = false,
    dispatch!: Dispatch;
  const audio: AudioBackend = {
    preflight: async () => [],
    async prepare(code, _from, revision) {
      const result = await queryEventsNode(code, 0, 4);
      if (result.error) throw Error(result.error.message);
      const values = result.events.filter((e) => e.hasOnset).map((e) => e.value);
      return {
        values,
        async commit() {
          playing = true;
          if (values.length) await dispatch(revision, values[0], 0, 0, async () => {});
        },
      };
    },
    check(value) {
      const name = (value as { s: string }).s;
      if (name === 'sine') return Promise.resolve();
      return new Promise<void>((resolve, reject) => checks.set(name, { resolve, reject }));
    },
    resume: async () => {},
    seek() {},
    stop() {
      playing = false;
    },
    playing: () => playing,
    now: () => 0,
    outputLatency: () => 0,
    time: () => 0,
    tap: { sampleRate: 48000, rms: async () => 0 },
  };
  engine = engineWith(audio, (schedule) => {
    dispatch = schedule;
  });
  return checks;
}
function until(app: ReturnType<typeof createApp>, predicate: () => boolean) {
  return new Promise<void>((resolve) => {
    const off = app.subscribe(() => {
      if (predicate())
        queueMicrotask(() => {
          off();
          resolve();
        });
    });
  });
}
it.each(['source', 'rhythm'])(
  '%s edit during playback shows new loading/ready/missing names and removes old row sounds',
  async (address) => {
    const checks = backend(),
      app = createApp();
    const rows = () => sheetModel({ ...app.state, doc: app.state.doc!, playhead: 0 }).rows;
    function edit(name: string) {
      const next = replaceFromSource(
        app.state.doc!,
        `${app.state.rows[0].pattern.id}:${address}`,
        `s("${name}")`,
      );
      if ('ok' in next) throw Error(next.reason);
      app.editor!.apply(next);
    }
    try {
      await app.load('s("sine")');
      await app.play();
      await until(app, () =>
        app.state.sounds.some((s) => s.name === 'sine' && s.state === 'ready'),
      );
      expect(rows()[0].sounds).toEqual([{ name: 'sine', state: 'ready' }]);
      edit('fresh');
      await until(app, () =>
        app.state.sounds.some((s) => s.name === 'fresh' && s.state === 'loading'),
      );
      expect(app.state.playing).toBe(true);
      expect(rows()[0].sounds).toEqual([{ name: 'fresh', state: 'loading' }]);
      checks.get('fresh')!.resolve();
      await until(app, () =>
        app.state.sounds.some((s) => s.name === 'fresh' && s.state === 'ready'),
      );
      expect(rows()[0].sounds).toEqual([{ name: 'fresh', state: 'ready' }]);
      expect(app.state.sounds.some((s) => s.name === 'sine')).toBe(false);
      edit('absent');
      await until(app, () =>
        app.state.sounds.some((s) => s.name === 'absent' && s.state === 'loading'),
      );
      checks.get('absent')!.reject(Error('Default collections could not load'));
      await until(app, () =>
        app.state.sounds.some((s) => s.name === 'absent' && s.state === 'missing'),
      );
      expect(rows()[0].sounds).toEqual([
        { name: 'absent', state: 'missing', detail: 'Default collections could not load' },
      ]);
      expect(app.state.sounds.some((s) => s.name === 'fresh')).toBe(false);
      expect(app.state.playing).toBe(true);
      expect(app.state.soundNotice.visible).toBe(true);
      app.dismissSoundNotice();
      app.follow(false);
      expect(app.state.soundNotice.visible).toBe(false);
      edit('later');
      await until(app, () =>
        app.state.sounds.some((s) => s.name === 'later' && s.state === 'loading'),
      );
      expect(app.state.soundNotice.visible).toBe(false);
      checks.get('later')!.reject(Error('Default collections could not load'));
      await until(app, () => app.state.soundNotice.visible);
      expect(app.state.playing).toBe(true);
    } finally {
      app.stop();
      app.editor?.dispose();
    }
  },
);
