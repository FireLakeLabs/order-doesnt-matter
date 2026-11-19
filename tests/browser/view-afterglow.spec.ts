import { expect, test } from '@playwright/test';
import { viewSmoke } from './view-smoke';
viewSmoke(test, 'afterglow');

// Read the actual Studio-mounted definition; keep the assertion on rendered pixels.
test('Afterglow scored outlines have an opaque separator over every heat level and theme', async ({
  page,
  context,
}) => {
  await context.route('https://raw.githubusercontent.com/**', (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route('**/assets/afterglow.view-*.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const name = body.match(/export\{([\w$]+) as default\}/)?.[1];
    if (!name) throw Error('Afterglow definition missing');
    await route.fulfill({
      response,
      body:
        body +
        `
      const originalMount = ${name}.mount;
      ${name}.mount = element => {
        const handle = originalMount(element);
        window.outlineProbe = { handle, element };
        return { dispose() { handle.dispose(); }, frame(f) { window.outlineProbe.frame = f; if (!window.outlineProbe.frozen) handle.frame(f); } };
      };
    `,
    });
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?a=afterglow');
  await page.waitForFunction(
    () =>
      !!(window as unknown as { outlineProbe?: { frame?: { instruments: unknown[] } } })
        .outlineProbe?.frame?.instruments.length,
  );
  for (const theme of ['arcade', 'sunset', 'phosphor', 'riso', 'pocket']) {
    await page.getByRole('button', { name: `Theme ${theme}`, exact: true }).click();
    await page.waitForFunction(
      (theme) =>
        (window as unknown as { outlineProbe: { frame: { theme: { name: string } } } }).outlineProbe
          .frame.theme.name === theme,
      theme,
    );
    const pixels = await page.evaluate(() => {
      const probe = (
        window as unknown as {
          outlineProbe: {
            frame: import('../../src/views/types').ViewFrame;
            handle: import('../../src/views/types').ViewHandle;
            element: HTMLElement;
            frozen: boolean;
          };
        }
      ).outlineProbe;
      probe.frozen = true;
      const f = probe.frame;
      const instrument = f.instruments[0];
      const position = Math.log(440 / 20) / Math.log(1000);
      // Put the 440 Hz outline exactly at y=200, so the separator occupies
      // a complete pixel row. A subpixel keyline leaves this row blended.
      const height = 118 + (203 - 86 * position) / (1 - position);
      const spectrum = new Uint8Array(4096);
      const base = {
        ...f,
        width: 800,
        height,
        dpr: 1,
        lookAhead: 4,
        instruments: [instrument],
        notes: [
          { instrument: instrument.id, start: 0, end: 2, hasOnset: true, value: { note: 69 } },
        ],
        audio: { wave: new Float32Array(4800), spectrum },
      };
      const canvas = probe.element.querySelector('canvas')!;
      const ctx = canvas.getContext('2d')!;
      const colours = [];
      for (const byte of [0, 85, 170, 255]) {
        spectrum.fill(byte);
        // Replace the prior observation pass with this heat level.
        for (let cell = 0; cell <= 64; cell++)
          probe.handle.frame({ ...base, now: cell / 64, playing: true });
        probe.handle.frame({ ...base, now: 1, playing: false });
        const x = Math.floor(58 + (2.25 / 4) * (800 - 18 - 58));
        colours.push(Array.from(ctx.getImageData(x, 198, 1, 1).data));
      }
      const ground = f.theme.ground.match(/\w\w/g)!.map((v) => parseInt(v, 16));
      return { colours, ground };
    });
    for (const colour of pixels.colours) expect(colour).toEqual([...pixels.ground, 255]);
  }
});
