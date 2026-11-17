import { revealView } from './shelf';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { ViewDefinition, ViewFrame } from '../../src/views/types';
import type {} from '../../src/studio/main';

declare global {
  interface Window {
    scopeMeasure: { frame?: ViewFrame; costs: number[]; definition: ViewDefinition };
  }
}

test('Scope: real output, two-stage screenshots and 300-frame CPU measurement', async ({
  page,
  context,
}) => {
  await context.route('https://raw.githubusercontent.com/**', (route) => {
    const bank: Record<string, unknown> = {
      _base: 'https://raw.githubusercontent.com/scope-measure-sounds/',
    };
    for (const sound of ['ade', 'speech', 'bd', 'sd', 'hh', 'oh', 'cp'])
      bank[sound] = ['burst.wav', 'burst.wav', 'burst.wav'];
    return route.fulfill({ json: bank });
  });
  await context.route('**/scope-measure-sounds/burst.wav', (route) =>
    route.fulfill({ path: 'tests/fixtures/sounds/burst.wav', contentType: 'audio/wav' }),
  );
  await page.route('**/assets/scope.view-*.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const name = body.match(/export\{([\w$]+) as default\}/)?.[1];
    if (!name) throw Error('Scope module has no default definition');
    await route.fulfill({
      response,
      body:
        body +
        `
      window.scopeMeasure = { costs: [], definition: ${name} };
      const mountScopeMeasure = ${name}.mount;
      ${name}.mount = (element) => {
        const handle = mountScopeMeasure(element);
        return {
          frame(frame) {
            window.scopeMeasure.frame = frame;
            const start = performance.now();
            handle.frame(frame);
            if (window.scopeMeasure.costs.length < 320)
              window.scopeMeasure.costs.push(performance.now() - start);
          },
          dispose() { handle.dispose(); }
        };
      };
    `,
    });
  });
  const dir = `${process.env.ODM_VIEW_MEASURE_DIR}/scope`;
  await mkdir(dir, { recursive: true });
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('/studio.html?inspect&a=scope&b=ring&theme=arcade');
  await page.waitForFunction(
    () => window.odmStudio.app.canPlay && !!window.scopeMeasure?.frame,
    undefined,
    { timeout: 0 },
  );
  await page.screenshot({ path: `${dir}/no-signal-2560x1440.png` });
  await page.evaluate(
    (source) => window.odmStudio.load(source),
    await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
  );
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const measured = async () => {
    const handle = await page.waitForFunction(
      () => {
        const wave = window.scopeMeasure.frame?.audio?.wave;
        if (!wave) return false;
        const peak = Math.max(...wave) - Math.min(...wave);
        return peak > 0.01 ? peak : false;
      },
      undefined,
      { timeout: 0 },
    );
    const peak = await handle.jsonValue();
    await handle.dispose();
    return peak;
  };
  await page.waitForFunction(() => window.odmStudio.app.state.playing, undefined, { timeout: 0 });
  await page.evaluate(() => window.odmStudio.seek(10.4));
  await page.waitForFunction(() => (window.scopeMeasure.frame?.now ?? 0) >= 10.4, undefined, {
    timeout: 0,
  });
  const peakToPeak = await measured();
  for (const [width, height] of [
    [2560, 1440],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['arcade', 'phosphor']) {
      await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
      await page.waitForFunction(
        (theme) => window.scopeMeasure.frame?.theme.name === theme,
        theme,
        { timeout: 0 },
      );
      await measured();
      await page.screenshot({ path: `${dir}/${theme}-${width}x${height}.png` });
    }
  }
  // Measure actual presented frames with the arrangement running, excluding warm-up.
  await page.evaluate(() => {
    window.scopeMeasure.costs = [];
  });
  await page.waitForFunction(() => window.scopeMeasure.costs.length === 320, undefined, {
    timeout: 0,
  });
  const timing = await page.evaluate(() => {
    const costs = window.scopeMeasure.costs.slice(20).sort((a, b) => a - b);
    return {
      frames: costs.length,
      median: costs[150],
      p95: costs[285],
      max: costs.at(-1),
      width: window.scopeMeasure.frame!.width,
      height: window.scopeMeasure.frame!.height,
    };
  });
  console.log(`Scope peak-to-peak: ${peakToPeak}; CPU frame cost: ${JSON.stringify(timing)}`);
  await writeFile(`${dir}/measurements.json`, JSON.stringify({ peakToPeak, ...timing }, null, 2));
  await page.getByRole('button', { name: 'Clear Stage A', exact: true }).click();
  const stage = page.locator('[data-region="stage-b"]');
  await stage.getByRole('button', { name: 'Views', exact: true }).click();
  await revealView(
    stage.getByRole('button', { name: 'Scope on Stage B', exact: true, includeHidden: true }),
  );
  await stage
    .getByRole('button', { name: 'Scope on Stage B', exact: true, includeHidden: true })
    .click();
  await expect(stage.locator('[data-scope]')).toHaveCount(1);
  await page.waitForFunction(() => (window.scopeMeasure.frame?.width ?? 9999) < 900, undefined, {
    timeout: 0,
  });
  await measured();
  await page.screenshot({ path: `${dir}/phosphor-stage-b-1920x1080.png` });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.waitForFunction(
    () => {
      const wave = window.scopeMeasure.frame?.audio?.wave;
      return wave && wave.every((sample) => Math.abs(sample) < 0.000001);
    },
    undefined,
    { timeout: 0 },
  );
  await page.screenshot({ path: `${dir}/stopped-stage-b-1920x1080.png` });
  // A short desktop window must not send a negative radius to Canvas.arc.
  await page.evaluate(async () => {
    const element = document.createElement('div');
    const handle = await window.scopeMeasure.definition.mount(element);
    try {
      handle.frame({ ...window.scopeMeasure.frame!, width: 900, height: 100 });
    } finally {
      handle.dispose();
    }
  });
});
