import { expect, test } from '@playwright/test';
import type { EngineEvent } from '../../src/contract';
import type {} from '../../src/engine/harness';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });
// Trusted click plus autoplay flag: Chromium runs a real advancing headless audio clock.
test('engine: rendered synth/sample PCM, missing files, live revisions, errors and seek', async ({
  page,
}) => {
  const defaults: string[] = [];
  await page.route(
    (url) => url.protocol === 'https:',
    (route) => {
      defaults.push(route.request().url());
      return route.abort('internetdisconnected');
    },
  );
  await page.goto('/harness/engine.html');
  await page.getByRole('button').click();
  await expect.poll(() => page.evaluate(() => window.odm.error || !!window.odm.engine)).toBe(true);
  const measured = await page.evaluate(async () => {
    const { engine: e, events, fixture } = window.odm;
    if (!e) throw Error('engine not initialized');
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = async (predicate: () => boolean) => {
      for (let i = 0; i < 400; i++) {
        if (predicate()) return;
        await sleep(10);
      }
      throw Error(
        'Timed out waiting for engine event: ' +
          JSON.stringify({ events, now: e.audioTime(), playing: e.playing }),
      );
    };
    const triggers = () =>
      events.filter(
        (event): event is Extract<EngineEvent, { type: 'trigger' }> => event.type === 'trigger',
      );
    await e.play('note("c3 e3 g3").s("sawtooth")');
    await until(() => triggers().length >= 3);
    const first = triggers().slice(0, 3);
    const tap = e.tap();
    const baseline = await tap.rms(first[0].time - 0.08, first[0].time - 0.02);
    const synth = await Promise.all(first.map((t) => tap.rms(t.time + 0.005, t.time + 0.105)));
    const wasPlaying = e.playing,
      calledAt = e.audioTime();
    const transportStates: boolean[] = [];
    const observer = setInterval(() => transportStates.push(e.playing), 5);
    const revision = await e.play('note("a4").s("square").fast(4)');
    await until(() => events.some((t) => t.type === 'swapped' && t.revision === revision));
    const swapped = events.find(
      (t): t is Extract<EngineEvent, { type: 'swapped' }> =>
        t.type === 'swapped' && t.revision === revision,
    )!;
    await until(() => triggers().filter((t) => t.time > swapped.time).length >= 2);
    clearInterval(observer);
    const later = triggers().filter((t) => t.time > swapped.time);
    const beforeFailure = triggers().length;
    let rejected = false;
    try {
      await e.play('note(');
    } catch {
      rejected = true;
    }
    await until(() => triggers().length > beforeFailure);
    const afterFailure = triggers().at(-1)!;
    const failureErrors = events.filter((t) => t.type === 'error');
    const transports = events.filter((t) => t.type === 'transport');
    e.stop();
    const stoppedCount = triggers().length,
      stoppedNow = e.now();
    await sleep(350);
    const stoppedTriggers = triggers().length;
    // Let the previous voices finish before measuring the next isolated source.
    await sleep(350);
    events.length = 0;
    await e.play(`samples({fixture: ['${fixture}']}); s("fixture").fast(4)`);
    await until(() => triggers().length >= 1);
    const sampleTrigger = triggers()[0];
    const sample = await tap.rms(sampleTrigger.time + 0.005, sampleTrigger.time + 0.085);
    const sampleStates = events.filter((t) => t.type === 'sounds').flatMap((t) => t.sounds);
    e.stop();
    await sleep(500);
    events.length = 0;
    await e.play('s("definitely_not_a_sound")');
    await until(() => triggers().length > 0);
    const missingStates = e.sounds();
    const missing = await tap.rms(triggers()[0].time + 0.005, triggers()[0].time + 0.105);
    e.stop();
    events.length = 0;
    await e.play('note("c3").s("sine")', { fromCycle: 8 });
    await until(() => triggers().length > 0);
    const sought = triggers()[0].cycle,
      playhead = e.now();
    e.stop();
    return {
      rate: tap.sampleRate,
      baseline,
      synth,
      cycles: first.map((t) => t.cycle),
      sample,
      sampleStates,
      missingStates,
      missing,
      wasPlaying,
      transportObservations: transportStates.length,
      continuouslyPlaying: transportStates.every(Boolean),
      revision,
      swapLatencyMs: (swapped.time - calledAt) * 1000,
      later,
      transports,
      rejected,
      afterFailure,
      stoppedCount,
      stoppedTriggers,
      stoppedNow,
      sought,
      playhead,
      failureErrors,
    };
  });
  console.log('ENGINE MEASURED', JSON.stringify(measured));
  expect(measured.cycles).toEqual([0, 1 / 3, 2 / 3]);
  for (const level of measured.synth) {
    expect(level).toBeGreaterThan(0.001);
    expect(level).toBeGreaterThan(measured.baseline * 10);
  }
  expect(measured.sample).toBeGreaterThan(0.001);
  expect(measured.sampleStates.map((s) => s.state)).toEqual(
    expect.arrayContaining(['loading', 'ready']),
  );
  expect(measured.missingStates[0]).toMatchObject({
    name: 'definitely_not_a_sound',
    state: 'missing',
    detail: expect.stringContaining('Unknown sound'),
  });
  expect(measured.missing).toBeLessThan(0.000001);
  expect(measured.wasPlaying).toBe(true);
  expect(measured.transportObservations).toBeGreaterThan(0);
  expect(measured.continuouslyPlaying).toBe(true);
  expect(defaults).toHaveLength(7);
  expect(measured.transports).toEqual([{ type: 'transport', playing: true }]);
  expect(measured.later.length).toBeGreaterThan(0);
  for (const trigger of measured.later) expect(trigger.value).toMatchObject({ s: 'square' });
  expect(measured.rejected).toBe(true);
  expect(measured.failureErrors.length).toBeGreaterThan(0);
  expect(measured.afterFailure.value).toMatchObject({ s: 'square' });
  expect(measured.stoppedTriggers).toBe(measured.stoppedCount);
  expect(measured.stoppedNow).toBeNull();
  expect(measured.sought).toBe(8);
  expect(measured.playhead).not.toBeNull();
});

test('canary: web bundle registry, REPL capture, final output gain and failed sample decode', async ({
  page,
}) => {
  await page.goto('/harness/engine.html');
  const fixture = await page.evaluate(() => window.odm.fixture);
  let collections = 0;
  await page.route(
    (url) => url.protocol === 'https:',
    (route) => {
      collections++;
      // Every collection is local test data. Full Dirt must win duplicate registration.
      const last = route.request().url().includes('tidalcycles/dirt-samples/main');
      return route.fulfill({ json: { _base: '', defaultbank: [last ? fixture : '/absent.wav'] } });
    },
  );
  await page.route('**/absent.wav', (route) => route.fulfill({ status: 404, body: 'not a WAV' }));
  await page.getByRole('button').click();
  await expect.poll(() => page.evaluate(() => window.odm.error || !!window.odm.engine)).toBe(true);
  const result = await page.evaluate(async () => {
    const e = window.odm.engine!;
    await e.play('s("defaultbank")');
    const defaults = e.sounds();
    e.stop();
    await e.play(`samples({broken: ['/absent.wav']}); s("broken")`);
    const broken = e.sounds();
    e.stop();
    let rejected = false;
    try {
      await e.play('note("not_a_note").s("sine")');
    } catch {
      rejected = true;
    }
    return {
      defaults,
      broken,
      rejected,
      errors: window.odm.events.filter((e) => e.type === 'error'),
      playing: e.playing,
    };
  });
  expect(collections).toBe(7);
  expect(result.defaults).toEqual([{ name: 'defaultbank', state: 'ready' }]);
  expect(result.broken[0]).toMatchObject({
    name: 'broken',
    state: 'missing',
    detail: expect.stringContaining('failed to load'),
  });
  expect(result.rejected).toBe(true);
  expect(result.playing).toBe(false);
  expect(result.errors.length).toBeGreaterThan(0);
});
