// Diagnostic only: safe synthetic score, deliberately outside reported timings.
import { compile } from './instrument.mjs';
import { Recorder } from './recorder.mjs';
import { createHost, core } from './host.mjs';
import vm from 'node:vm';
const source="note('c3 d3 e3 g3')"+'.gain(.5)'.repeat(63);
const compiled=compile(source), rec=new Recorder(compiled.sites,compiled.functions);
const env=createHost(rec);env.host[compiled.captureName]=rec;const ctx=vm.createContext(env.host);
await vm.runInContext(`(async()=>{${compiled.code}})()`,ctx);
for(let round=0;round<8;round++) for(const {value}of rec.objects.values()) for(let cycle=0;cycle<=8;cycle++) value.query(new core.State(new core.TimeSpan(cycle,cycle+1),{_cps:.5}));
env.restore();
