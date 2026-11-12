export interface ControlInfo {
  min: number;
  max: number;
  step: number;
  scale: 'linear' | 'log';
  unit: string;
}
const range = (
  min: number,
  max: number,
  step: number,
  unit = '',
  scale: ControlInfo['scale'] = 'linear',
): ControlInfo => ({ min, max, step, unit, scale });
/** Meanings: https://strudel.cc/learn/effects/ and /learn/samples/#speed
 * Cutoffs are Hz; resonance is Q; gain/sends/feedback/sustain are ratios;
 * pan is left 0 → right 1; envelope and delay times are seconds; crush is bits;
 * speed is the sample playback ratio (negative reverses); roomsize is dimensionless.
 * These are useful slider windows, not validation limits. Exact fields stay unbounded.
 */
const controls: Record<string, ControlInfo> = {
  gain: range(0, 2, 0.01, ''),
  lpf: range(20, 20000, 1, 'Hz', 'log'),
  hpf: range(20, 20000, 1, 'Hz', 'log'),
  resonance: range(0, 50, 0.1, 'Q'),
  pan: range(0, 1, 0.01),
  room: range(0, 1, 0.01, ''),
  roomsize: range(0, 10, 0.1),
  delay: range(0, 1, 0.01, ''),
  delaytime: range(0, 2, 0.01, 's'),
  delayfeedback: range(0, 0.95, 0.01, ''),
  speed: range(-4, 4, 0.01, ''),
  attack: range(0, 4, 0.01, 's'),
  decay: range(0, 4, 0.01, 's'),
  sustain: range(0, 1, 0.01, ''),
  release: range(0, 8, 0.01, 's'),
  crush: range(1, 16, 1, 'bits'),
  distort: range(0, 10, 0.1, ''),
};
const aliases: Record<string, string> = {
  cutoff: 'lpf',
  hcutoff: 'hpf',
  lpq: 'resonance',
  size: 'roomsize',
};
export const controlInfo = (name: string): ControlInfo | undefined =>
  controls[aliases[name] ?? name];
export function sliderValue(info: ControlInfo, value: number): number {
  return info.scale === 'log'
    ? Math.log(value / info.min) / Math.log(info.max / info.min)
    : (value - info.min) / (info.max - info.min);
}
export function fromSlider(info: ControlInfo, position: number): number {
  const value =
    info.scale === 'log'
      ? info.min * (info.max / info.min) ** position
      : info.min + position * (info.max - info.min);
  return Number((Math.round(value / info.step) * info.step).toPrecision(12));
}
