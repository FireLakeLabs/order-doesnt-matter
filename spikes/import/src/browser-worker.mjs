import { evaluate } from "./runtime.mjs";
self.onmessage = async ({ data }) => {
  self.postMessage(await evaluate(data));
};
