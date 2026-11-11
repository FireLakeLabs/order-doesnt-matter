export interface PlainEvent {
  whole: [number, number] | null;
  part: [number, number];
  value: unknown;
  hasOnset: boolean;
  cycle: number;
}
export interface EventResult {
  events: PlainEvent[];
  error: string | null;
  phase?: "evaluation" | "query" | "timeout";
  opaqueValues?: boolean;
}
/** Fresh worker per query: user code has a 5s wall budget, no audio. */
export async function queryEvents(
  source: string,
  fromCycle: number,
  toCycle: number,
): Promise<EventResult> {
  if (
    !Number.isFinite(fromCycle) ||
    !Number.isFinite(toCycle) ||
    toCycle <= fromCycle ||
    toCycle - fromCycle > 512
  )
    return { events: [], error: "Invalid query window (maximum 512 cycles)" };
  if (typeof process !== "undefined" && process.versions?.node) {
    // Variable import keeps Node adapters out of browser dependency resolution.
    const moduleName = "node:worker_threads";
    const { Worker: NodeWorker } = (await import(
      /* @vite-ignore */ moduleName
    )) as typeof import("node:worker_threads");
    return new Promise((resolve) => {
      const worker = new NodeWorker(
        new URL("./node-worker.mjs", import.meta.url),
        {
          workerData: { source, fromCycle, toCycle },
          // A file worker cannot inherit the caller's eval/stdin-only flag.
          execArgv: process.execArgv.filter(
            (arg, i, args) =>
              !arg.startsWith("--input-type") && args[i - 1] !== "--input-type",
          ),
          stdout: true,
          stderr: true,
        },
      );
      let settled = false;
      const finish = (result: EventResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate().catch(() => {});
        resolve(result);
      };
      const timer = setTimeout(
        () =>
          finish({
            events: [],
            error: "5000ms worker budget exceeded",
            phase: "timeout",
          }),
        5000,
      );
      worker.once("message", finish);
      worker.once("error", (error) =>
        finish({ events: [], error: error.message, phase: "evaluation" }),
      );
      worker.once("exit", (code) => {
        if (!settled)
          finish({
            events: [],
            error: `Worker exited ${code}`,
            phase: "evaluation",
          });
      });
    });
  }
  return new Promise((resolve) => {
    const worker = new Worker(
      new URL("./browser-worker.mjs", import.meta.url),
      { type: "module" },
    );
    const finish = (result: EventResult) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish({
          events: [],
          error: "5000ms worker budget exceeded",
          phase: "timeout",
        }),
      5000,
    );
    worker.onmessage = (event) => finish(event.data);
    worker.onerror = (event) =>
      finish({ events: [], error: event.message, phase: "evaluation" });
    worker.postMessage({ source, fromCycle, toCycle });
  });
}
