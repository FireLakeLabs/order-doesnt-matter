import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { Engine, EngineEvent } from '../src/contract';
import { instruments, sections, type Doc } from '../src/document';
import { generate } from '../src/generate';
import { setMuted } from '../src/document/edits/set-muted';
import { setUseMuted } from '../src/document/edits/set-use-muted';
import { renameInstrument } from '../src/document/edits/rename-instrument';
import { createApp } from '../src/app/controller';

// Only the two browser boundaries are replaced. Controller/session/history and
// generation are real; separate worker proofs check the resulting event bags.
const audio = vi.hoisted(() => {
  const codes: string[] = [],
    listeners = new Set<(e: EngineEvent) => void>();
  let playing = false,
    revision = 0;
  const emit = (event: EngineEvent) => listeners.forEach((listener) => listener(event));
  const engine: Engine = {
    async play(code) {
      codes.push(code);
      playing = true;
      emit({ type: 'transport', playing });
      emit({ type: 'swapped', revision: ++revision, cycle: 8, time: 0 });
      return revision;
    },
    stop() {
      playing = false;
      emit({ type: 'transport', playing });
    },
    get playing() {
      return playing;
    },
    now: () => (playing ? 8 : null),
    audioTime: () => 0,
    sounds: () => [],
    tap: () => ({ sampleRate: 48000, rms: async () => 0 }),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return { codes, engine };
});
vi.mock('../src/engine', () => ({ createEngine: async () => audio.engine }));
vi.mock('../src/strudel/evaluate-browser', () => ({
  createBrowserQueries: () => ({
    query: async () => ({ events: [], cps: 0.5, error: null }),
    cancel() {},
  }),
}));

it('real house controller: solo stays wired through mute/name undo, redo, Stop/restart and release', async () => {
  vi.useFakeTimers();
  const app = createApp();
  const good = (result: Doc | { ok: false; reason: string }): Doc => {
    if ('ok' in result) throw Error(result.reason);
    return result;
  };
  try {
    await app.load(readFileSync('corpus/programs/real-house-arranged.strudel', 'utf8'));
    const rows = app.state.rows,
      bass = rows.find((r) => r.name === 'bass')!,
      kick = rows.find((r) => r.name === 'kick')!,
      chords = rows.find((r) => r.name === 'chords')!;
    const doc = () => app.state.doc!;
    const edit = (next: Doc) => app.editor!.apply(next);
    edit(good(setMuted(doc(), kick.id, true)));
    edit(good(setMuted(doc(), kick.id, false)));
    edit(good(setUseMuted(doc(), chords.id, sections(doc())[0].id, true)));
    app.select(sections(doc()).find((s) => s.name === 'drop')!.id);
    app.solo(bass.id);
    await app.play();
    const assertSolo = async () => {
      await vi.advanceTimersByTimeAsync(100);
      expect(app.state.solo).toBe(bass.id);
      expect(audio.codes.at(-1)).toBe(generate(doc(), { only: bass.id }));
    };
    await assertSolo();
    edit(good(renameInstrument(doc(), bass.id, 'Solo bass')));
    await assertSolo();
    expect(app.state.rows.find((r) => r.id === bass.id)!.name).toBe('Solo bass');
    app.editor!.undo();
    await assertSolo(); // name
    app.editor!.undo();
    await assertSolo(); // section mute
    app.editor!.undo();
    await assertSolo(); // definition unmute
    expect(instruments(doc()).find((r) => r.id === kick.id)!.muted).toBe(true);
    app.editor!.redo();
    await assertSolo();
    app.stop();
    expect(app.state.playing).toBe(false);
    await app.play();
    await assertSolo();
    app.solo(null);
    await vi.advanceTimersByTimeAsync(100);
    expect(app.state.solo).toBeNull();
    expect(audio.codes.at(-1)).toBe(generate(doc()));
    await app.load('note(60).s("sine")');
    expect(app.state.solo).toBeNull();
  } finally {
    app.stop();
    app.editor?.dispose();
    vi.useRealTimers();
  }
});
