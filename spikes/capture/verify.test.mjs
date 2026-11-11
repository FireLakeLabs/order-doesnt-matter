import './node-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
async function capture(source) {
  return new Promise((resolve,reject)=>{
    const w = new Worker(new URL('./worker.mjs',import.meta.url),{ workerData:{source}, execArgv:['--import',new URL('./node-setup.mjs',import.meta.url).href], stdout:true,stderr:true });
    const timer=setTimeout(()=>{w.terminate();reject(Error('test worker timeout'));},12000);
    w.on('error',reject);
    w.on('message',r=>{if(r.checkpoint)return;clearTimeout(timer);w.terminate();r.fatal?reject(Error(r.fatal)):resolve(r);});
  });
}
const seed = async name => readFile(new URL('./seeds/'+name,import.meta.url),'utf8');
test('member getter, arguments, this, lexical eval and optional call preserve score',async()=>{
  const r=await capture(await seed('20-javascript-semantics.strudel'));
  assert.equal(r.ast.evalError,undefined);
  assert.equal(r.comparison.astEqualsBaseline,true);
  assert.equal(r.comparison.fullyChecked,true);
  assert.equal(r.ast.sites.find(s=>s.callee==='absent?.f').executed,false);
  const notes=r.ast.finalEvents.cycles[0].events.map(e=>e.value.note);
  assert.deepEqual(notes,[64]); // C3 MIDI 48 + obj's 13 + lexical eval's 3.
  assert.equal(r.ast.sites.find(s=>s.callee.includes('unknownCaptureMethod')).kind,'error');
});
test('optional receiver/call skips getters and arguments and keeps chains and this',async()=>{
  const r=await capture(`let count=0;const absent=null;absent?.[count++]();const obj={n:2,f(x){return {p:note(x+this.n)}}};const missing={f:null};missing.f?.(count++);const p=obj?.f?.(60).p;if(count!==0)throw Error('optional evaluated');p`);
  assert.equal(r.ast.evalError,undefined); assert.equal(r.comparison.astEqualsBaseline,true);
  assert.deepEqual(r.ast.finalEvents.cycles[0].events.map(e=>e.value.note),[62]);
});
test('tree exposes source producers for receiver and two stack arguments',async()=>{
  const r=await capture(`const a=note('c3'), b=note('e3');stack(a,b).fast(2)`);
  assert.equal(r.comparison.astEqualsBaseline,true);
  const stack=r.ast.sites.find(s=>s.callee==='stack');
  assert.equal(stack.instances[0].args.length,2);
  for(const arg of stack.instances[0].args)assert.equal(arg.producers.length,1);
  const fast=r.ast.sites.find(s=>s.callee==='stack(a,b).fast');
  assert.equal(fast.instances[0].receiver.producers[0].site,stack.id);
});
test('patternified nested callbacks are query-time instances with source and context',async()=>{
  const r=await capture(await seed('04-off-pattern-nested.strudel'));
  assert.equal(r.comparison.astEqualsBaseline,true);
  assert.equal(r.ast.callbacks.length,2);
  assert.equal(r.ast.callbacks[0].ownerSite,r.ast.sites.find(s=>s.callee==="mini('0 2').off").id);
  for(const f of r.ast.callbacks){assert.equal(f.construction,0);assert.ok(f.query>1);assert.ok(f.instances.some(i=>i.queryContext?.cycle===0));}
  const add=r.ast.sites.find(s=>s.callee==='y.add');
  assert.ok(add.distinctPatternIdentities>1); assert.ok(add.instances[0].receiver.producers.some(p=>p.callback));
});
test('anonymous roots coexist, muted root is silent, all applies to merged score',async()=>{
  const r=await capture(`all(x=>x.gain(.25));$:note('c3');_$:note('f3');$:note('e3')`);
  assert.equal(r.ast.roots.filter(x=>!x.role).length,3);
  assert.deepEqual(r.ast.finalEvents.cycles[0].events.map(e=>e.value.note).sort(),['c3','e3']);
  assert.ok(r.ast.finalEvents.cycles[0].events.every(e=>e.value.gain===.25));
  assert.equal(r.comparison.astEqualsBaseline,true);
});
test('low-level query distinguishes silence from errors and stops infinite query',async()=>{
  const r=await capture(`const broken=note('c3').withValue(()=>{throw Error('boom')});stack(silence,broken)`);
  assert.match(r.ast.finalEvents.flags.queryError,/boom/);
  assert.equal(r.comparison.fullyChecked,false);
  const quiet=await capture(`silence`);assert.equal(quiet.ast.finalEvents.cycles[0].count,0);assert.equal(quiet.ast.finalEvents.flags.queryError,undefined);
  const stuck=await capture(await seed('18-nontermination.strudel'));assert.equal(stuck.ast.finalEvents.flags.budgetExceeded,true);
});
test('capturing an impure intermediate score changes future observations',async()=>{
  const r=await capture(await seed('17-impure.strudel'));
  assert.equal(r.comparison.astEqualsBaseline,true);
  assert.equal(r.comparison.astUnaffectedByStationQueries,false);
});
test('mini locations and upstream rewrites match the published transpiler',async()=>{
  const {compile}=await import('./instrument.mjs');
  const stock=await import('@strudel/transpiler');
  for(const type of ['scope','pianoroll','punchcard','spiral'])stock.registerWidgetType(type);
  const source=`samples('fake'); all(x=>x.fast(2)); $:note("c3 e3").gain(slider(.5)).scope()`;
  const plain=stock.transpiler(source), ours=compile(source,'baseline'), instrumented=compile(source,'ast');
  assert.equal(ours.code,plain.output);
  assert.deepEqual(instrumented.miniLocations,plain.miniLocations);
  assert.deepEqual(instrumented.widgets,plain.widgets);
  const shifted=compile('\n\n'+source,'ast');
  assert.deepEqual(instrumented.sites.map(s=>s.id),shifted.sites.map(s=>s.id));
  const r=await capture(source);assert.equal(r.comparison.astEqualsBaseline,true);
});
test('recorder binding does not collide with program or parameter names',async()=>{
  const r=await capture(`const __capture=7;function f(__capture_){return pure(__capture+__capture_)}f(5).note()`);
  assert.equal(r.ast.evalError,undefined);assert.equal(r.comparison.astEqualsBaseline,true);
  assert.deepEqual(r.ast.finalEvents.cycles[0].events.map(e=>e.value.note),[12]);
});
