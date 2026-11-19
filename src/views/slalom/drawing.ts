import type { ViewTheme } from '../types';

/** Opaque snow paint, lightly tinted by the theme even on a night course. */
export function mix(a: string, b: string, amount: number) {
  const channels = [1, 3, 5].map((i) =>
    Math.round(
      parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount,
    ),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
export function snowPaint(theme: ViewTheme) {
  const snow = mix(theme.panel, '#ffffff', 0.9);
  return {
    snow,
    light: mix(snow, '#ffffff', 0.7),
    shade: mix(snow, theme.line, 0.24),
    groove: mix(snow, theme.line, 0.64),
    red: mix('#ed3657', theme.accent, 0.12),
    blue: mix('#2468d9', theme.accent, 0.12),
  };
}
export function gatePosition(start: number) {
  const beat = Math.floor((start - Math.floor(start)) * 400 + 1e-8) / 100 + 1;
  return `${String(Math.floor(start) + 1)}:${String(beat)}`;
}
