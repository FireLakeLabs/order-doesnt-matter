import { Worker } from 'node:worker_threads';
import type { EventResult } from '../contract';

export interface NodeQueryOptions {
  timeoutMs?: number;
  eventBudget?: number;
}
/** A fresh Node 24 worker per question, including imports in the wall budget.
 * Node's native type stripping loads these TS files; the hook supplies the
 * extensionless imports and Kabelsalat's browser-only unused REPL export.
 */
export function queryEventsNode(
  source: string,
  from: number,
  to: number,
  options: NodeQueryOptions = {},
): Promise<EventResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw Error('Expected a positive finite timeoutMs');
  return new Promise((resolve) => {
    let settled = false;
    const worker = createWorker();
    worker.postMessage({ source, from, to, budget: options.eventBudget });
    const finish = (result: EventResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    const failure = (phase: 'timeout' | 'evaluation', message: string): EventResult => ({
      events: [],
      cps: 0.5,
      opaqueValues: false,
      error: { phase, message },
    });
    const timer = setTimeout(
      () => finish(failure('timeout', `${timeoutMs}ms worker budget exceeded`)),
      timeoutMs,
    );
    worker.once('message', finish);
    worker.once('error', (error) => finish(failure('evaluation', error.message)));
    worker.once('exit', (code) =>
      finish(failure('evaluation', `Worker exited ${code} without a result`)),
    );
  });
}

function createWorker() {
  return new Worker(
    `
    const { registerHooks } = require('node:module');
    const { parentPort, workerData } = require('node:worker_threads');
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === '@kabelsalat/web') return { url: 'data:text/javascript,export class SalatRepl {}', shortCircuit: true };
      try { return next(specifier, context); } catch (error) {
        if (specifier.startsWith('.')) return next(specifier + '.ts', context);
        throw error;
      }
    }});
    const evaluator = import(workerData.module);
    parentPort.on('message', async ({source, from, to, budget}) => {
      const { queryEventsWithBudget } = await evaluator;
      parentPort.postMessage(await queryEventsWithBudget(source, from, to, budget));
    });
  `,
    {
      eval: true,
      workerData: { module: new URL('./evaluate.ts', import.meta.url).href },
      execArgv: [],
      stdout: true,
      stderr: true,
    },
  );
}

/** For trusted score proofs only: retain Strudel imports between questions.
 * No result cache: every call evaluates independently. Each slot processes one
 * question at a time; evaluate.ts restores Strudel registries after each query.
 * Budgets start on dispatch (including cold import), excluding queue time.
 * A failed/timed-out worker is discarded. Production callers retain fresh workers.
 */
export function createNodeQueryPool(size = 2) {
  if (!Number.isInteger(size) || size < 1) throw Error('Expected a positive pool size');
  type Job = {
    source: string;
    from: number;
    to: number;
    options: NodeQueryOptions;
    resolve(result: EventResult): void;
  };
  const queue: Job[] = [];
  const slots = Array.from({ length: size }, () => ({
    worker: null as Worker | null,
    busy: false,
    cancel: () => {},
  }));
  let closed = false;
  const failure = (phase: 'timeout' | 'evaluation', message: string): EventResult => ({
    events: [],
    cps: 0.5,
    opaqueValues: false,
    error: { phase, message },
  });
  function dispatch() {
    for (const slot of slots) {
      if (closed || slot.busy || !queue.length) continue;
      const job = queue.shift()!;
      slot.busy = true;
      const worker = (slot.worker ??= createWorker());
      const timeoutMs = job.options.timeoutMs ?? 5000;
      const finish = (result: EventResult, discard = false) => {
        if (!slot.busy) return;
        clearTimeout(timer);
        worker.removeListener('message', message);
        worker.removeListener('error', error);
        worker.removeListener('exit', exit);
        if (discard) {
          void worker.terminate();
          slot.worker = null;
        }
        slot.busy = false;
        job.resolve(result);
        dispatch();
      };
      const message = (result: EventResult) => finish(result);
      const error = (err: Error) => finish(failure('evaluation', err.message), true);
      const exit = (code: number) =>
        finish(failure('evaluation', `Worker exited ${code} without a result`), true);
      const timer = setTimeout(
        () => finish(failure('timeout', `${timeoutMs}ms worker budget exceeded`), true),
        timeoutMs,
      );
      slot.cancel = () => finish(failure('evaluation', 'Pool closed'), true);
      worker.once('message', message);
      worker.once('error', error);
      worker.once('exit', exit);
      worker.postMessage({
        source: job.source,
        from: job.from,
        to: job.to,
        budget: job.options.eventBudget,
      });
    }
  }
  return {
    query(
      source: string,
      from: number,
      to: number,
      options: NodeQueryOptions = {},
    ): Promise<EventResult> {
      if (closed) throw Error('Pool closed');
      if (!Number.isFinite(options.timeoutMs ?? 5000) || (options.timeoutMs ?? 5000) <= 0)
        throw Error('Expected a positive finite timeoutMs');
      return new Promise((resolve) => {
        queue.push({ source, from, to, options, resolve });
        dispatch();
      });
    },
    async close() {
      closed = true;
      for (const job of queue.splice(0)) job.resolve(failure('evaluation', 'Pool closed'));
      await Promise.all(
        slots.map(async (slot) => {
          const worker = slot.worker;
          if (slot.busy) slot.cancel();
          if (worker) await worker.terminate();
          slot.worker = null;
        }),
      );
    },
  };
}
