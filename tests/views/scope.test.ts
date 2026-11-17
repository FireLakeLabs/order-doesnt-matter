import { expect, test } from 'vitest';
import { logBands, bandLevel, risingTrigger } from '../../src/views/scope/model';
import { createAudioFrames } from '../../src/studio/frame';
import type { OutputTap } from '../../src/contract';

test('rising trigger interpolates the first crossing with a full 50 ms remaining', () => {
  expect(risingTrigger(new Float32Array([-1, -0.25, 0.75, 1, -1, 1]))).toBe(1.25);
  expect(risingTrigger(new Float32Array([0, 0, 0, 0]))).toBe(-1);
  expect(risingTrigger(new Float32Array([1, 0.5, -1, -1, -1, 1]))).toBe(-1);
  const wave = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((i * 2 * Math.PI) / 48));
  const trigger = risingTrigger(wave);
  expect(trigger).toBeCloseTo(48);
  expect(wave.length - trigger).toBeGreaterThanOrEqual(2400);
});

test('24 log bands cover 20 Hz to 20 kHz with a linear FFT and respect Nyquist', () => {
  const bands = logBands(4096, 48000);
  expect(bands).toHaveLength(48);
  expect(bands[0]).toBe(Math.ceil(20 / (48000 / 8192)));
  expect(bands[47]).toBe(Math.ceil(20000 / (48000 / 8192)));
  const spectrum = new Uint8Array(4096);
  const frequency = 1000;
  spectrum[Math.round(frequency / (48000 / 8192))] = 255;
  const band = Math.floor((Math.log(frequency / 20) / Math.log(1000)) * 24);
  expect(bandLevel(spectrum, bands, band)).toBe(1);
  expect(bandLevel(spectrum, bands, band - 1)).toBe(0);
  expect(bandLevel(spectrum, bands, band + 1)).toBe(0);
  const limited = logBands(1024, 16000);
  expect(limited[47]).toBe(1024);
  expect(limited[46]).toBe(1024);
});

test('audio host shares one allocation-free tap read across stages per clock sample', () => {
  const read = createAudioFrames();
  let calls = 0;
  const audio = { wave: new Float32Array(4800), spectrum: new Uint8Array(4096) };
  const tap: OutputTap = {
    sampleRate: 48000,
    rms: async () => 0,
    analyse: () => {
      calls++;
      return audio;
    },
  };
  const first = {};
  expect(read(undefined, first)).toBeUndefined();
  expect(calls).toBe(0);
  expect(read(tap, first)).toBe(audio);
  expect(read(tap, first)).toBe(audio);
  expect(calls).toBe(1);
  expect(read(tap, {})).toBe(audio);
  expect(calls).toBe(2);
  expect(read(undefined, {})).toBeUndefined();
});
