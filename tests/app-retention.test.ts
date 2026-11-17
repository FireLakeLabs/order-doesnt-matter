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
    setSpeed() {},
    async setLoop() {},
    async seek() {},
    silence() {},
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
    tap: () => ({
      sampleRate: 48000,
      analyse: () => {
        throw Error('Unused fake analysis');
      },
      rms: async () => 0,
    }),
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

it('practice retains identities, both history directions, pin/solo and recovery without adopting a candidate', async () => {
  const storage = new Map<string, string>();
  const retention = createRetention({
    storage: () => ({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    }),
  });
  const app = createApp({ retention });
  await app.load(kiln);
  const session = app.editor!,
    original = app.state.doc!;
  const changed = renameInstrument(original, app.state.rows[0].id, 'Visitor');
  if ('ok' in changed) throw Error(changed.reason);
  session.apply(changed);
  session.undo();
  session.redo();
  session.undo();
  app.select(app.state.sections[1].id);
  app.solo(app.state.rows[0].id);
  const state = app.state,
    stored = storage.get(RECOVERY_KEY),
    notice = retention.notice;
  await app.play();
  expect(await app.beginPractice(new AbortController().signal)).toBe(true);
  expect(app.engine).toBe(audio.engine);
  expect(app.state.doc).toBeNull();
  await app.load(kiln);
  app.editor!.apply(changed);
  app.downloadDocument();
  app.exportStrudel();
  expect(storage.get(RECOVERY_KEY)).toBe(stored);
  app.endPractice();
  app.endPractice();
  expect(app.editor).toBe(session);
  expect(app.state.doc).toBe(original);
  expect(app.state.selected).toBe(state.selected);
  expect(app.state.solo).toBe(state.solo);
  expect(app.state.follow).toBe(false);
  expect(app.state.playing).toBe(false);
  expect(session.canRedo).toBe(true);
  session.redo();
  expect(app.state.doc).toBe(changed);
  expect(app.retention).toBe(retention);
  expect(retention.notice).toBe(notice);
  session.dispose();
  const candidate = createRetention({
    storage: () => ({ getItem: () => documentJSON(original), setItem: vi.fn() }),
  });
  const empty = createApp({ retention: candidate });
  const before = candidate.candidate;
  expect(await empty.beginPractice(new AbortController().signal)).toBe(true);
  await empty.load(kiln);
  empty.endPractice();
  expect(empty.state.doc).toBeNull();
  expect(candidate.candidate).toBe(before);
});

it('preparation drains submitted validation and swaps, can cancel, and refuses a failed outcome', async () => {
  const app = createApp({ retention: createRetention({ persistent: false }) });
  await app.load(kiln);
  let release!: (ok: boolean) => void;
  const validation = app.editor!.submit(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
  );
  const cancel = new AbortController();
  const entering = app.beginPractice(cancel.signal);
  cancel.abort();
  release(true);
  await validation;
  expect(await entering).toBe(false);
  expect(app.practice).toBe(false);
  await app.editor!.submit(async () => false);
  expect(await app.beginPractice(new AbortController().signal)).toBe(false);
  expect(app.state.doc).not.toBeNull();
  app.editor?.dispose();
});

it('cancelled preparation cannot block a restart or clear its newer preparation', async () => {
  const app = createApp({ retention: createRetention({ persistent: false }) });
  await app.load(kiln);
  const editor = app.editor!;
  let releaseFirst!: (ok: boolean) => void, releaseSecond!: (ok: boolean) => void;
  vi.spyOn(editor, 'settle')
    .mockImplementationOnce(() => new Promise<boolean>((resolve) => (releaseFirst = resolve)))
    .mockImplementationOnce(() => new Promise<boolean>((resolve) => (releaseSecond = resolve)));
  const first = new AbortController();
  const cancelled = app.beginPractice(first.signal);
  expect(app.preparing).toBe(true);
  first.abort();
  expect(app.preparing).toBe(false);
  const second = new AbortController();
  const restarted = app.beginPractice(second.signal);
  expect(app.preparing).toBe(true);
  releaseFirst(true);
  expect(await cancelled).toBe(false);
  expect(app.preparing).toBe(true);
  expect(await app.beginPractice(new AbortController().signal)).toBe(false);
  releaseSecond(true);
  expect(await restarted).toBe(true);
  app.endPractice();
  expect(app.editor).toBe(editor);
  editor.dispose();
});

it('cancellation during the final settlement leaves the visitor session mounted', async () => {
  const app = createApp({ retention: createRetention({ persistent: false }) });
  await app.load(kiln);
  const editor = app.editor!,
    doc = app.state.doc,
    park = vi.fn();
  let release!: (ok: boolean) => void, reached!: () => void;
  const settling = new Promise<void>((resolve) => (reached = resolve));
  vi.spyOn(editor, 'settle')
    .mockResolvedValueOnce(true)
    .mockImplementationOnce(() => {
      reached();
      return new Promise<boolean>((resolve) => (release = resolve));
    });
  const cancel = new AbortController();
  const entering = app.beginPractice(cancel.signal, park);
  await settling;
  cancel.abort();
  release(true);
  expect(await entering).toBe(false);
  expect(park).not.toHaveBeenCalled();
  expect(app.practice).toBe(false);
  expect(app.editor).toBe(editor);
  expect(app.state.doc).toBe(doc);
  editor.dispose();
});

it('entry drains queued edits without waiting for their sparse display trigger, and keeps a failed rollback', async () => {
  const app = createApp({ retention: createRetention({ persistent: false }) });
  await app.load(kiln);
  await app.play();
  const editor = app.editor!,
    doc = app.state.doc!,
    id = app.state.rows[0].id;
  const change = (name: string) => {
    const next = renameInstrument(app.state.doc!, id, name);
    if ('ok' in next) throw Error(next.reason);
    editor.apply(next);
    return next;
  };
  audio.pauseNext();
  change('First');
  const last = change('Latest');
  const entering = app.beginPractice(new AbortController().signal);
  expect(app.practice).toBe(false);
  audio.release();
  expect(await entering).toBe(true);
  app.endPractice();
  expect(app.editor).toBe(editor);
  expect(app.state.doc).toBe(last);
  await app.play();
  audio.rejectNext();
  change('Reject');
  expect(await app.beginPractice(new AbortController().signal)).toBe(false);
  expect(app.state.doc).toBe(last);
  expect(app.editor).toBe(editor);
  expect(Object.values(editor.state.entries).some((entry) => entry.status === 'failed')).toBe(true);
  expect(app.state.doc).not.toBe(doc);
  app.stop();
  editor.dispose();
});

it('a cancelled practice replacement cannot publish its late error into the restored session', async () => {
  const app = createApp({ retention: createRetention({ persistent: false }) });
  await app.load(kiln);
  const original = app.state.doc,
    editor = app.editor;
  expect(await app.beginPractice(new AbortController().signal)).toBe(true);
  await app.load(kiln);
  await app.play();
  audio.pauseNext();
  const count = audio.codes.length;
  const loading = app.load('s("sine")');
  await vi.waitFor(() => expect(audio.codes.length).toBeGreaterThan(count));
  app.endPractice();
  audio.rejectNext();
  audio.release();
  await loading;
  expect(app.state.doc).toBe(original);
  expect(app.editor).toBe(editor);
  expect(app.state.loadError).toBe('');
  expect(app.state.message).toBe('');
  expect(app.state.playing).toBe(false);
  editor?.dispose();
});

it('an observed practice playback failure does not block the restored session from entering again', async () => {
  const app = createApp({ retention: createRetention({ persistent: false }) });
  await app.load(kiln);
  const original = app.state.doc,
    editor = app.editor;
  expect(await app.beginPractice(new AbortController().signal)).toBe(true);
  await app.load(kiln);
  audio.rejectNext();
  await app.play();
  expect(app.state.message).toContain('Rejected swap');
  app.endPractice();
  expect(app.state.doc).toBe(original);
  expect(app.state.message).toBe('');
  expect(await app.beginPractice(new AbortController().signal)).toBe(true);
  app.endPractice();
  expect(app.editor).toBe(editor);
  editor?.dispose();
});
