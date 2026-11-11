import { beforeAll, expect, it } from 'vitest';
import * as core from '@strudel/core';
import { initial } from './document';
import { generate } from './generate';
import type { Hap, Pattern } from './engine';
beforeAll(async()=> { await core.evalScope(core); });
async function pattern(): Promise<Pattern> { return (await core.evaluate(generate(initial()))).pattern; }
function harness() {
  let now = 0, tick = () => {};
  const log: { begin: number; target: number; note: unknown; voice: unknown; version: number }[] = [];
  let version = 0;
  const scheduler = new core.Cyclist({ getTime: ()=>now, setInterval: (fn: ()=>void)=>{tick=fn;return 1;}, clearInterval: ()=>{}, onTrigger: (h: Hap,_deadline: number,_duration: number,_cps: number,target: number)=>{log.push({ begin:Number(h.whole.begin),target,note:h.value.note,voice:h.value.voice,version });} });
  return { scheduler, log, advance(t: number) { now=t;tick(); }, version(n:number) { version=n; } };
}
it('identical generated-source evaluations retain every onset without restarting or doubling', async()=> {
  const h=harness(), p=await pattern();await h.scheduler.setPattern(p,true);
  for(let i=1;i<=20;i++) { h.version(i);await h.scheduler.setPattern(await pattern(),true);h.advance(i/10); }
  const boundary=h.scheduler.lastEnd;
  const expected=p.queryArc(0,boundary).filter(h=>h.hasOnset()).map(h=>`${h.value.voice}:${Number(h.whole.begin)}`).sort();
  expect(h.log.map(e=>`${e.voice}:${e.begin}`).sort()).toEqual(expected);
  expect(h.log.filter(e=>e.begin===0&&e.voice==='melody')).toHaveLength(1);
});
it('swapping pitch retains the old already-scheduled sound, with a ~300ms horizon',async()=> {
  const h=harness();await h.scheduler.setPattern(await pattern(),true);h.advance(.1);
  const oldCount=h.log.length;
  const oldFuture=h.log.filter(e=>e.target>.11);
  expect(oldFuture.length).toBeGreaterThan(0);
  const p=initial();const s=p.voices[0]?.steps[1];if(s?.kind==='note')s.pitch=90;
  h.version(1);const changed=(await core.evaluate(generate(p))).pattern;await h.scheduler.setPattern(changed,true);
  expect(h.log).toHaveLength(oldCount); // assignment does not retrigger a sustained note
  h.advance(.2);h.advance(.3);h.advance(.4);
  expect(h.log.filter(e=>e.voice==='melody'&&e.begin===.125).map(e=>[e.note,e.version])).toEqual([[64,0]]);
  expect(Math.max(...oldFuture.map(e=>e.target))-.11).toBeLessThanOrEqual(.3);
});
it('time-shifting across a swap compresses a gap even with no repeated onset or clock restart',async()=> {
  const h=harness();const p=core.sequence(60,62,64,65,67,69,71,72).note();await h.scheduler.setPattern(p,true);h.advance(.1);
  h.version(1);await h.scheduler.setPattern(p.late(1/16),true);for(let i=2;i<=8;i++)h.advance(i/10);
  const onset=h.log.findIndex(e=>e.version===1);const before=h.log[onset-1],after=h.log[onset];
  expect(before?.begin).toBe(.125);expect(after?.begin).toBe(.1875);
  expect(Number(after?.target)-Number(before?.target)).toBeCloseTo(.125); // formerly 250ms between notes
});
