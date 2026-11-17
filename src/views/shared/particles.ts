import { clamp } from './math';
export interface Particle {
  x: number;
  y: number;
  alpha: number;
}
/** Stateless unit pseudorandom sample from a 32-bit integer seed and channel. */
export function random(seed: number, channel = 0): number {
  let n = Math.imul((seed | 0) ^ Math.imul(channel + 1, 0x9e3779b9), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 16), 0xc2b2ae35);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}
/** Radial unit burst at age time, fading over one cycle; pass reusable out to allocate nothing. */
export function burst(seed: number, time: number, out: Particle): Particle {
  const angle = random(seed) * Math.PI * 2,
    speed = 0.4 + random(seed, 1) * 0.6;
  out.x = Math.cos(angle) * speed * time;
  out.y = Math.sin(angle) * speed * time;
  out.alpha = time < 0 ? 0 : clamp(1 - time);
  return out;
}
/** Ballistic spark at age time in cycles, fading over one cycle; writes reusable out. */
export function spark(seed: number, time: number, out: Particle): Particle {
  out.x = (random(seed) - 0.5) * 2 * time;
  out.y = -(0.5 + random(seed, 1)) * time + time * time;
  out.alpha = time < 0 ? 0 : clamp(1 - time);
  return out;
}
/** Looping drifting ash in unit coordinates at absolute time in cycles; writes reusable out. */
export function ash(seed: number, time: number, out: Particle): Particle {
  const phase = (((time * (0.05 + random(seed, 1) * 0.1) + random(seed, 2)) % 1) + 1) % 1;
  out.x = (((random(seed) + Math.sin(time * 0.3 + random(seed, 3) * 6) * 0.1) % 1) + 1) % 1;
  out.y = 1 - phase;
  out.alpha = Math.sin(phase * Math.PI) * 0.6;
  return out;
}
/** Fixed unit-position star with time-pure twinkle at absolute cycles; writes reusable out. */
export function star(seed: number, time: number, out: Particle): Particle {
  out.x = random(seed);
  out.y = random(seed, 1);
  out.alpha =
    0.35 +
    0.65 * (0.5 + 0.5 * Math.sin(time * (1 + random(seed, 2)) + random(seed, 3) * Math.PI * 2));
  return out;
}
