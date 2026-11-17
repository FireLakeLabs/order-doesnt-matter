/** OutputTap's wave contains 100 ms; display half, leaving half for triggering. */
export function risingTrigger(wave: Float32Array): number {
  const last = Math.floor(wave.length / 2);
  for (let i = 1; i <= last; i++) {
    if (wave[i - 1] < 0 && wave[i] >= 0) return i - 1 + -wave[i - 1] / (wave[i] - wave[i - 1]);
  }
  return -1;
}

/** Precompute 24 log-spaced bands over a linear, Nyquist-limited FFT. Each
 * interval includes bin centres in [low, high); sub-bin bands use the nearest
 * available bin rather than disappearing at low frequencies. */
export function logBands(bins: number, sampleRate: number): Uint32Array {
  const ranges = new Uint32Array(48);
  const resolution = sampleRate / (2 * bins);
  for (let band = 0; band < 24; band++) {
    const low = 20 * 1000 ** (band / 24);
    const high = 20 * 1000 ** ((band + 1) / 24);
    const from = Math.min(bins, Math.max(1, Math.ceil(low / resolution)));
    const to = Math.min(bins, Math.max(from + 1, Math.ceil(high / resolution)));
    ranges[band * 2] = from;
    ranges[band * 2 + 1] = to;
  }
  return ranges;
}
export function bandLevel(spectrum: Uint8Array, bands: Uint32Array, band: number): number {
  let peak = 0;
  for (let i = bands[band * 2]; i < bands[band * 2 + 1]; i++) peak = Math.max(peak, spectrum[i]);
  return peak / 255;
}
