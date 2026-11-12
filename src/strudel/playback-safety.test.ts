import { expect, test, vi } from 'vitest';
import { Pattern, pure } from '@strudel/core';
import { guarded } from './audio-pattern';
import { MAX_WINDOW_STARTS, QUERY_LIMIT_MS, PlaybackOverrun } from '../engine/playback-limits';

test('a scheduler window drops excess note starts and reports the limit only once', () => {
  const failed = vi.fn(),
    tag = vi.fn();
  const hap = pure({ s: 'sine' }).queryArc(0, 1)[0];
  const p = guarded(new Pattern(() => Array(MAX_WINDOW_STARTS + 1).fill(hap)), failed, tag);
  expect(p.queryArc(0, 1)).toHaveLength(MAX_WINDOW_STARTS);
  expect(p.queryArc(1, 2)).toHaveLength(MAX_WINDOW_STARTS);
  expect(tag).toHaveBeenCalledTimes(MAX_WINDOW_STARTS * 2);
  expect(failed).toHaveBeenCalledOnce();
  expect(failed.mock.calls[0][0].message).toContain(`${MAX_WINDOW_STARTS} note starts`);
});

test('a query that returns too late drops its notes, reports once and stays halted', () => {
  const clock = vi
    .spyOn(performance, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValue(QUERY_LIMIT_MS + 1);
  const failed = vi.fn(),
    tag = vi.fn();
  const p = guarded(pure('sine'), failed, tag);
  try {
    expect(p.queryArc(0, 1)).toEqual([]);
    expect(p.queryArc(1, 2)).toEqual([]);
    expect(failed).toHaveBeenCalledOnce();
    expect(failed.mock.calls[0][0]).toBeInstanceOf(PlaybackOverrun);
    expect(tag).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});

test('pinned Cyclist uses 50 ms onset-only windows and the guarded limit before output', async () => {
  const { Cyclist } = await import('@strudel/core');
  const windows: number[][] = [],
    controls: unknown[] = [];
  const failed = vi.fn(),
    trigger = vi.fn();
  const hap = pure({ s: 'sine' }).queryArc(0, 1)[0];
  const scheduler = new Cyclist({
    getTime: () => 10,
    setInterval: () => 1,
    clearInterval: () => {},
    onTrigger: trigger,
  });
  await scheduler.setPattern(
    guarded(
      new Pattern((state) => {
        windows.push([Number(state.span.begin), Number(state.span.end)]);
        controls.push(state.controls.cyclist);
        return Array(MAX_WINDOW_STARTS + 1).fill(hap);
      }),
      failed,
      () => {},
    ),
    true,
  );
  try {
    expect(windows, 'Pinned Cyclist initial lookahead changed').toHaveLength(4);
    for (const [a, b] of windows) expect(b - a, 'Pinned Cyclist window changed').toBeCloseTo(0.025);
    expect(controls).toEqual(Array(4).fill('cyclist'));
    expect(trigger).toHaveBeenCalledTimes(4 * MAX_WINDOW_STARTS);
    expect(failed).toHaveBeenCalledOnce();
  } finally {
    scheduler.stop();
  }
});

test('real-house and Kiln preflight retain sound names and fit far below the window limit', async () => {
  const { readFileSync } = await import('node:fs');
  const { queryEventsNode } = await import('./evaluate-node');
  for (const file of ['real-house-arranged', 'piece-kiln']) {
    const source = readFileSync(`corpus/programs/${file}.strudel`, 'utf8');
    const normal = await queryEventsNode(source, 0, 28);
    const safe = await queryEventsNode(source, 0, 28, { playbackStarts: [0, 4, 12, 20] });
    expect(normal.error).toBeNull();
    expect(safe.error).toBeNull();
    const values = (r: typeof normal) =>
      [
        ...new Set(
          r.events
            .filter((e) => e.hasOnset)
            .map((e) =>
              JSON.stringify({
                s: (e.value as Record<string, unknown>).s,
                bank: (e.value as Record<string, unknown>).bank,
              }),
            ),
        ),
      ].sort();
    expect(values(safe)).toEqual(values(normal));
    expect(values(safe).length).toBeGreaterThan(0);
    const windows = new Map<number, number>();
    for (const e of normal.events.filter((e) => e.hasOnset)) {
      const window = Math.floor(e.whole![0] / (0.05 * normal.cps));
      windows.set(window, (windows.get(window) ?? 0) + 1);
    }
    const peak = Math.max(...windows.values());
    console.log('PLAYBACK WINDOW MEASURED', { file, peak, limit: MAX_WINDOW_STARTS });
    expect(peak).toBeLessThan(MAX_WINDOW_STARTS);
  }
});

test('worker preflight asks scheduler controls before broad discovery and checks late sections', async () => {
  const { queryEventsNode } = await import('./evaluate-node');
  const wrongWindow = await queryEventsNode(
    'new Pattern(state => { if (state.controls.cyclist && Number(state.span.end) - Number(state.span.begin) < 0.1) throw Error("scheduler only"); return [] })',
    0,
    16,
    { playbackStarts: [] },
  );
  expect(wrongWindow.error).toMatchObject({ phase: 'query' });
  const late = await queryEventsNode(
    'new Pattern(state => { if (Number(state.span.begin) >= 40) throw Error("late section"); return [] })',
    0,
    16,
    { playbackStarts: [40] },
  );
  expect(late.error).toMatchObject({ phase: 'query' });
  const flood = await queryEventsNode('s("bd*2048")', 0, 16, { playbackStarts: [] });
  expect(flood.error).toBeNull();
  expect(flood.events.length).toBeLessThanOrEqual(20 * MAX_WINDOW_STARTS);
});

test('fragments do not consume the start limit and the exact time limit is allowed', () => {
  const fragment = pure('held').queryArc(0.25, 0.75)[0],
    onset = pure('start').queryArc(0, 1)[0];
  const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(QUERY_LIMIT_MS);
  const failed = vi.fn();
  try {
    expect(
      guarded(new Pattern(() => [...Array(100).fill(fragment), onset]), failed, () => {}).queryArc(
        0,
        1,
      ),
    ).toEqual([onset]);
    expect(failed).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});

test('a query that throws after running too long also halts', () => {
  const clock = vi
    .spyOn(performance, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValue(QUERY_LIMIT_MS + 1);
  const failed = vi.fn();
  try {
    const p = guarded(
      new Pattern(() => {
        throw Error('late');
      }),
      failed,
      () => {},
    );
    expect(p.queryArc(0, 1)).toEqual([]);
    expect(failed.mock.calls[0][0]).toBeInstanceOf(PlaybackOverrun);
    expect(p.queryArc(1, 2)).toEqual([]);
    expect(failed).toHaveBeenCalledOnce();
  } finally {
    clock.mockRestore();
  }
});

test('preflight scheduler windows inherit tempo when the next program does not set it', async () => {
  const { queryEventsWithBudget } = await import('./evaluate');
  const r = await queryEventsWithBudget('s("bd")', 0, 16, undefined, [], 2);
  expect(r.error).toBeNull();
  expect(r.cps).toBe(2);
  expect(r.events[0].part).toEqual([0, 0.1]);
});
