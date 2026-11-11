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
    const worker = new Worker(
      `
      const { registerHooks } = require('node:module');
      const { parentPort, workerData } = require('node:worker_threads');
      parentPort.on('message', () => {});
      registerHooks({ resolve(specifier, context, next) {
        if (specifier === '@kabelsalat/web') return { url: 'data:text/javascript,export class SalatRepl {}', shortCircuit: true };
        try { return next(specifier, context); } catch (error) {
          if (specifier.startsWith('.')) return next(specifier + '.ts', context);
          throw error;
        }
      }});
      import(workerData.module).then(async ({queryEventsWithBudget}) => {
        parentPort.postMessage(await queryEventsWithBudget(workerData.source,workerData.from,workerData.to,workerData.budget));
      }).catch(error => { throw error; });
    `,
      {
        eval: true,
        workerData: {
          module: new URL('./evaluate.ts', import.meta.url).href,
          source,
          from,
          to,
          budget: options.eventBudget,
        },
        execArgv: [],
        stdout: true,
        stderr: true,
      },
    );
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
