import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { appSignal } from './helpers';
import type { ViewDefinition, ViewFrame } from '../../src/views/types';

// Capture before on origin/main, then after on this branch with the identical saved frames.
const root = process.env.ODM_STEP0_DIR ?? '/tmp/odm-step0';
const phase = process.env.ODM_STEP0_PHASE ?? 'before';
for (const id of [
  'band',
  'coil',
  'constellation',
  'loom',
  'night-drive',
  'piano-roll',
  'punchcard',
  'rain',
  'ridges',
  'ring',
  'runner',
  'scope',
  'test-card',
  'tracker',
  'tunnel',
]) {
  test(`${id}: fixed Step 0 comparison`, async ({ page, context }) => {
    await context.route('https://raw.githubusercontent.com/**', (route) =>
      route.fulfill({
        json: {
          _base: 'https://raw.githubusercontent.com/step0/',
          bd: ['burst.wav'],
          sd: ['burst.wav'],
          hh: ['burst.wav'],
          oh: ['burst.wav'],
          cp: ['burst.wav'],
          ade: ['burst.wav'],
          speech: ['burst.wav'],
        },
      }),
    );
    await context.route('**/step0/burst.wav', (route) =>
      route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
    );
    await page.route(`**/assets/${id}.view-*.js`, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const name = body.match(/export\{([\w$]+) as default[,}]/)?.[1];
      if (!name) throw Error('No view export');
      await route.fulfill({
        response,
        body:
          body +
          `;window.step0Definition=${name};const originalMount=${name}.mount;${name}.mount=async el=>{const h=await originalMount(el);return {frame(f){window.step0Frame=f;h.frame(f)},dispose(){h.dispose()}}};`,
      });
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/?inspect&a=${id}&b=&theme=arcade`);
    await appSignal(page, () => window.odmStudio.app.canPlay);
    await page.evaluate(
      (source) => window.odmStudio.load(source),
      await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
    );
    await page.evaluate(() => window.odmStudio.seek(10.4));
    await appSignal(
      page,
      () =>
        !!window.step0Frame?.notes.length &&
        window.step0Frame.now === 10.4 &&
        document
          .querySelector('[data-region="stage-a"] .view-host')
          ?.getAttribute('data-score-ready') === 'true',
    );
    await mkdir(`${root}/${phase}`, { recursive: true });
    let frame: ViewFrame;
    if (phase === 'before') {
      frame = await page.evaluate(() => ({
        ...window.step0Frame!,
        now: 10.4,
        width: 1300,
        height: 760,
        dpr: 1,
        lookAhead: 6,
      }));
      await writeFile(`${root}/before/${id}.json`, JSON.stringify(frame));
    } else frame = JSON.parse(await readFile(`${root}/before/${id}.json`, 'utf8')) as ViewFrame;
    await page.evaluate(async (frame) => {
      await document.fonts.ready;
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;width:1300px;height:760px;z-index:9999';
      document.body.append(el);
      const handle = await window.step0Definition.mount(el);
      handle.frame(frame);
    }, frame);
    const picture = await page.screenshot({
      path: `${root}/${phase}/${id}.png`,
      clip: { x: 0, y: 0, width: 1300, height: 760 },
    });

    if (phase === 'after') {
      const before = await readFile(`${root}/before/${id}.png`);
      const differentPixels = await page.evaluate(
        async ({ before, after }) => {
          const decode = async (data: string) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + data;
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            return ctx.getImageData(0, 0, img.width, img.height).data;
          };
          const a = await decode(before),
            b = await decode(after);
          let count = 0;
          for (let i = 0; i < a.length; i += 4)
            if (
              a[i] !== b[i] ||
              a[i + 1] !== b[i + 1] ||
              a[i + 2] !== b[i + 2] ||
              a[i + 3] !== b[i + 3]
            )
              count++;
          return count;
        },
        { before: before.toString('base64'), after: picture.toString('base64') },
      );
      await writeFile(
        `${root}/after/${id}-pixels.json`,
        JSON.stringify({ view: id, differentPixels, totalPixels: 1300 * 760 }),
      );
      expect(differentPixels).toBe(0);
    }
    expect(frame.notes.length).toBeGreaterThan(0);
  });
}
declare global {
  interface Window {
    step0Definition: ViewDefinition;
    step0Frame?: ViewFrame;
  }
}
