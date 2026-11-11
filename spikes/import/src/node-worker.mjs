import { registerHooks } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@kabelsalat/web")
      return {
        url: "data:text/javascript,export class SalatRepl {}",
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { evaluate } = await import("./runtime.mjs");
const run = async (code, scope) =>
  vm.runInContext(`(async()=>{${code}\n})()`, vm.createContext(scope), {
    timeout: 500,
  });
const query = (pattern, state) =>
  vm.runInNewContext(
    "pattern.query(state)",
    { pattern, state },
    { timeout: 250 },
  );
parentPort.postMessage(await evaluate(workerData, run, query));
