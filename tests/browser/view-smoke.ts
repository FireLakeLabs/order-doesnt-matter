import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

// Register a view's complete CI browser check with viewSmoke(test, 'loom').
// Pass Playwright's test and the registry id; this covers Canvas 2D and WebGL.
// Extended checks and measurements belong to npm run measure:views, outside CI.
export function viewSmoke(test: typeof import('@playwright/test').test, id: string) {
  test(`${id}: shared Studio smoke`, async ({ page, context }, testInfo) => {
    const errors: string[] = [];
    const consoleOutput: string[] = [];
    page.on('console', (message) => consoleOutput.push(`[${message.type()}] ${message.text()}`));
    if (id === 'ring') {
      await page.route('**/assets/ring.view-*.js', async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        const name = body.match(/export\{([\w$]+) as default\}/)?.[1];
        if (!name) throw Error('Ring diagnostic: missing built definition');
        await route.fulfill({
          response,
          body:
            body +
            `
          window.ringSmokeDiagnostic = [];
          const diagnosticMount = ${name}.mount;
          ${name}.mount = function(element) {
            const diagnostic = {started:performance.now(),resolved:false,frames:0,returned:0,element};
            window.ringSmokeDiagnostic.push(diagnostic);
            const result = diagnosticMount(element);
            result.then(handle => {
              diagnostic.resolved = true;
              diagnostic.resolvedAt = performance.now();
              diagnostic.handle = handle;
              const frame = handle.frame;
              handle.frame = function(value) {
                diagnostic.frames++;
                diagnostic.latest = value;
                frame.call(handle,value);
                diagnostic.returned++;
              };
            });
            return result;
          };
        `,
        });
      });
    }
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    // Keep asset delivery local; the real controller, score queries and playback run.
    await context.route('https://raw.githubusercontent.com/**', (route) => {
      const bank: Record<string, unknown> = {
        _base: 'https://raw.githubusercontent.com/view-smoke-sounds/',
      };
      for (const sound of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
        bank[sound] = ['burst.wav', 'burst.wav', 'burst.wav'];
      return route.fulfill({ json: bank });
    });
    await context.route('**/view-smoke-sounds/burst.wav', (route) =>
      route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
    );
    await page.setViewportSize({ width: 1920, height: 1080 });
    const stage = page.locator('[data-region="stage-a"]');
    const canvas = stage.locator('canvas');
    const ready = () =>
      page.waitForFunction(
        () =>
          document
            .querySelector('[data-region="stage-a"] .view-host')
            ?.getAttribute('data-score-ready') === 'true' &&
          document.querySelector('[data-region="stage-a"] .view-status')?.textContent === '',
        undefined,
        { timeout: 0 },
      );
    const choose = async (view: string) => {
      await stage.getByRole('button', { name: 'Views', exact: true }).click();
      await stage.locator(`.shelf-popover [data-view="${view}"] .view-choice`).click();
      await ready();
      await expect(canvas).toHaveCount(1);
    };
    await page.goto(`/studio.html?a=${encodeURIComponent(id)}`);
    await page.getByRole('button', { name: 'Paste', exact: true }).click();
    await page
      .getByLabel('Strudel program')
      .fill(await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'));
    await page.getByRole('button', { name: 'Import program', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 0 });
    await ready();
    await expect(canvas).toHaveCount(1);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor({ timeout: 0 });
    const state = async () =>
      page.evaluate<string>(`JSON.stringify({
      mounts: (window.ringSmokeDiagnostic || []).map(d => ({
        started:d.started,resolved:d.resolved,resolvedAt:d.resolvedAt,
        connected:d.element.isConnected,frames:d.frames,returned:d.returned,
        now:d.latest?.now,notes:d.latest?.notes.length,
        width:d.latest?.width,height:d.latest?.height,
      })),
      ready:document.querySelector('[data-region="stage-a"] .view-host')?.dataset.scoreReady,
      resources:performance.getEntriesByType('resource').filter(r=>/three|ring.view|Pass-|EffectComposer/.test(r.name)).map(r=>({name:r.name,end:r.responseEnd})),
      time:performance.now(),
    })`);
    const beforeState = id === 'ring' ? await state() : '';
    const before = await canvas.screenshot();
    let latest = before;
    try {
      await expect
        .poll(async () => {
          latest = await canvas.screenshot();
          return latest.equals(before);
        })
        .toBe(false);
    } finally {
      if (id === 'ring') {
        await testInfo.attach('ring-before.png', { body: before, contentType: 'image/png' });
        await testInfo.attach('ring-compared.png', { body: latest, contentType: 'image/png' });
        await testInfo.attach('ring-state-before.json', {
          body: beforeState,
          contentType: 'application/json',
        });
        await testInfo.attach('ring-state-after.json', {
          body: await state(),
          contentType: 'application/json',
        });
        const box = await canvas.boundingBox();
        if (box)
          await testInfo.attach('ring-page-clipped.png', {
            body: await page.screenshot({ clip: box }),
            contentType: 'image/png',
          });
        const gpu = await canvas.evaluate((canvas: HTMLCanvasElement) => {
          const gl = canvas.getContext('webgl2');
          const ext = gl?.getExtension('WEBGL_debug_renderer_info');
          return {
            width: canvas.width,
            height: canvas.height,
            css: canvas.getBoundingClientRect().toJSON(),
            lost: gl?.isContextLost(),
            attributes: gl?.getContextAttributes(),
            renderer: ext ? (gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL) as unknown) : null,
            error: gl?.getError(),
            floatBuffer: !!gl?.getExtension('EXT_color_buffer_float'),
          };
        });
        await testInfo.attach('ring-gpu.json', {
          body: JSON.stringify(gpu),
          contentType: 'application/json',
        });
        const immediate = await page.evaluate<string>(`(() => {
          const d = window.ringSmokeDiagnostic.findLast(d => d.element.isConnected && d.latest);
          d.handle.frame({...d.latest,now:d.latest.now+0.001});
          const canvas = d.element.querySelector('canvas');
          const copy = document.createElement('canvas');
          copy.width=canvas.width;copy.height=canvas.height;
          copy.getContext('2d').drawImage(canvas,0,0);
          return copy.toDataURL();
        })()`);
        await testInfo.attach('ring-immediate-buffer.png', {
          body: Buffer.from(immediate.split(',')[1], 'base64'),
          contentType: 'image/png',
        });
        await testInfo.attach('ring-console.txt', {
          body: consoleOutput.join('\n') + '\nPAGE ERRORS\n' + errors.join('\n'),
          contentType: 'text/plain',
        });
      }
    }
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor({ timeout: 0 });
    await choose('test-card');
    await choose(id);
    await page.getByRole('button', { name: 'Theme riso', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'riso');
    // Wait for the new theme to be presented before checking draw errors.
    await canvas.screenshot();
    await ready();
    expect(errors).toEqual([]);
  });
}
