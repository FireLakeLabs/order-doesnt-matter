import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { Engine, EngineEvent } from '../src/contract';
import { createApp } from '../src/app/controller';
import { createRetention, documentJSON, RECOVERY_KEY } from '../src/app/retention';
import { renameInstrument } from '../src/document/edits/rename-instrument';
import { importStrudel } from '../src/import';
import { generate } from '../src/generate';

const audio = vi.hoisted(() => {
  let playing = false,
    reject = false;
  let release: (() => void) | undefined;
  let barrier: Promise<void> | undefined;
  const codes: string[] = [];
  const listeners = new Set<(e: EngineEvent) => void>();
  const emit = (e: EngineEvent) => listeners.forEach((listener) => listener(e));
  const engine: Engine = {
    async play(code) {
      codes.push(code);
      if (barrier) {
        const waiting = barrier;
        barrier = undefined;
        await waiting;
      }
      if (reject) {
        reject = false;
        throw Error('Rejected swap');
      }
      playing = true;
      emit({ type: 'transport', playing });
      return 1;
    },
    stop() {
      playing = false;
      emit({ type: 'transport', playing });
    },
    get playing() {
      return playing;
    },
    now: () => (playing ? 0 : null),
    audioTime: () => 0,
    outputLatency: () => 0,
    sounds: () => [],
    tap: () => ({ sampleRate: 48000, rms: async () => 0 }),
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  return {
    engine,
    codes,
    pauseNext() {
      barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release() {
      release?.();
    },
    rejectNext() {
      reject = true;
    },
  };
});
vi.mock('../src/engine', () => ({ createEngine: async () => audio.engine }));
vi.mock('../src/strudel/evaluate-browser', () => ({
  createBrowserQueries: () => ({
    query: async (code: string) => ({
      events: [],
      cps: 0.5,
      error: code.includes('unsafe') ? { message: 'unsafe', phase: 'evaluation' } : null,
    }),
    cancel() {},
  }),
}));
const kiln = readFileSync('corpus/programs/piece-kiln.strudel', 'utf8');
it('controller preserves session/music on refused replacements and restores recovery after a rejected edit', async () => {
  const data = new Map<string, string>();
  const retention = createRetention({
    storage: () => ({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, text) => {
        data.set(key, text);
      },
    }),
  });
  let approve = false;
  const app = createApp({ retention, confirmReplacement: async () => approve });
  try {
    await app.load(kiln);
    const original = app.state.doc!,
      id = app.state.rows[0].id;
    const renamed = renameInstrument(original, id, 'My Kiln');
    if ('ok' in renamed) throw Error(renamed.reason);
    app.editor!.apply(renamed);
    app.editor!.undo();
    app.editor!.redo();
    const session = app.editor;
    await app.play();
    for (const text of ['{', '{"version":3,"body":[]}', '{"version":2,"body":[{}]}']) {
      await app.openDocument(text);
      expect(app.state.doc).toBe(renamed);
      expect(app.editor).toBe(session);
      expect(app.state.playing).toBe(true);
    }
    await app.load('s("sine")');
    await app.openDocument(documentJSON(original));
    expect(app.editor).toBe(session);
    expect(app.state.doc).toBe(renamed);
    expect(app.editor!.canUndo).toBe(true);
    approve = true;
    await app.load('unsafe()'); // failed worker preflight keeps current work and music
    expect(app.state.doc).toBe(renamed);
    expect(app.state.playing).toBe(true);
    audio.rejectNext();
    await app.load('s("sine")');
    expect(app.editor).toBe(session);
    expect(app.state.doc).toBe(renamed);
    audio.pauseNext();
    const count = audio.codes.length;
    const loading = app.load('s("sine")');
    await vi.waitFor(() => expect(audio.codes.length).toBeGreaterThan(count));
    expect(app.canPlay).toBe(false);
    session!.undo();
    const newer = app.state.doc;
    audio.release();
    await loading;
    expect(app.editor).toBe(session);
    expect(app.state.doc).toBe(newer);
    expect(audio.codes.at(-1)).toBe(generate(newer!, { instrumentTags: true }));
    session!.redo();
    // Finish the queued edit before testing the next independent rejection.
    await vi.waitFor(() =>
      expect(audio.codes.at(-1)).toBe(generate(renamed, { instrumentTags: true })),
    );
    audio.rejectNext();
    const failed = renameInstrument(renamed, id, 'Rejected');
    if ('ok' in failed) throw Error(failed.reason);
    app.editor!.apply(failed);
    await vi.waitFor(() => expect(app.state.doc).toBe(renamed));
    expect(JSON.parse(data.get(RECOVERY_KEY)!)).toEqual(renamed);
    await app.openDocument(documentJSON(original));
    expect(app.state.doc).toEqual(original);
    expect(app.editor!.canUndo).toBe(false);
    expect(app.state.playing).toBe(false);
    expect(audio.engine.playing).toBe(false);
  } finally {
    app.stop();
    app.editor?.dispose();
  }
});

it('startup protects the saved owner snapshot until Recover or an approved deliberate load', async () => {
  const saved = importStrudel(kiln).doc,
    setItem = vi.fn();
  const app = createApp({
    retention: createRetention({
      storage: () => ({
        getItem: () => documentJSON(saved),
        setItem,
      }),
    }),
    confirmReplacement: async () => false,
  });
  expect(app.state.doc).toBeNull();
  app.frame();
  expect(setItem).not.toHaveBeenCalled();
  await app.load('s("sine")');
  expect(app.state.doc).toBeNull();
  expect(setItem).not.toHaveBeenCalled();
  await app.recover();
  expect(app.state.doc).toEqual(saved);
  expect(app.state.playing).toBe(false);
  expect(app.engine).toBeNull();
  expect(setItem).toHaveBeenCalledOnce();
  app.editor?.dispose();
});
