import type { EventResult, QueryEvents } from '../contract';

export const QUERY_BUDGET_MS = 5_000;
export interface Question {
  code: string;
  from: number;
  to: number;
  playbackStarts?: number[];
  initialCps?: number;
}
export interface QuestionWorker {
  postMessage(value: Question): void;
  terminate(): void;
  onmessage: ((event: { data: EventResult }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
}
const failure = (phase: 'timeout' | 'evaluation', message: string): EventResult => ({
  events: [],
  cps: 0.5,
  opaqueValues: false,
  error: { phase, message },
});
/** Fresh workers isolate Pattern prototypes from audio and from earlier questions.
 * The wall budget includes worker startup. Queued jobs have not begun evaluation.
 * Cancellation settles promises, terminates running workers and clears the queue.
 */
export function createBrowserQueries(
  factory: () => QuestionWorker = () =>
    new Worker(new URL('./evaluate-browser.worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as QuestionWorker,
  { size = 2, budgetMs = QUERY_BUDGET_MS } = {},
): {
  query: QueryEvents;
  preflight(
    code: string,
    from: number,
    starts: number[],
    initialCps?: number,
  ): Promise<EventResult>;
  cancel(): void;
} {
  if (!Number.isInteger(size) || size < 1 || !Number.isFinite(budgetMs) || budgetMs <= 0)
    throw Error('Expected positive worker pool size and budget');
  interface Job extends Question {
    resolve(result: EventResult): void;
  }
  const queue: Job[] = [],
    active = new Set<(result: EventResult) => void>();
  function pump() {
    while (queue.length && active.size < size) {
      const job = queue.shift()!;
      let worker: QuestionWorker | undefined;
      const finish = (result: EventResult) => {
        if (!active.delete(finish)) return;
        clearTimeout(timer);
        worker?.terminate();
        job.resolve(result);
        pump();
      };
      active.add(finish);
      const timer = setTimeout(
        () => finish(failure('timeout', `Question timed out after ${budgetMs / 1000} seconds`)),
        budgetMs,
      );
      try {
        worker = factory();
        worker.onmessage = (event) => finish(event.data);
        worker.onerror = (event) => finish(failure('evaluation', event.message));
        worker.postMessage({
          code: job.code,
          from: job.from,
          to: job.to,
          playbackStarts: job.playbackStarts,
          initialCps: job.initialCps,
        });
      } catch (error) {
        finish(failure('evaluation', error instanceof Error ? error.message : String(error)));
      }
    }
  }
  return {
    preflight: (code, from, starts, initialCps) =>
      new Promise((resolve) => {
        queue.push({ code, from, to: from + 16, playbackStarts: starts, initialCps, resolve });
        pump();
      }),
    query: (code, from, to) =>
      new Promise((resolve) => {
        queue.push({ code, from, to, resolve });
        pump();
      }),
    cancel() {
      const result = failure('evaluation', 'Question cancelled by a newer request');
      for (const job of queue.splice(0)) job.resolve(result);
      for (const finish of [...active]) finish(result);
    },
  };
}
