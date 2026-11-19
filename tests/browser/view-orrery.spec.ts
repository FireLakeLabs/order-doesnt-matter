import { expect, test } from '@playwright/test';
import { viewSmoke } from './view-smoke';
viewSmoke(test, 'orrery');

test('Orrery requests structure and paints pending, measured and unknown driver states', async ({
  page,
}) => {
  const { prepare } = await import('./view-evidence');
  await prepare(page, 'orrery');
  const result = await page.evaluate(async () => {
    const frame = { ...window.viewProbe.frame!, width: 1300, height: 760, now: 10.4 };
    const bass = frame.instruments.find((i) => i.name === 'wobbleBass')!;
    const structure = frame.structure!.get(bass.id)!;
    const filter = structure.steps.find(
      (step) => step.kind === 'setting' && step.name === 'cutoff',
    )!;
    if (filter.kind !== 'setting') throw Error('Missing filter');
    const answer = await filter.driver.rates[0].events();
    let resolve!: (value: typeof answer) => void;
    const pending = new Promise<typeof answer>((done) => {
      resolve = done;
    });
    const isolated = {
      ...structure,
      steps: structure.steps.map((step) =>
        step === filter
          ? {
              ...step,
              driver: {
                ...step.driver,
                rates: [{ ...step.driver.rates[0], events: () => pending }],
              },
            }
          : step,
      ),
    };
    frame.structure = { get: (id) => (id === bass.id ? isolated : undefined) };
    const el = document.createElement('div');
    const handle = await window.viewProbe.definition.mount(el);
    const fill = CanvasRenderingContext2D.prototype.fillText;
    const texts: string[] = [];
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, max) {
      texts.push(text);
      fill.call(this, text, x, y, max);
    };
    handle.frame(frame);
    const pendingText = texts.slice();
    texts.length = 0;
    resolve(answer);
    await Promise.resolve();
    handle.frame(frame);
    const measured = texts.slice();
    texts.length = 0;
    const bad = {
      ...isolated,
      context: {
        ...isolated.context,
        uses: isolated.context.uses.map((use) => ({
          ...use,
          timing: { status: 'unavailable' as const, reason: 'Opaque timing' },
        })),
      },
    };
    handle.frame({ ...frame, structure: { get: (id) => (id === bass.id ? bad : undefined) } });
    const unknown = texts.slice();
    CanvasRenderingContext2D.prototype.fillText = fill;
    handle.dispose();
    return { opted: window.viewProbe.definition.structure, pendingText, measured, unknown };
  });
  expect(result.opted).toBe(true);
  expect(result.pendingText).toContain('pending');
  expect(result.measured).toContain('4-cycle loop · 3 now · 4 ticks');
  expect(result.unknown).toContain('unknown');
});
