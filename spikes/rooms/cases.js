export const base='note("c3").s("sawtooth").sustain(1).release(.01)';
export const ordinaryPairs=[
 ['lpf/gain','lpf(800)','gain(.5)'],['lpf/distort','lpf(800)','distort(2)'],['hpf/distort','hpf(1200)','distort(2)'],['pan/crush','pan(.2)','crush(4)'],['vowel/lpf','vowel("a")','lpf(800)'],['vowel/distort','vowel("e")','distort(2)'],['coarse/crush','coarse(8)','crush(4)'],['gain/distort','gain(.2)','distort(2)'],['pan/delay','pan(.2)','delay(.6)'],['lpf/delay','lpf(800)','delay(.6)'],['distort/room','distort(2)','room(.5)'],['delay/room','delay(.5)','room(.5)'],['room/size','room(.5)','roomsize(.4)'],['pan/vowel','pan(.7)','vowel("i")'],['lpf/hpf','lpf(800)','hpf(400)']
];
function windowRms(r,a,b){let sum=0,n=0;for(const c of r.channels)for(let i=Math.floor(a*r.sr);i<b*r.sr;i++){sum+=c[i]**2;n++;}return Math.sqrt(sum/n);}
export async function measure(probe){
 const {render,metrics,compare,alignedComparison}=probe,result={method:{sampleRate:24000,cps:1,onsetOffset:.05,threshold:1e-4,seed:719},pairs:[],experiments:[]};
 async function pair(name,a,b,options={},window){
   const x=await render(a,options),y=await render(b,options);
   const mx=metrics(x),my=metrics(y);delete mx.envelope;delete my.envelope;
   const row={name,a,b,alignment:options.live?alignedComparison(x,y):undefined,comparison:compare(x,y,...(window||[])), earlyComparison:compare(x,y,0,1), lateComparison:compare(x,y,1.08),aMetrics:mx,bMetrics:my,windows:{a:windowRms(x,.44,.5),b:windowRms(y,.44,.5)},eventsA:x.events,eventsB:y.events,controlsA:x.controls,controlsB:y.controls,finalOrbitsA:x.finalOrbits,finalOrbitsB:y.finalOrbits,endOrbitsA:x.endOrbits,endOrbitsB:y.endOrbits,observedA:x.observed,observedB:y.observed,windowBefore:compare(x,y,0,.32),windowAfter:compare(x,y,.48,1.4)};
   result.experiments.push(row);return row;
 }
 for(const [name,a,b]of ordinaryPairs){
  const suffix='.delaytime(.15).delayfeedback(.4).roomsize(.4)';
  const row=await pair(name,`${base}.${a}.${b}${suffix}`,`${base}.${b}.${a}${suffix}`);
  result.pairs.push({name,...row.comparison});
 }
 for(const [name,a,b]of ordinaryPairs.filter(x=>x[0].includes('vowel'))) {
   const code=`${base}.${a}.${b}.delaytime(.15).delayfeedback(.4).roomsize(.4)`;
   await pair(`${name} same-code control`,code,code);
 }
 for(const [name,a,b]of ordinaryPairs.filter(x=>x[0].includes('vowel')))await pair(`${name} held control`,`${base}.slow(4).${a}.${b}`,`${base}.slow(4).${b}.${a}`,{seconds:1});
 const x=base+'.gain(1)';
 await pair('implicit LFO target order',base+'.lpf(800).gain(.5).lfo({rate:4,depth:.8})',base+'.gain(.5).lpf(800).lfo({rate:4,depth:.8})');
 await pair('patterned controls order',base+'.lpf("400 1600").gain(".2 .8 .5")',base+'.gain(".2 .8 .5").lpf("400 1600")');
 await pair('same setting overwrite order',base+'.lpf(400).lpf(2400)',base+'.lpf(2400).lpf(400)');
 await pair('FX reversal' ,x+'.FX(lpf(800),distort(2))',x+'.FX(distort(2),lpf(800))');
 await pair('native equals LP then distortion',x+'.lpf(800).distort(2)',x+'.FX(lpf(800).distort(2).gain(1))');
 await pair('native vs distortion then LP',x+'.lpf(800).distort(2)',x+'.FX(distort(2).gain(1)).lpf(800)');
 await pair('FX precedes native',x+'.FX(distort(2).gain(1)).lpf(800)',x+'.FX(distort(2).gain(1),lpf(800).gain(1))');
 const a='s("sine").freq(330).sustain(1).release(.01).clip(.1).delay(1).delaytime(.2).delayfeedback(.65).dry(0).orbit(1)';
 const b='s("sine").freq(880).gain(0).clip(.1).delay(1).delaytime(.07).delayfeedback(.65)';
 await pair('shared delay changes other tail',a,`stack(${a},${b}.orbit(1).late(.4))`,{seconds:2.5},[.45,2.5]);
 await pair('separate delay isolates tail',a,`stack(${a},${b}.orbit(2).late(.4))`,{seconds:2.5});
 await pair('simultaneous shared delay stack reversal',`stack(${a},${b}.orbit(1))`,`stack(${b}.orbit(1),${a})`,{seconds:2.5});
 const heldD=a.replace('clip(.1)','clip(.9)').replace('delaytime(.2)','delaytime(.25)');
 const alternateD=b.replace('delaytime(.07)','delaytime(.125)');
 const returnD=b.replace('delaytime(.07)','delaytime(.25)');
 await pair('shared delay return to initial offline',`stack(${heldD},${alternateD}.orbit(1).late(.4))`,`stack(${heldD},${alternateD}.orbit(1).late(.4),${returnD}.orbit(1).late(.8))`,{seconds:3});
 await pair('shared delay return to initial live',`stack(${heldD},${alternateD}.orbit(1).late(.4))`,`stack(${heldD},${alternateD}.orbit(1).late(.4),${returnD}.orbit(1).late(.8))`,{seconds:3,live:true});
 const ra='s("sine").freq(330).sustain(1).release(.01).clip(.1).room(1).roomsize(.35).dry(0).orbit(1)';
 const rb='s("sine").freq(880).gain(0).clip(.1).room(1).roomsize(1.2)';
 await pair('shared room changes other tail offline',ra,`stack(${ra},${rb}.orbit(1).late(.4))`,{seconds:3});
 await pair('separate room isolates tail',ra,`stack(${ra},${rb}.orbit(2).late(.4))`,{seconds:3});
 await pair('simultaneous shared room stack reversal',`stack(${ra},${rb}.orbit(1))`,`stack(${rb}.orbit(1),${ra})`,{seconds:3});
 const carrier='s("sine").freq(440).sustain(1).release(.01).orbit(2)';
 const trigger='s("sine").gain(0).late(.4).orbit(1)';
 await pair('duck offline',carrier,`stack(${carrier},${trigger}.duck(2).duckdepth(1).duckattack(.25))`,{seconds:1.5});
 await pair('duck checkpoint offline',carrier,`stack(${carrier},${trigger}.duck(2).duckdepth(1).duckattack(.25))`,{seconds:1.5,staged:true});
 const sample='s("longlocal").gain(.6)';
 await pair('cut shared sample group',`stack(${sample}.cut(78),s("local").gain(0).late(.35).cut(79))`,`stack(${sample}.cut(80),s("local").gain(0).late(.35).cut(80))`,{seconds:2});
 await pair('cut on synth',`stack(${carrier}.cut(81),${trigger}.cut(82))`,`stack(${carrier}.cut(83),${trigger}.cut(83))`,{seconds:1.5});
 const sender='s("sine").freq(25).gain(1).bus(1).dry(0)';
 await pair('bus modulation offline',carrier+'.gain(.3)',`stack(${sender},${carrier}.gain(.3).bmod({bus:1,c:"gain",da:.6}))`,{seconds:1.5,staged:true});
 await pair('analyze offline',carrier,carrier+'.analyze(1)',{seconds:1.5});
 await pair('duck live',carrier,`stack(${carrier},${trigger}.duck(2).duckdepth(1).duckattack(.25))`,{seconds:1.5,live:true});
 await pair('bus modulation live',carrier+'.gain(.3)',`stack(${sender},${carrier}.gain(.3).bmod({bus:1,c:"gain",da:.6}))`,{seconds:1.5,live:true});
 await pair('shared room changes tail live',ra.replace('roomsize(.35)','roomsize(1.2)'),`stack(${ra.replace('roomsize(.35)','roomsize(1.2)')},${rb.replace('roomsize(1.2)','roomsize(.35)')}.orbit(1).late(.25))`,{seconds:2,live:true});
 await pair('shared delay changes tail live',a,`stack(${a},${b}.orbit(1).late(.4))`,{seconds:2,live:true});
 await pair('room live same-code control',ra.replace('roomsize(.35)','roomsize(1.2)'),ra.replace('roomsize(.35)','roomsize(1.2)'),{seconds:2,live:true});
 await pair('separate room live',ra.replace('roomsize(.35)','roomsize(1.2)'),`stack(${ra.replace('roomsize(.35)','roomsize(1.2)')},${rb.replace('roomsize(1.2)','roomsize(.35)')}.orbit(2).late(.25))`,{seconds:2,live:true});
 await pair('separate delay live',a,`stack(${a},${b}.orbit(2).late(.4))`,{seconds:2,live:true});
 await pair('FX delay is local',base+'.clip(.1).delay(1).delaytime(.2).delayfeedback(.65)',base+'.clip(.1).FX(delay(1).delaytime(.2).delayfeedback(.65).gain(1))',{seconds:4});
 result.sampleMetadata=await probe.sampleMetadata();
 result.analyzer=await probe.liveAnalyze();
 result.lengths=[];
 for(const [name,code] of [
  ['clip .25',base+'.clip(.25)'],['legato 1.5',base+'.legato(1.5)'],['release .8',base+'.release(.8)'],['delay tail',base+'.clip(.1).delay(1).delaytime(.2).delayfeedback(.65)'],['room tail',base+'.clip(.1).room(1).roomsize(1)'],['sample natural','s("local")'],['sample clip','s("local").clip(.25)']]){
  const r=await render(code,{seconds:4});const m=metrics(r);delete m.envelope;result.lengths.push({name,code,scoredEnd:r.events[0].end+.05,...m});
 }
 result.samples=[];
 for(const transform of ['', '.loopAt(1)', '.fit()', '.splice(4,"0 1 2 3")','.chop(4)'])for(const sound of ['local','longlocal']){
   const code=`s("${sound}")${transform}`,r=await render(code,{seconds:2.5}),m=metrics(r);delete m.envelope;
   result.samples.push({code,decodedSeconds:sound==='local'?.8:1.6,events:r.events,metrics:m});
 }
 return result;
}
