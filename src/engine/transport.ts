import type { CycleLoop, PlaybackSpeed } from '../contract';

export const speeds: readonly PlaybackSpeed[] = [0.25, 0.5, 0.75, 1];
export function checkSpeed(speed: number): asserts speed is PlaybackSpeed {
  if (!speeds.includes(speed as PlaybackSpeed)) throw Error('Speed must be ¼, ½, ¾ or 1');
}
export function checkLoop(loop: CycleLoop | null) {
  if (
    loop &&
    (!Number.isSafeInteger(loop.from) ||
      !Number.isSafeInteger(loop.to) ||
      loop.from < 0 ||
      loop.to <= loop.from)
  )
    throw Error('Loop must cover a positive range of whole cycles');
}
export function wrapCycle(cycle: number, loop: CycleLoop | null) {
  if (!loop) return cycle;
  const length = loop.to - loop.from;
  return loop.from + ((((cycle - loop.from) % length) + length) % length);
}
export const actualCps = (written: number, speed: PlaybackSpeed) => written * speed;
