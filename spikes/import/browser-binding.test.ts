import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
it("lets author const names shadow engine exports in the browser evaluator", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "--eval",
    `
 import {registerHooks} from 'node:module';
 registerHooks({resolve(s,c,n){return s==='@kabelsalat/web'?{url:'data:text/javascript,export class SalatRepl {}',shortCircuit:true}:n(s,c)}});
 const {evaluate}=await import('./src/runtime.mjs');
 const r=await evaluate({source:'const drop=s("bd*4"); arrange([4,drop],[4,drop])',fromCycle:0,toCycle:1});
 console.log(JSON.stringify({error:r.error,count:r.events.length}));
 `,
  ]);
  const result = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
  expect(result.error).toBeNull();
  expect(result.count).toBe(4);
});
