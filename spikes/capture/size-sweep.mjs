import { run } from './runner.mjs';
import { writeFile } from 'node:fs/promises';
const results=[];
for(const size of [4, 8, 16, 32, 64]) {
  // Fixed 4 events/cycle; adding stations alone increases depth and all-station work.
  const source="note('c3 d3 e3 g3')"+'.gain(0.5)'.repeat(size-1);
  const samples=[];
  for(let repeat=0;repeat<5;repeat++) {
    const r=await run(source);
    const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
    samples.push(r.fatal?{fatal:r.fatal}:{baselineEvalMs:median(r.timings.baseline),astEvalMs:median(r.timings.ast),runtimeEvalMs:median(r.timings.runtime),compileMs:r.ast.compileMs,stationsMs:r.ast.stationsMs,runtimeStationsMs:r.runtime.stationsMs,events:r.ast.stationEvents,budgetSites:r.ast.sites.filter(s=>s.flags.budgetExceeded).length,equal:r.comparison.astEqualsBaseline,fullyChecked:r.comparison.fullyChecked});
  }
  results.push({sites:size,source,samples});console.log(size,samples.map(s=>Math.round(s.stationsMs)));
}
await writeFile(new URL('./results/size-sweep.json',import.meta.url),JSON.stringify(results,null,2));
