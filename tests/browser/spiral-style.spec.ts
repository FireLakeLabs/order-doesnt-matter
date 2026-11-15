import { expect } from '@playwright/test';
import { test, openProgram, play, selectNode, appSignal, scoreReady } from './helpers';

const style = (page: import('@playwright/test').Page) =>
  page.getByRole('combobox', { name: 'Style', exact: true });
const controls = (page: import('@playwright/test').Page) =>
  page.locator('.spiral-controls > summary');

test('Kiln style switching preserves playback, pinned score, editor, exact spans and focus', async ({
  page,
}) => {
  await openProgram(page, { example: 'Kiln' });
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  const origin = await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  await play(page);
  // Pin editing elsewhere while the camera and Now continue following playback.
  await page.getByRole('button', { name: 'Section 3', exact: true }).click();
  await scoreReady(page);
  await controls(page).click();
  await expect(style(page)).toHaveValue('ring');
  const held = await page.evaluateHandle(() => ({
    doc: JSON.stringify(window.odmApp.state.doc),
    events: window.odmApp.state.events,
    engine: window.odmApp.engine,
    editor: window.odmApp.editor,
    selected: window.odmApp.state.selected,
    cps: window.odmApp.state.cps,
    canvas: document.querySelector('#spiral canvas'),
    field: document.querySelector('#editor input'),
    planet: document.querySelector('[data-live-id]'),
    input: window.odmApp.watchInput(8.25),
  }));
  await style(page).focus();
  await style(page).press('End');
  await style(page).press('Enter');
  await expect(style(page)).toHaveValue('fly-through');
  for (const theme of ['fern', 'night', 'paper'])
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
  await page.locator('#watch').press('Enter');
  expect(
    await held.evaluate((s) => {
      window.odmSpiral.update(s.input);
      const before = JSON.stringify(window.odmSpiral.marks);
      const picker = document.querySelector<HTMLSelectElement>('.spiral-controls select')!;
      picker.value = 'ring';
      picker.dispatchEvent(new Event('change'));
      window.odmSpiral.update(s.input);
      const sameMarks = before === JSON.stringify(window.odmSpiral.marks);
      picker.value = 'fly-through';
      picker.dispatchEvent(new Event('change'));
      return {
        sameMarks,
        doc: s.doc === JSON.stringify(window.odmApp.state.doc),
        events: s.events === window.odmApp.state.events,
        engine: s.engine === window.odmApp.engine,
        editor: s.editor === window.odmApp.editor,
        selected: s.selected === window.odmApp.state.selected,
        cps: s.cps === window.odmApp.state.cps,
        canvas: s.canvas === document.querySelector('#spiral canvas'),
        field: s.field === document.querySelector('#editor input'),
        planet: s.planet === document.querySelector('[data-live-id]'),
      };
    }),
  ).toEqual({
    sameMarks: true,
    doc: true,
    events: true,
    engine: true,
    editor: true,
    selected: true,
    cps: true,
    canvas: true,
    field: true,
    planet: true,
  });
  await appSignal(page, () =>
    window.odmApp.history.some((e) => e.type === 'trigger' && e.cycle > 4.5),
  );
  const observed = await page.evaluate(() => {
    const app = window.odmApp,
      input = app.watchInput(app.engine!.now());
    return {
      cycle: window.odmSpiral.cycle,
      playing: app.state.playing,
      input: input.playhead!,
      latency: input.outputLatency ?? 0,
      cps: app.state.cps!,
      nowActive: document.querySelectorAll('.live-playing').length > 0,
      agrees: app.history.some(
        (t) =>
          t.type === 'trigger' &&
          t.cycle >= 4 &&
          Object.values(input.events).some((r) =>
            r.events.some(
              (e) =>
                e.whole &&
                e.whole[0] === t.cycle &&
                JSON.stringify(e.value) === JSON.stringify(t.value),
            ),
          ),
      ),
    };
  });
  expect(observed.playing && observed.agrees && observed.nowActive).toBe(true);
  expect(
    Math.abs(observed.cycle - (observed.input - observed.latency * observed.cps)),
  ).toBeLessThan(0.15 * observed.cps);
  await page.locator('#preview-close').press('Enter');
  await expect(page.locator('#watch')).toBeFocused();
  await page.locator('#editor input').first().focus();
  await page.keyboard.press('Escape');
  await expect(origin).toBeFocused();
  await held.dispose();
});

test('busy original score keeps numbered states and fits both phone heights; motion preference changes live', async ({
  page,
}, info) => {
  const names = Array.from({ length: 14 }, (_, n) => `long_original_instrument_${n + 1}`);
  await openProgram(page, {
    source:
      names
        .map(
          (name, n) =>
            `const ${name}=${n === 0 ? 'note("48*129")' : n === 1 ? 'note(49).slow(3)' : `note("${48 + n} ~@99").fast(8)`}.s("sine");`,
        )
        .join('\n') + `\nstack(${names.join(',')})`,
  });
  await controls(page).click();
  await style(page).selectOption('fly-through');
  await play(page);
  await appSignal(page, () => window.odmApp.history.some((e) => e.type === 'trigger'));
  const measurement = await page.evaluate(async () => {
    const submission: number[] = [],
      intervals: number[] = [];
    let previous = performance.now();
    // A bounded 60-frame observation, without capping or filtering slow frames.
    for (let n = 0; n < 60; n++) {
      const time = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      intervals.push(time - previous);
      previous = time;
      submission.push(window.odmSpiral.drawMs);
    }
    return {
      submission,
      intervals,
      hardwareConcurrency: navigator.hardwareConcurrency,
      sampleCap: 60,
    };
  });
  await info.attach('fly-through-frame-measurement', {
    body: JSON.stringify(measurement),
    contentType: 'application/json',
  });
  await page.locator('#stop').click();
  if (process.env.ODM_STYLE_SHOTS)
    await page
      .locator('#watch-preview')
      .screenshot({ path: `${process.env.ODM_STYLE_SHOTS}/compact.png` });
  await page.locator('#watch').press('Enter');
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 390, height: 667 },
  ]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await style(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('.spiral-legend li')).toContainText(
      names.map((name, n) => `${n + 1}. ${name}`),
    );
    await page.locator('.spiral-legend li').last().scrollIntoViewIfNeeded();
    if (process.env.ODM_STYLE_SHOTS)
      await page
        .locator('#watch-preview')
        .screenshot({ path: `${process.env.ODM_STYLE_SHOTS}/${size.width}-${size.height}.png` });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.spiral-status')).toContainText('static depth per turn');
  if (process.env.ODM_STYLE_SHOTS)
    await page
      .locator('#watch-preview')
      .screenshot({ path: `${process.env.ODM_STYLE_SHOTS}/reduced-390-667.png` });
  expect(
    await page.evaluate(() => {
      const app = window.odmApp,
        view = window.odmSpiral;
      view.update(app.watchInput(0.2));
      const before = view.marks.map((m) => m.startAngle);
      view.update(app.watchInput(0.4));
      return JSON.stringify(before) === JSON.stringify(view.marks.map((m) => m.startAngle));
    }),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.spiral-status')).not.toContainText('static depth per turn');
  const states = await page.evaluate(() => {
    const app = window.odmApp,
      view = window.odmSpiral,
      input = app.watchInput(0.25);
    view.update(input);
    const canvas = document.querySelector<HTMLCanvasElement>('#spiral canvas')!;
    const frozen = canvas.toDataURL();
    view.update(input);
    const stationary = frozen === canvas.toDataURL();
    const before = JSON.stringify(view.marks),
      known = JSON.stringify(input.known);
    let queries = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message: unknown,
      options?: StructuredSerializeOptions | Transferable[],
    ) {
      queries++;
      Reflect.apply(post, this, [message, options]);
    };
    try {
      const picker = document.querySelector<HTMLSelectElement>('.spiral-controls select')!;
      for (const value of ['ring', 'fly-through']) {
        picker.value = value;
        picker.dispatchEvent(new Event('change'));
      }
      view.update(input);
    } finally {
      Worker.prototype.postMessage = post;
    }
    const unchanged =
      before === JSON.stringify(view.marks) && known === JSON.stringify(input.known);
    const facts = {
      stationary,
      unchanged,
      queries,
      dense: view.marks.some((m) => m.dense),
      tiny: view.marks.some((m) => m.onset && m.to - m.from < 0.002),
      long: view.marks.some((m) => !m.onset && m.to === 2),
    };
    const rows = input.rows;
    view.update({
      ...input,
      known: [],
      sounds: [{ name: 'sine', state: 'missing' }],
      events: {
        ...input.events,
        [rows[12].id]: { ...input.events[rows[12].id], events: [] },
        [rows[13].id]: {
          ...input.events[rows[13].id],
          events: [],
          error: { phase: 'query', message: 'Original test failure' },
        },
      },
    });
    return {
      ...facts,
      text: document.querySelector('.spiral-status')!.textContent,
      legend: document.querySelector('.spiral-legend')!.textContent,
    };
  });
  expect(states.dense && states.tiny && states.long && states.stationary && states.unchanged).toBe(
    true,
  );
  expect(states.queries).toBe(0);
  expect(states.text).toContain('not asked yet');
  expect(states.legend).toContain('missing');
  expect(states.legend).toContain('broken: Original test failure');
  await page.locator('#preview-close').press('Enter');
  await expect(page.locator('#watch')).toBeFocused();
});

test('stored old, malformed and denied Watch settings fall back without creating an engine', async ({
  page,
}) => {
  await openProgram(page);
  for (const raw of [
    '{"keep":2,"upcoming":4}',
    '{"keep":1,"upcoming":2,"style":"invalid"}',
    'broken',
    '{"keep":1,"upcoming":2,"style":"fly-through"}',
  ]) {
    await page.evaluate((raw) => localStorage.setItem('odm-watch-view', raw), raw);
    await page.reload();
    await page.locator('.spiral-controls').evaluate((el: HTMLDetailsElement) => {
      el.open = true;
    });
    await expect(page.locator('.spiral-controls select')).toHaveValue(
      raw.includes('fly-through') ? 'fly-through' : 'ring',
    );
    expect(await page.evaluate(() => window.odmApp.engine)).toBeNull();
  }
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    }),
  );
  await openProgram(page, { source: 'note("c3*4").s("sine")' });
  await controls(page).click();
  await expect(style(page)).toHaveValue('ring');
  await style(page).selectOption('fly-through');
  expect(await page.evaluate(() => window.odmApp.engine)).toBeNull();
});
