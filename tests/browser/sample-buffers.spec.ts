import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { appSignal } from './helpers';
import type { ViewFrame } from '../../src/views/types';
import type {} from '../../src/studio/main';

declare global {
  interface Window {
    sampleFrames: Record<string, ViewFrame>;
    sampleDecodes: AudioBuffer[];
  }
}

test('opted-in Studio view reads playback cache PCM and exact peaks on the dubstep arrangement', async ({
  page,
  context,
}, info) => {
  // Deterministic real WAV, decoded by playback's actual AudioContext. Only the
  // remote collection/file responses are substituted, never the engine/cache.
  let fileRequests = 0;
  await context.route('https://raw.githubusercontent.com/**', (route) => {
    const bank: Record<string, unknown> = { _base: 'https://samples.invalid/' };
    for (const sound of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      bank[sound] = ['b.wav', 'b.wav', 'c.wav'];
    bank.bd = ['a.wav', 'b.wav', 'c.wav'];
    bank.pitched = { c2: ['a.wav'], e2: ['b.wav'] };
    bank.unplayed = ['unplayed.wav'];
    return route.fulfill({ json: bank });
  });
  await context.route('https://samples.invalid/**', (route) => {
    fileRequests++;
    return route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' });
  });
  await page.addInitScript(() => {
    window.sampleDecodes = [];
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function (data) {
      const buffer = await decode.call(this, data);
      window.sampleDecodes.push(buffer);
      return buffer;
    };
  });
  // Opt in a real mounted view at the built module boundary. Scope on stage B
  // remains unopted, proving the capability is independent of needs: 'audio'.
  for (const [id, optIn] of [
    ['test-card', true],
    ['scope', false],
  ] as const) {
    await page.route(`**/assets/${id}.view-*.js`, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const name = body.match(/export\{([\w$]+) as default\}/)?.[1];
      if (!name) throw Error(`${id} module has no default definition`);
      await route.fulfill({
        response,
        body:
          body +
          `
        window.sampleFrames ??= {};
        ${optIn ? `${name}.samples = true;` : ''}
        const originalMount = ${name}.mount;
        ${name}.mount = async (element) => {
          const handle = await originalMount(element);
          const stage = element.closest('[data-region]').dataset.region;
          return {
            frame(frame) { window.sampleFrames[stage] = frame; handle.frame(frame); },
            dispose() { delete window.sampleFrames[stage]; handle.dispose(); }
          };
        };
      `,
      });
    });
  }
  await page.goto('/?inspect&a=test-card&b=scope');
  await appSignal(
    page,
    () =>
      window.odmStudio.app.canPlay &&
      !!window.sampleFrames?.['stage-b'] &&
      !!window.sampleFrames?.['stage-a']?.samples,
  );
  expect(await page.evaluate(() => 'samples' in window.sampleFrames['stage-b'])).toBe(false);
  expect(await page.evaluate(() => window.odmStudio.app.engine == null)).toBe(true);
  expect(
    await page.evaluate(() => window.sampleFrames['stage-a'].samples!.get('bd', 0).status),
  ).toBe('loading');
  expect(fileRequests).toBe(0);
  await page.evaluate(
    (source) => window.odmStudio.load(source),
    await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
  );
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await appSignal(
    page,
    () =>
      window.odmStudio.app.engine?.playing &&
      window.sampleFrames['stage-a'].samples!.get('bd', 0).status === 'buffer',
  );
  expect(await page.evaluate(() => window.sampleFrames['stage-a'].samples!.get('sine', 0))).toEqual(
    { status: 'synth' },
  );
  expect(
    await page.evaluate(() => window.sampleFrames['stage-a'].samples!.get('unknown_sound', 0)),
  ).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('Unknown sound') });

  const measured = await page.evaluate(() => {
    const samples = window.sampleFrames['stage-a'].samples!;
    const handle = samples.get('bd', 0);
    if (handle.status !== 'buffer') throw Error('No decoded bd buffer');
    const decoded = window.sampleDecodes.find(
      (buffer) => buffer.getChannelData(0) === handle.channels[0],
    );
    if (!decoded) throw Error('Sample lookup is not using playback decoded PCM');
    let peakError = 0;
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      const { min, max } = handle.peaks.channels[c];
      if (min.length !== Math.ceil(data.length / 512) || max.length !== min.length)
        throw Error('Wrong peak count');
      for (let b = 0; b < min.length; b++) {
        const block = data.subarray(b * 512, Math.min(data.length, (b + 1) * 512));
        peakError = Math.max(
          peakError,
          Math.abs(min[b] - Math.min(...block)),
          Math.abs(max[b] - Math.max(...block)),
        );
      }
    }
    const wrapped = samples.get('bd', -1);
    const pitched = samples.get('pitched', 0, { note: 'e2' });
    return {
      frameCount: handle.frameCount,
      decodedFrames: decoded.length,
      sampleRate: handle.sampleRate,
      decodedRate: decoded.sampleRate,
      duration: handle.duration,
      decodedDuration: decoded.duration,
      fileName: handle.fileName,
      channels: handle.channels.length,
      shared: samples.get('bd', 0) === handle,
      wrappedFile: wrapped.status === 'buffer' ? wrapped.fileName : wrapped.status,
      pitchedFile: pitched.status === 'buffer' ? pitched.fileName : pitched.status,
      peakError,
      blockSize: handle.peaks.blockSize,
      unplayed: samples.get('unplayed', 0).status,
    };
  });
  expect(measured.frameCount).toBeGreaterThan(0);
  expect(measured.frameCount).toBe(measured.decodedFrames);
  expect(measured.sampleRate).toBe(measured.decodedRate);
  expect(measured.duration).toBe(measured.decodedDuration);
  expect(measured.fileName).toBe('a.wav');
  expect(measured.shared).toBe(true);
  expect(measured.wrappedFile).toBe('c.wav');
  expect(measured.pitchedFile).toBe('b.wav');
  expect(measured.peakError).toBe(0);
  expect(measured.blockSize).toBe(512);
  expect(measured.unplayed).toBe('loading');
  expect(fileRequests).toBe(3); // three played URLs; lookup never loads unplayed.wav
  await info.attach('sample-buffer-measurements', {
    body: JSON.stringify(measured),
    contentType: 'application/json',
  });
  console.log('SAMPLE BUFFERS MEASURED', JSON.stringify(measured));
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
