import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { discoverViews, views } from '../src/views';
import type { ViewDefinition, ViewFrame } from '../src/views/types';
import { instrumentInventory } from '../src/studio/instrument-names';
import { instrumentColour, resolveTheme, themeNames, viewTheme } from '../src/studio/themes';
import { createStore } from '../src/studio/store';
import { initialState, loadPiece } from '../src/app/state';
import { importStrudel } from '../src/import';
import { buildFrame, neededRange, viewNotes, playingSplit, noteLevel } from '../src/studio/frame';
import { createFrameClock } from '../src/studio/clock';
import { mountView } from '../src/studio/view-lifecycle';
import { createScoreCache } from '../src/studio/score-cache';
import type { EventResult } from '../src/contract';

const result = (events: EventResult['events']): EventResult => ({
  events,
  cps: 1,
  error: null,
  opaqueValues: false,
});
const event = (start: number, end: number, value: unknown = { s: 'bd', room: 0.5 }) => ({
  whole: [start, end] as [number, number],
  part: [start, end] as [number, number],
  value,
  hasOnset: true,
});
const state = () =>
  loadPiece(initialState(), '', importStrudel('stack(s("bd"), s("bd"), s("saw"))'));

test('the file glob discovers the real view; definition modules are lazy and cached', async () => {
  expect(views.map((view) => view.id)).toContain('test-card');
  const card = await views.find((view) => view.id === 'test-card')!.load();
  expect(card).toMatchObject({ id: 'test-card', name: 'Test card', span: 'window' });
  const load = vi.fn(async () => ({ default: card }));
  const registry = discoverViews({ './test-card.view.ts': load });
  expect(load).not.toHaveBeenCalled();
  expect(await registry[0].load()).toBe(await registry[0].load());
  expect(load).toHaveBeenCalledTimes(1);
  await expect(discoverViews({ './wrong.view.ts': load })[0].load()).rejects.toThrow('filename');
});

test('five theme definitions match CSS, validate names and tint palette wraps deterministically', () => {
  const css = readFileSync('src/studio/themes.css', 'utf8');
  expect(resolveTheme(null).name).toBe('arcade');
  for (const name of ['invalid', 'toString', '__proto__'])
    expect(resolveTheme(name).name).toBe('arcade');
  for (const name of themeNames) {
    const theme = resolveTheme(name);
    const block = css.split(`[data-theme='${name}'] {`)[1].split('}')[0];
    for (const token of ['ground', 'panel', 'line', 'text', 'muted', 'accent'] as const)
      expect(block.toLowerCase()).toContain(`--${token}: ${theme[token]};`.toLowerCase());
    expect(block).toContain(`--font-display: '${theme.fontDisplay}'`);
    expect(block).toContain(`--radius: ${theme.radius}px`);
    expect(instrumentColour(name, 0)).toBe(theme.instrumentColours[0]);
  }
  expect(instrumentColour('arcade', 8)).toBe('#FF71A4');
  expect(instrumentColour('arcade', 16)).toBe('#FF8DB6');
  expect(instrumentColour('pocket', 4)).toBe('#0F2A1D');
  expect(resolveTheme('phosphor')).toMatchObject({ radius: 0, fontMono: 'VT323' });
  expect(resolveTheme('pocket')).toMatchObject({ radius: 0, fontMono: 'Silkscreen' });
});

test('store snapshots retain identity until state or readiness changes', () => {
  const source = { state: initialState(), canPlay: false, subscribe: vi.fn(() => () => {}) };
  const store = createStore(source);
  const first = store.getSnapshot();
  expect(store.getSnapshot()).toBe(first);
  source.canPlay = true;
  const ready = store.getSnapshot();
  expect(ready).not.toBe(first);
  expect(ready.state).toBe(first.state);
  expect(store.getSnapshot()).toBe(ready);
  source.state = { ...source.state, message: 'changed' };
  expect(store.getSnapshot()).not.toBe(ready);
  const notify = vi.fn();
  store.subscribe(notify);
  expect(source.subscribe).toHaveBeenCalledWith(notify);
});

test('frame ranges cover the song, sectionless song and window trails without per-frame changes', () => {
  const sections = [
    { id: 'a', name: 'A', nameSource: 'author' as const, start: 0, cycles: 32, instrumentIds: [] },
  ];
  expect(neededRange('song', 2, 4, sections)).toEqual({ from: 0, to: 32 });
  expect(neededRange('song', 34, 4, sections)).toEqual({ from: 32, to: 64 });
  expect(neededRange('song', 0, 4, [])).toEqual({ from: 0, to: 16 });
  expect(neededRange('window', 8.1, 8, [])).toEqual({ from: 4, to: 24 });
  expect(neededRange('window', 8.1, 4, [])).toEqual(neededRange('window', 11.9, 4, []));
});

test('frame builder preserves real spans, fragments, signals, values, room membership and colours', () => {
  const s = state();
  const [bd, bd2, saw] = s.rows;
  s.playing = true;
  s.cps = 1;
  const score = {
    from: 0,
    to: 4,
    events: {
      [bd.id]: result([
        event(0, 0.5),
        { ...event(-1, 1), part: [0, 1] as [number, number] },
        { ...event(1, 2), whole: null },
      ]),
      [bd2.id]: result([event(0, 0.5)]),
      [saw.id]: result([event(0, 1, { s: 'saw', orbit: 2, delay: 0.5 })]),
    },
  };
  const notes = viewNotes(score);
  expect(notes.slice(0, 3).map((n) => n.hasOnset)).toEqual([true, false, false]);
  expect(notes[1]).toMatchObject({ start: -1, end: 1 });
  const frame = buildFrame({
    state: s,
    score,
    notes,
    now: 0.25,
    cps: 0.25,
    playing: true,
    theme: resolveTheme('riso'),
    lookAhead: 4,
    trails: 2,
    width: 800,
    height: 600,
    dpr: 2,
  });
  expect(frame.notes).toBe(notes);
  expect(frame.instruments.map((i) => i.name)).toEqual(['bd', 'bd 2', 'saw']);
  expect(frame.instruments[0]).toMatchObject({
    colour: '#FF4F7B',
    sounding: true,
    inSection: true,
  });
  expect(frame.rooms).toEqual([
    { orbit: 1, members: [bd.id, bd2.id] },
    { orbit: 2, members: [saw.id] },
  ]);
  expect(frame).toMatchObject({
    now: 0.25,
    cps: 0.25,
    lookAhead: 4,
    trails: 2,
    width: 800,
    height: 600,
    dpr: 2,
  });
  const scrubbed = buildFrame({ ...frame, state: s, score, playing: false });
  expect(scrubbed.playing).toBe(false);
  expect(scrubbed.instruments.every((instrument) => !instrument.sounding)).toBe(true);
});

test('one frame clock shares the sample across stages and cancels its last subscription', () => {
  let tick: FrameRequestCallback | undefined;
  const request = vi.fn((callback: FrameRequestCallback) => {
    tick = callback;
    return 7;
  });
  const cancel = vi.fn();
  const sample = { now: 3.25, cps: 0.25, playing: false };
  const read = vi.fn(() => sample);
  const clock = createFrameClock(read, request, cancel);
  const a = vi.fn(),
    b = vi.fn();
  const offA = clock.subscribe(a),
    offB = clock.subscribe(b);
  expect(request).toHaveBeenCalledTimes(1);
  tick!(0);
  expect(read).toHaveBeenCalledTimes(1);
  expect(a).toHaveBeenCalledWith(sample);
  expect(b).toHaveBeenCalledWith(sample);
  offA();
  expect(cancel).not.toHaveBeenCalled();
  offB();
  expect(cancel).toHaveBeenCalledWith(7);
});

test('late async mounts dispose exactly once and never draw after removal', async () => {
  let resolve!: (value: { frame: () => void; dispose: () => void }) => void;
  const disposed = vi.fn(),
    frame = vi.fn(),
    failed = vi.fn();
  const mount = vi.fn(
    () =>
      new Promise<{ frame: () => void; dispose: () => void }>((done) => {
        resolve = done;
      }),
  );
  const definition: ViewDefinition = { id: 'test', name: 'Test', tag: 'test', mount };
  const lifecycle = mountView(async () => definition, {} as HTMLElement, failed);
  await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
  lifecycle.dispose();
  resolve({ frame, dispose: disposed });
  await vi.waitFor(() => expect(disposed).toHaveBeenCalledTimes(1));
  lifecycle.frame({} as ViewFrame);
  lifecycle.dispose();
  expect(frame).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
});

test('score cache asks once per range, covers requested spans and discards stale replies', async () => {
  const queries: ((result: EventResult) => void)[] = [];
  const query = vi.fn(
    () =>
      new Promise<EventResult>((done) => {
        queries.push(done);
      }),
  );
  const cache = createScoreCache(query);
  const s = state();
  cache.request(s, { from: 0, to: 16 });
  cache.request(s, { from: 0, to: 16 });
  expect(query).toHaveBeenCalledTimes(3);
  cache.request(s, { from: 16, to: 32 });
  for (const done of queries.slice(3)) done(result([event(17, 18)]));
  await vi.waitFor(() => expect(cache.score.from).toBe(16));
  for (const done of queries.slice(0, 3)) done(result([event(1, 2)]));
  await Promise.resolve();
  expect(cache.notes.every((note) => note.start === 17)).toBe(true);
  cache.dispose();
});

test('instrument identities and suffixes survive resting sections, repeats and changing sound events', () => {
  const s = loadPiece(
    initialState(),
    '',
    importStrudel('arrange([4, s("~ bd")], [4, stack(s("bd"), s("sd"))])'),
  );
  const inventory = instrumentInventory(s);
  expect(inventory.names).toEqual(['bd · Section 1', 'bd · Section 2', 'sd']);
  expect(inventory.sounds).toEqual(['bd', 'bd', 'sd']);
  const later = {
    ...s,
    fromCycle: 32,
    toCycle: 36,
    events: { [s.rows[0].id]: result([event(32, 33, { s: 'hh' })]) },
  };
  expect(instrumentInventory(later)).toBe(inventory);
  const resting = { ...later, events: {} };
  expect(instrumentInventory(resting).names).toEqual(['bd · Section 1', 'bd · Section 2', 'sd']);
  const changed = loadPiece(s, '', importStrudel('stack(s("hh"), s("hh"))'));
  expect(instrumentInventory(changed).names).toEqual(['hh', 'hh 2']);
});

test('view themes expose only public contract fields with stable identity', () => {
  const theme = resolveTheme('arcade');
  const publicTheme = viewTheme(theme);
  expect(viewTheme(theme)).toBe(publicTheme);
  expect(Object.keys(publicTheme).sort()).toEqual(
    [
      'name',
      'ground',
      'panel',
      'line',
      'text',
      'muted',
      'accent',
      'fontDisplay',
      'fontMono',
      'radius',
      'glow',
    ].sort(),
  );
  expect(publicTheme).not.toHaveProperty('instrumentColours');
});

test('section-based generated names disambiguate sounds and preserve author names', () => {
  const s = loadPiece(
    initialState(),
    '',
    importStrudel(`
    const intro = stack(s("hh"), s("bd"));
    const build = stack(s("hh"), s("sd"));
    arrange([4, intro], [4, build])
  `),
  );
  expect(instrumentInventory(s).names).toEqual(['hh · intro', 'bd', 'hh · build', 'sd']);
  const named = loadPiece(
    initialState(),
    '',
    importStrudel('const custom = s("hh"); stack(custom, s("hh"))'),
  );
  expect(instrumentInventory(named).names).toEqual(['custom', 'hh']);
});

test('dubstep rail split follows the playhead through sections and repeats, independently of mute', () => {
  const s = loadPiece(
    initialState(),
    '',
    importStrudel(readFileSync('corpus/programs/real-dubstep-arranged.strudel', 'utf8')),
  );
  const names = instrumentInventory(s);
  expect(s.rows).toHaveLength(13);
  expect(playingSplit(s, 0).playing).toHaveLength(3);
  expect(playingSplit(s, 4).playing).toHaveLength(4);
  expect(playingSplit(s, 8).playing).toHaveLength(6);
  expect(playingSplit(s, 16).playing).toHaveLength(3);
  expect(playingSplit(s, 28).playing.map((row) => row.id)).toEqual(
    playingSplit(s, 0).playing.map((row) => row.id),
  );
  expect(names.groups.filter((group) => group === 'dubstepDrums')).toHaveLength(4);
  const muted = { ...s, rows: s.rows.map((row) => ({ ...row, muted: true })) };
  expect(playingSplit(muted, 8).playing).toHaveLength(6);
});

test('meters use overlapping onset notes and gain, without counting signal fragments', () => {
  const notes = viewNotes({
    from: 0,
    to: 4,
    events: {
      bd: result([
        event(0, 1, { gain: 0.5 }),
        event(0, 1, { gain: 0.5 }),
        { ...event(0, 1), whole: null },
      ]),
    },
  });
  expect(noteLevel(notes, 'bd', 0.5)).toBeCloseTo(Math.sqrt(0.5));
  expect(noteLevel(notes, 'bd', 1)).toBe(0);
});

test('a failed frame releases once even if dispose also fails; a synchronous mount failure is reported', async () => {
  const error = Error('broken frame');
  const release = vi.fn(() => {
    throw Error('broken cleanup');
  });
  const failed = vi.fn();
  const element = { replaceChildren: vi.fn() } as unknown as HTMLElement;
  const lifecycle = mountView(
    async () => ({
      id: 'bad',
      name: 'Bad',
      tag: 'test',
      mount: () => ({
        frame() {
          throw error;
        },
        dispose: release,
      }),
    }),
    element,
    failed,
  );
  await vi.waitFor(() => expect(lifecycle.definition).toBeDefined());
  await Promise.resolve();
  lifecycle.frame({} as ViewFrame);
  lifecycle.frame({} as ViewFrame);
  lifecycle.dispose();
  expect(release).toHaveBeenCalledTimes(1);
  expect(failed).toHaveBeenCalledExactlyOnceWith(error);
  const mountFailure = vi.fn();
  mountView(
    () => {
      throw Error('broken load');
    },
    element,
    mountFailure,
  );
  await vi.waitFor(() => expect(mountFailure).toHaveBeenCalledOnce());
});

test('author names reserve their exact spelling before generated numeric suffixes', () => {
  const s = loadPiece(initialState(), '', importStrudel('const bd = s("bd"); stack(s("bd"), bd)'));
  expect(instrumentInventory(s).names).toEqual(['bd 2', 'bd']);
});

test('a dynamic sound setting retains the earlier written sound as its naming fallback', () => {
  const s = loadPiece(initialState(), '', importStrudel('s("bd").s(sine)'));
  expect(instrumentInventory(s).sounds).toEqual(['bd']);
});
