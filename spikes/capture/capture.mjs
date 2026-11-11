import { run } from './runner.mjs';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const dirs = process.argv.slice(2).filter(x=>!x.startsWith('--'));
if (!dirs.length) dirs.push(path.join(here,'seeds'));
const output = path.join(here, 'results'); await mkdir(output, { recursive:true });

const report = { generatedAt:new Date().toISOString(), node:process.version, cycles:[0,8], limits:{ queryMs:80, stationsMs:1200, eventCount:50000, instanceRetentionPerSite:8 }, inputs:[], programs:[] };
for(const dir of dirs) {
  let names;
  try { names=(await readdir(dir)).filter(n=>n.endsWith('.strudel')).sort(); }
  catch(e) { report.inputs.push({directory:path.resolve(dir),error:String(e),files:0}); continue; }
  report.inputs.push({directory:path.resolve(dir),files:names.length});
  let metadata = [];
  try { metadata = JSON.parse(await readFile(path.join(dir,'../index.json'),'utf8')); } catch {}
  const tagsByName = new Map(metadata.map(row=>[path.basename(row.file), row.tags || []]));
  for(const name of names) {
    const source = await readFile(path.join(dir,name),'utf8');
    const tags = [...new Set([...(source.match(/\b[GSEQACT]\d+\b/g)||[]), ...(tagsByName.get(name)||[])])];
    const result = await run(source);
    const file = path.basename(dir)+'--'+name.replace(/\.strudel$/,'.json');
    await writeFile(path.join(output,file),JSON.stringify({file:path.join(dir,name),tags,source,sites:result.ast?.sites||[],roots:result.ast?.roots||[],callbacks:result.ast?.callbacks||[],...result},null,2));
    const median = xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
    const counts = mode => {
      const sites=result[mode]?.sites.filter(s=>s.siteType==='call')||[];
      return {sites:sites.length, pattern:sites.filter(s=>s.executed&&s.kind==='pattern').length, value:sites.filter(s=>s.executed&&s.kind==='value').length,function:sites.filter(s=>s.executed&&s.kind==='function').length,error:sites.filter(s=>s.executed&&s.kind==='error').length,never:sites.filter(s=>!s.executed).length,queryable:sites.filter(s=>s.executed&&s.kind==='pattern'&&s.instances.some(i=>i.eventsPerCycle?.length===9&&!i.flags.queryError&&!i.flags.budgetExceeded)).length,queryError:sites.filter(s=>s.flags.queryError).length,budgetExceeded:sites.filter(s=>s.flags.budgetExceeded).length,continuous:sites.filter(s=>s.flags.hasContinuous).length,fragments:sites.filter(s=>s.flags.hasFragments).length};
    };
    const summary={file:name,inputDirectory:dir,tags,resultFile:file,fatal:result.fatal,counts:counts('ast'),comparison:result.comparison,evalError:result.ast?.evalError,stationMs:result.ast?.stationsMs,runtimeStationMs:result.runtime?.stationsMs,runtimeCalls:result.runtime?.runtimeCount,runtimeMethods:result.runtime?.sites.length,callbackCounts:result.ast?.callbacks.map(f=>({callee:f.callee,construction:f.construction,query:f.query,other:f.other,queryOwners:f.queryOwners,id:f.id,totalInstances:f.totalInstances})),evalMedianMs:result.timings&&Object.fromEntries(Object.entries(result.timings).map(([k,v])=>[k,median(v)])),compileMs:{baseline:result.baseline?.compileMs,ast:result.ast?.compileMs}};
    report.programs.push(summary);
    console.log(name, result.fatal || `${summary.counts.pattern}/${summary.counts.sites} pattern sites; equality=${result.comparison.astEqualsBaseline}; ${Math.round(summary.stationMs)}ms stations`);
  }
}
const byTag={};
for(const p of report.programs) for(const tag of p.tags) {const row=byTag[tag] ||= {programs:0};row.programs++;for(const[k,v]of Object.entries(p.counts))row[k]=(row[k]||0)+v;}
report.byTag=byTag;
await writeFile(path.join(output,'aggregate.json'),JSON.stringify(report,null,2));
console.log(`Wrote ${report.programs.length} programs to ${output}`);
