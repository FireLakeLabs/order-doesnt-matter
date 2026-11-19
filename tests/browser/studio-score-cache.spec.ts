import { revealView } from './shelf';
import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { ViewDefinition, ViewFrame } from '../../src/views/types';
import { neededRange } from '../../src/studio/frame';

declare global {
  interface Window {
    scoreCacheQuestions: { sent: number; pending: number };
    scoreRangeProbe: {
      frames: {
        id: string;
        span: ViewDefinition['span'];
        frame: Pick<ViewFrame, 'from' | 'to' | 'now' | 'lookAhead' | 'sections'>;
        ready: boolean;
      }[];
      live: number;
      mounts: number;
      disposals: number;
      hold: boolean;
      replies: (() => void)[];
    };
  }
}

test('switching between whole-song drawings reuses the stage score', async ({ page }) => {
  await page.addInitScript(() => {
    window.scoreCacheQuestions = { sent: 0, pending: 0 };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private busy = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', () => {
          this.finished();
        });
      }
      private finished() {
        if (this.busy) window.scoreCacheQuestions.pending--;
        this.busy = false;
      }
      override postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        window.scoreCacheQuestions.sent++;
        window.scoreCacheQuestions.pending++;
        this.busy = true;
        Reflect.apply(
          NativeWorker.prototype.postMessage,
          this,
          options === undefined ? [message] : [message, options],
        );
      }
      override terminate() {
        this.finished();
        super.terminate();
      }
    };
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?inspect&a=&b=');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  await page.evaluate(() => window.odmStudio.load('stack(s("bd"), s("sd"))'));
  const ready = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-region="stage-a"] .view-host')
          ?.getAttribute('data-score-ready') === 'true' &&
        document.querySelector('[data-region="stage-a"] .view-status')?.textContent === '' &&
        window.scoreCacheQuestions.pending === 0,
    );
  const stage = page.locator('[data-region="stage-a"]');
  await stage.getByRole('button', { name: 'Views', exact: true }).click();
  await revealView(stage.locator('[data-view="loom"] .view-choice'));
  await stage.locator('[data-view="loom"] .view-choice').click();
  await stage.getByRole('heading', { name: 'Loom', exact: true }).waitFor();
  await ready();
  const before = await page.evaluate(() => window.scoreCacheQuestions.sent);
  await stage.getByRole('button', { name: 'Views', exact: true }).click();
  await revealView(stage.locator('[data-view="band"] .view-choice'));
  await stage.locator('[data-view="band"] .view-choice').click();
  await stage.getByRole('heading', { name: 'The band', exact: true }).waitFor();
  await ready();
  expect(await page.evaluate(() => window.scoreCacheQuestions.sent)).toBe(before);
});

test('rapid window and song switches never present a non-covering score as ready', async ({
  page,
}) => {
  const ids = ['piano-roll', 'graphic-score', 'staff', 'stacker'];
  await page.addInitScript(() => {
    window.scoreRangeProbe = {
      frames: [],
      live: 0,
      mounts: 0,
      disposals: 0,
      hold: false,
      replies: [],
    };
    // Hold real worker answers for the first switch, so the pending state is
    // exercised even on a fast machine. No score data or renderer is replaced.
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event) => {
          if (!window.scoreRangeProbe.hold) return;
          event.stopImmediatePropagation();
          window.scoreRangeProbe.replies.push(() => {
            this.dispatchEvent(new MessageEvent('message', { data: event.data }));
          });
        });
      }
    };
  });
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('/?inspect&a=&b=&theme=arcade');
  await page.waitForFunction(() => window.odmStudio.app.canPlay);
  await page.evaluate(
    (source) => window.odmStudio.load(source),
    await readFile('corpus/programs/real-dubstep-arranged.strudel', 'utf8'),
  );
  const shelf = page.locator('.wide-shelf');
  for (const id of ids) await revealView(shelf.locator(`[data-view="${id}"] .view-choice`));
  // Shelf discovery loads the definitions. Instrument those same definitions,
  // including Rollup's namespace facade for Staff, before the first mount.
  await page.evaluate(async (ids) => {
    for (const id of ids) {
      const url = performance
        .getEntriesByType('resource')
        .find((entry) => entry.name.includes(`/assets/${id}.view-`))?.name;
      if (!url) throw Error(`Missing ${id} module`);
      const module: Record<string, unknown> = await import(url);
      const definition = Object.values(module)
        .flatMap((value) =>
          value && typeof value === 'object'
            ? [value, 'default' in value ? value.default : undefined]
            : [],
        )
        .find(
          (value) => value && typeof value === 'object' && 'id' in value && value.id === id,
        ) as ViewDefinition;
      if (!definition) throw Error(`Missing ${id} definition`);
      const mount = definition.mount;
      definition.mount = async (element) => {
        const handle = await mount(element);
        const probe = window.scoreRangeProbe;
        probe.live++;
        probe.mounts++;
        return {
          frame(frame) {
            probe.frames.push({
              id,
              span: definition.span,
              frame: {
                from: frame.from,
                to: frame.to,
                now: frame.now,
                lookAhead: frame.lookAhead,
                sections: frame.sections,
              },
              ready: element.closest<HTMLElement>('.view-host')?.dataset.scoreReady === 'true',
            });
            handle.frame(frame);
          },
          dispose() {
            probe.live--;
            probe.disposals++;
            handle.dispose();
          },
        };
      };
    }
    await window.odmStudio.seek(10.4);
  }, ids);
  const stage = page.locator('[data-region="stage-a"]');
  const choose = async (id: string) => {
    await shelf.locator(`[data-view="${id}"] .view-choice`).click();
  };
  const ready = async (id: string) => {
    await page.waitForFunction((id) => {
      const last = window.scoreRangeProbe.frames.at(-1);
      return last?.id === id && last.ready && last.frame.now === 10.4;
    }, id);
  };
  await choose('piano-roll');
  await ready('piano-roll');
  await page.evaluate(() => {
    window.scoreRangeProbe.hold = true;
  });
  await choose('graphic-score');
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
  const pending = {
    ready: await stage.locator('.view-host').getAttribute('data-score-ready'),
    status: await stage.locator('.view-status').textContent(),
    frames: await page.evaluate(
      () => window.scoreRangeProbe.frames.filter((sample) => sample.id === 'graphic-score').length,
    ),
  };
  const evidence = process.env.ODM_SCORE_RANGE_EVIDENCE;
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/graphic-score-pending.png` });
  }
  await page.evaluate(() => {
    const probe = window.scoreRangeProbe;
    probe.hold = false;
    for (const reply of probe.replies.splice(0)) reply();
  });
  await ready('graphic-score');
  // Load Staff's async engraving engine once before the rapid-switch sequence.
  await choose('staff');
  await ready('staff');
  await choose('stacker');
  await ready('stacker');
  await page.evaluate(async (ids) => {
    const switches = [
      ...Array.from({ length: 10 }, (_, i) => ids[i % 2]),
      ...Array.from({ length: 11 }, (_, i) => ids[2 + (i % 2)]),
    ];
    for (const id of switches) {
      document
        .querySelector<HTMLButtonElement>(`.wide-shelf [data-view="${id}"] .view-choice`)!
        .click();
      for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
    }
  }, ids);
  await ready('staff');
  const measured = await page.evaluate(() => {
    const { frames, live, mounts, disposals } = window.scoreRangeProbe;
    return { frames, live, mounts, disposals };
  });
  const failures = measured.frames.flatMap(({ id, span, frame, ready }) => {
    const requested = neededRange(
      span,
      frame.now,
      frame.lookAhead,
      frame.sections.map((section) => ({
        id: section.name,
        name: section.name,
        nameSource: 'author',
        instrumentIds: [],
        start: section.from,
        cycles: section.to - section.from,
      })),
    );
    return frame.from <= requested.from && frame.to >= requested.to
      ? []
      : [{ id, ready, from: frame.from, to: frame.to, requested }];
  });
  const summary = {
    frames: measured.frames.length,
    nonCovering: failures.length,
    readyNonCovering: failures.filter((frame) => frame.ready).length,
    live: measured.live,
    mounts: measured.mounts,
    disposals: measured.disposals,
    pending,
    failures,
  };
  console.log('Rapid score range probe:', JSON.stringify(summary));
  if (evidence) {
    await writeFile(`${evidence}/probe.json`, JSON.stringify(summary, null, 2));
    await page.screenshot({ path: `${evidence}/rapid-switch-final.png` });
  }
  expect(pending).toEqual({ ready: 'false', status: 'Asking the score…', frames: 0 });
  expect(failures).toEqual([]);
  expect(measured.live).toBe(1);
  expect(measured.mounts - measured.disposals).toBe(1);
  await expect(stage.locator('.view-owned')).toHaveCount(1);
  await expect(stage.locator('canvas')).toHaveCount(1);
  await page.unrouteAll({ behavior: 'wait' });
});
