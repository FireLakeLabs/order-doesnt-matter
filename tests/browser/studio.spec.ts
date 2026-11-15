import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import type {} from '../../src/studio/main';

const shots = '/tmp/odm-studio-shell';
async function frames(page: Page, count = 4) {
  await page.evaluate(async (count) => {
    await new Promise<void>((resolve) => {
      let remaining = count;
      const tick = () => {
        if (--remaining === 0) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, count);
}
async function assets(context: BrowserContext) {
  // Asset delivery is deterministic. Queries, controller and scheduled triggers are real.
  await context.route('https://raw.githubusercontent.com/**', async (route) => {
    const map: Record<string, unknown> = {
      _base: `${new URL(route.request().url()).origin}/studio-sounds/`,
    };
    for (const name of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      map[name] = ['burst.wav', 'burst.wav', 'burst.wav'];
    await route.fulfill({ json: map });
  });
  await context.route('**/studio-sounds/burst.wav', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
}
async function load(page: Page, piece = 'real-dubstep-arranged') {
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  const source = await readFile(`corpus/programs/${piece}.strudel`, 'utf8');
  await page.getByLabel('Strudel program').fill(source);
  await page.getByRole('button', { name: 'Import program', exact: true }).click();
  await page.waitForFunction(
    (source) => window.odmStudio.app.state.source === source && window.odmStudio.app.canPlay,
    source,
    { timeout: 0 },
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
const pixels = (page: Page, stage: 'a' | 'b' = 'a') =>
  page.locator(`[data-region="stage-${stage}"] canvas`).evaluate((canvas: HTMLCanvasElement) => {
    const bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  });
async function noScroll(page: Page) {
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(layout.scrollWidth).toBe(layout.width);
  expect(layout.scrollHeight).toBe(layout.height);
  return layout;
}
async function startAt(page: Page, cycle: number) {
  await page.evaluate(async (cycle) => {
    window.odmStudio.stop();
    await window.odmStudio.app.play(cycle);
  }, cycle);
  await page.waitForFunction(
    (cycle) => window.odmStudio.app.state.playing && window.odmStudio.getPlayhead() >= cycle,
    cycle,
  );
}

test('Studio shell on dubstep: section rail, two stages, shared clock, shelf, fill and all themes', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await assets(context);
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('/studio.html?inspect&a=test-card&b=test-card');
  await load(page);
  await expect(page.getByTestId('playing-instruments').locator('li')).toHaveCount(3);
  await expect(page.locator('.resting-chip')).toHaveCount(10);
  await expect(page.getByTestId('instruments')).not.toContainText('Instrument ');
  await expect(page.locator('canvas')).toHaveCount(2);
  await expect(page.locator('.view-host').first()).toHaveAttribute('data-score-ready', 'true');
  await expect(page.locator('.view-host').last()).toHaveAttribute('data-score-ready', 'true');
  // Subscribe read probes only in this test. Both canvases share a single sample per RAF.
  await page.evaluate(() => {
    const runtime = window.odmStudio;
    const read = runtime.getPlayhead.bind(runtime);
    const reads = new Map<number, number>();
    runtime.getPlayhead = () => {
      const time = document.timeline.currentTime as number;
      reads.set(time, (reads.get(time) ?? 0) + 1);
      return read();
    };
    Object.assign(window, { studioReads: reads, studioReadPlayhead: read });
  });
  await frames(page, 8);
  expect(
    await page.evaluate(() =>
      [...(window as unknown as { studioReads: Map<number, number> }).studioReads.values()].every(
        (count) => count === 1,
      ),
    ),
  ).toBe(true);
  await startAt(page, 3.9);
  await expect(page.getByTestId('playing-instruments').locator('li')).toHaveCount(4);
  await expect(page.locator('.resting-chip')).toHaveCount(9);
  await startAt(page, 8);
  await expect(page.getByTestId('playing-instruments').locator('li')).toHaveCount(6);
  await expect(page.locator('.resting-chip')).toHaveCount(7);
  await expect(page.locator('.instrument-group h3')).toHaveText('dubstepDrums');
  const selected = page.locator('.instrument-row').first();
  await selected.locator('.instrument-select').click();
  await expect(selected).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('.instrument-row[data-sounding="true"]').first()).toBeVisible();
  const before = await pixels(page, 'b');
  await frames(page, 8);
  expect(await pixels(page, 'b')).not.toBe(before);
  // Hold only the visual clock for repeatable theme comparisons at the first drop.
  // The real scheduler/trigger checks run separately below.
  await page.evaluate(() => {
    window.odmStudio.getPlayhead = () => 10.4;
  });
  await frames(page);
  const sizes = await page.locator('[data-region]').evaluateAll((regions) =>
    Object.fromEntries(
      regions.map((region) => {
        const rect = region.getBoundingClientRect();
        return [region.getAttribute('data-region'), [rect.width, rect.height]];
      }),
    ),
  );
  for (const [name, size] of Object.entries({
    'instrument-rail': [300, 760],
    'stage-a': [1300, 760],
    'stage-b': [560, 760],
    'view-shelf': [400, 760],
  }))
    for (let i = 0; i < 2; i++)
      expect(Math.abs(sizes[name][i] - size[i]) / size[i]).toBeLessThan(0.05);
  const rowSize = await selected.boundingBox();
  expect(rowSize!.height).toBe(64);
  expect(
    await page.locator('.playing-list').evaluate((list) => list.scrollHeight <= list.clientHeight),
  ).toBe(true);
  const wideLayout = await noScroll(page);
  await mkdir(shots, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${shots}/arcade-2560x1440.png` });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await frames(page);
  expect(
    await page.locator('.playing-list').evaluate((list) => list.scrollHeight <= list.clientHeight),
  ).toBe(true);
  const compactLayout = await noScroll(page);
  await page.screenshot({ path: `${shots}/arcade-1920x1080.png` });
  const a = page.locator('[data-region="stage-a"]');
  await a.getByRole('button', { name: 'Views', exact: true }).click();
  await expect(a.locator('.shelf-popover')).toBeVisible();
  await page.screenshot({ path: `${shots}/shelf-1920x1080.png` });
  await a.getByRole('button', { name: 'Test card on Stage B', exact: true }).click();
  await expect(a.locator('.shelf-popover')).toHaveCount(0);
  for (const name of ['phosphor', 'pocket', 'riso', 'sunset']) {
    await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', name);
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    await noScroll(page);
    expect(
      await page
        .locator('.playing-list')
        .evaluate((list) => list.scrollHeight <= list.clientHeight),
    ).toBe(true);
    await page.screenshot({ path: `${shots}/${name}-1920x1080.png` });
  }
  await page.getByRole('button', { name: 'Theme arcade', exact: true }).click();
  await page.getByRole('button', { name: 'Fill window with Stage B', exact: true }).click();
  const filled = await page.locator('[data-region="stage-b"]').boundingBox();
  expect(filled).toMatchObject({ x: 0, y: 108, width: 1920, height: 972 });
  await frames(page);
  await page.screenshot({ path: `${shots}/filled-stage-b-1920x1080.png` });
  await page.keyboard.press('Escape');
  await expect(page.locator('.studio')).not.toHaveAttribute('data-filled');
  await page.getByRole('button', { name: 'Clear Stage B', exact: true }).click();
  await expect(page.locator('canvas')).toHaveCount(1);
  await a.getByRole('button', { name: 'Views', exact: true }).click();
  const tile = a.locator('[data-view="test-card"]');
  // Real HTML drag payload and drop handling; a tile can target either stage.
  await tile.dragTo(page.locator('[data-region="stage-b"]'));
  await expect(page.locator('canvas')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.odmStudio.getPlayhead = (
      window as unknown as { studioReadPlayhead: () => number }
    ).studioReadPlayhead;
  });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await frames(page);
  const stopped = await pixels(page);
  await frames(page);
  expect(await pixels(page)).toBe(stopped);
  expect(errors).toEqual([]);
  await writeFile(
    `${shots}/measurements.json`,
    JSON.stringify({ sizes, wideLayout, compactLayout, filled, errors }, null, 2),
  );
});

declare global {
  interface Window {
    studioLastRevision: number;
  }
}
async function revisionTriggers(page: Page) {
  const revision = await page.evaluate(() => window.studioLastRevision);
  await page.waitForFunction((revision) => {
    const triggers = window.odmStudio.app.history.flatMap((event) =>
      event.type === 'trigger' && event.revision === revision ? [event] : [],
    );
    return triggers.length > 0 && triggers.at(-1)!.cycle >= triggers[0].cycle + 1;
  }, revision);
  return page.evaluate(
    (revision) =>
      window.odmStudio.app.history.flatMap((event) =>
        event.type === 'trigger' && event.revision === revision
          ? [(event.value as { s?: string }).s]
          : [],
      ),
    revision,
  );
}
test('mute and solo are document edits: scheduled triggers change and Undo restores them', async ({
  page,
  context,
}) => {
  await assets(context);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/studio.html?inspect');
  await load(page);
  await startAt(page, 8);
  await page.evaluate(() => {
    const engine = window.odmStudio.app.engine!;
    const play = engine.play.bind(engine);
    engine.play = async (code, options) => {
      const revision = await play(code, options);
      window.studioLastRevision = revision;
      return revision;
    };
  });
  const kick = page.getByRole('button', { name: 'Mute bd', exact: true });
  await kick.click();
  expect(await page.evaluate(() => window.odmStudio.app.editor!.settle())).toBe(true);
  const muted = await revisionTriggers(page);
  expect(muted).not.toContain('bd');
  expect(muted).toContain('hh');
  await page.evaluate(() => {
    window.odmStudio.app.editor!.undo();
  });
  expect(await page.evaluate(() => window.odmStudio.app.editor!.settle())).toBe(true);
  await expect(kick).toBeVisible();
  await startAt(page, 8);
  expect(await revisionTriggers(page)).toContain('bd');
  await page.getByRole('button', { name: 'Solo subBass', exact: true }).click();
  expect(await page.evaluate(() => window.odmStudio.app.editor!.settle())).toBe(true);
  expect([...new Set(await revisionTriggers(page))]).toEqual(['sine']);
  await page.evaluate(() => {
    window.odmStudio.app.editor!.undo();
  });
  expect(await page.evaluate(() => window.odmStudio.app.editor!.settle())).toBe(true);
  await expect(page.getByRole('button', { name: 'Solo subBass', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await startAt(page, 8);
  expect(await revisionTriggers(page)).toContain('bd');
});

test('links override persisted layout; optional storage and a dense rail remain usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/studio.html?inspect');
  await page.getByRole('button', { name: 'Theme riso', exact: true }).click();
  await page
    .getByRole('group', { name: 'Window', exact: true })
    .getByRole('button', { name: '8', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Trails', exact: true })
    .getByRole('button', { name: 'long', exact: true })
    .click();
  await page
    .locator('[data-region="stage-b"]')
    .getByRole('button', { name: 'Views', exact: true })
    .click();
  await page.getByRole('button', { name: 'Test card on Stage B', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'riso');
  await expect(page.locator('canvas')).toHaveCount(2);
  await expect(
    page
      .getByRole('group', { name: 'Window', exact: true })
      .getByRole('button', { name: '8', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page
      .getByRole('group', { name: 'Trails', exact: true })
      .getByRole('button', { name: 'long', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/studio.html?inspect&a=test-card&b=&theme=phosphor');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'phosphor');
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw Error('Denied');
      },
    }),
  );
  await page.goto('/studio.html?inspect');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'arcade');
  await page.getByRole('button', { name: 'Theme pocket', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pocket');
  await load(page, 'micro-dense-stack');
  await expect(page.locator('.instrument-row')).toHaveCount(2);
  // Twenty independently selectable leaves force 44px rows and internal scroll.
  await page.evaluate(async () => {
    await window.odmStudio.load(
      `stack(${Array.from({ length: 20 }, (_, i) => `note(${String(40 + i)}).s("sine")`).join(',')})`,
    );
  });
  await expect(page.locator('.instrument-row')).toHaveCount(20);
  await expect(page.locator('.instrument-rail')).toHaveAttribute('data-dense', 'true');
  expect((await page.locator('.instrument-row').first().boundingBox())!.height).toBe(44);
  expect(
    await page.locator('.playing-list').evaluate((list) => list.scrollHeight > list.clientHeight),
  ).toBe(true);
  await noScroll(page);
  await page.locator('.instrument-row').last().scrollIntoViewIfNeeded();
  await page.locator('.instrument-row').last().locator('.instrument-select').click();
  await expect(page.locator('.instrument-row').last()).toHaveAttribute('data-selected', 'true');
});

test('a test-only registered failure is visible, retries, and leaves the other stage drawing', async ({
  page,
  context,
}) => {
  await assets(context);
  let registered = false;
  await page.route('**/assets/studio-*.js', async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    if (body.includes('"./test-card.view.ts":')) {
      registered = true;
      body = body.replace(
        '"./test-card.view.ts":',
        '"./broken.view.ts":()=>{let attempts=0;return Promise.resolve({default:{id:"broken",name:"Broken test view",tag:"test only",mount(el){if(++attempts===1)throw Error("Deliberate mount failure");const canvas=document.createElement("canvas");el.append(canvas);return {frame(){throw Error("Deliberate drawing failure")},dispose(){canvas.remove();throw Error("Deliberate cleanup failure")}}}}})},"./test-card.view.ts":',
      );
    }
    await route.fulfill({ response, body });
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/studio.html?inspect&a=test-card&b=broken');
  await load(page);
  expect(registered).toBe(true);
  const b = page.locator('[data-region="stage-b"]');
  await expect(b.getByRole('alert')).toContainText('Deliberate mount failure');
  await expect(b.locator('canvas')).toHaveCount(0);
  await b.getByRole('button', { name: 'Retry view', exact: true }).click();
  await expect(b.getByRole('alert')).toContainText('Deliberate drawing failure');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => window.odmStudio.app.state.playing);
  const before = await pixels(page);
  await frames(page, 8);
  expect(await pixels(page)).not.toBe(before);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
});
