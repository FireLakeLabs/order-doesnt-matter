import type { ViewFrame } from '../types';
import { random } from '../shared/particles';
import { clamp } from '../shared/math';

/** Two buildings per fixed-length block allow random access, including negative time.
 * Complementary widths/gaps keep all buildings 6–20 heights and gaps 1.2–2.2.
 * No score input: roofs cannot move when notes, roles or sections change. */
export function building(index: number, maxGap = 2.2) {
  const block = Math.floor(index / 2);
  const odd = index - block * 2;
  const width = 6 + random(block * 431 + 19) * 14;
  const gap = 1.2 + random(block * 773 + 31) * (maxGap - 1.2);
  const start = block * (27.2 + maxGap) + (odd ? width + gap : 0);
  const floors = [0, 1, 2, -1, 0, 1, 0, -1];
  return {
    index,
    start,
    end: start + (odd ? 26 - width : width),
    gap: odd ? 1.2 + maxGap - gap : gap,
    floors: floors[((index % floors.length) + floors.length) % floors.length],
  };
}
export function buildingAt(distance: number, maxGap = 2.2) {
  const block = Math.floor(distance / (27.2 + maxGap));
  const first = building(block * 2, maxGap);
  return distance < first.end + first.gap ? first : building(block * 2 + 1, maxGap);
}
export function world(f: Pick<ViewFrame, 'width' | 'height' | 'now'>) {
  const size = f.height * 0.09;
  const pace = f.width * (610 / 960);
  // Stage B can be tall: shorten gaps within the approved range so the
  // width-scaled pace still clears them in <= .45 s at the reference tempo.
  const maxGap = Math.max(1.2, Math.min(2.2, (pace * (140 / 240) * 0.45) / size - 0.12));
  const blockWidth = 27.2 + maxGap;
  const distance = f.now * pace;
  const gate = f.width * 0.3125;
  const y = (b: ReturnType<typeof building>) => f.height * 0.635 - b.floors * size * 0.32;
  const x = (d: number) => gate + d * size - distance;
  const first = Math.floor((distance - gate) / size / blockWidth) * 2 - 2;
  const last = Math.ceil((distance + f.width - gate) / size / blockWidth) * 2 + 2;
  return {
    size,
    maxGap,
    pace,
    distance,
    gate,
    x,
    y,
    buildings: Array.from({ length: last - first + 1 }, (_, i) => building(first + i, maxGap)),
  };
}
export type World = ReturnType<typeof world>;
/** Ballistic flight begins exactly at the edge and ends inset on the next roof.
 * The quadratic has constant acceleration; endpoints and recovery are analytic. */
export function crossing(w: World, b: ReturnType<typeof building>) {
  const next = building(b.index + 1, w.maxGap);
  const takeoff = (b.end * w.size) / w.pace;
  const travel = Math.max((b.gap + 0.12) * w.size, w.pace * 0.2);
  const landing = takeoff + travel / w.pace;
  return { from: b, to: next, takeoff, landing, drop: b.floors - next.floors >= 3 };
}
export function route(w: World, now: number) {
  const d = (now * w.pace) / w.size;
  const b = buildingAt(d, w.maxGap);
  const jump = crossing(w, b);
  const previous = crossing(w, building(b.index - 1, w.maxGap));
  const active =
    now >= jump.takeoff && now < jump.landing
      ? jump
      : now >= previous.takeoff && now < previous.landing
        ? previous
        : undefined;
  const landed = now >= previous.landing ? previous : undefined;
  const recovery = landed ? (now - landed.landing) / (140 / 240) : Infinity;
  if (active) {
    const phase = (now - active.takeoff) / (active.landing - active.takeoff);
    const from = w.y(active.from),
      to = w.y(active.to);
    const lift = w.size * (active.drop ? 0.35 : 0.66);
    return {
      feet: from + (to - from) * phase - 4 * lift * phase * (1 - phase),
      airborne: true,
      jump: active,
      jumpPhase: phase,
      absorb: 0,
      roll: undefined as number | undefined,
    };
  }
  // Durations are in score time, so speed changes preserve the same pose at now.
  return {
    feet: w.y(b),
    airborne: false,
    jump: undefined,
    jumpPhase: 0,
    absorb: recovery < 0.1 ? Math.sin(clamp(recovery / 0.1) * Math.PI) : 0,
    roll: landed?.drop && recovery < 0.32 ? clamp(recovery / 0.32) : undefined,
  };
}
