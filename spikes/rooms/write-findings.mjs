import {readFile,writeFile} from 'node:fs/promises';
import {ordinaryPairs} from './cases.js';
const r=JSON.parse(await readFile('results.json'));
const get=n=>r.experiments.find(x=>x.name===n),num=x=>x===0?'0':x.toExponential(3);
const ordinaryPeak=Math.max(...r.experiments.slice(0,15).map(e=>e.earlyComparison.maxDifference));
const ordinary=ordinaryPairs.map(([name,a,b])=>{const e=get(name);return `| \`.${a}\` ↔ \`.${b}\` | ${num(e.comparison.nullRms)} | ${num(e.earlyComparison.maxDifference)} |`;}).join('\n');
const special=[
 ['FX reversal','X.FX(lpf(800),distort(2))','X.FX(distort(2),lpf(800))'],
 ['native equals LP then distortion','X.lpf(800).distort(2)','X.FX(lpf(800).distort(2).gain(1))'],
 ['native vs distortion then LP','X.lpf(800).distort(2)','X.FX(distort(2).gain(1)).lpf(800)'],
 ['FX precedes native','X.FX(distort(2).gain(1)).lpf(800)','X.FX(distort(2).gain(1),lpf(800).gain(1))'],
 ['implicit LFO target order','B.lpf(800).gain(.5).lfo({rate:4,depth:.8})','B.gain(.5).lpf(800).lfo({rate:4,depth:.8})'],
 ['same setting overwrite order','B.lpf(400).lpf(2400)','B.lpf(2400).lpf(400)'],
 ['patterned controls order','B.lpf("400 1600").gain(".2 .8 .5")','B.gain(".2 .8 .5").lpf("400 1600")'],
 ['FX delay is local','B.clip(.1).delay(1).delaytime(.2).delayfeedback(.65)','B.clip(.1).FX(delay(1).delaytime(.2).delayfeedback(.65).gain(1))'],
].map(([n,a,b])=>`| ${n} | \`${a}\` | \`${b}\` | ${num(get(n).comparison.nullRms)} |`).join('\n');
const state=[
 ['shared delay changes other tail','D(.2)','stack(D(.2), Zd(.07).orbit(1).late(.4))'],
 ['separate delay isolates tail','D(.2)','stack(D(.2), Zd(.07).orbit(2).late(.4))'],
 ['simultaneous shared delay stack reversal','stack(D(.2),Zd(.07).orbit(1))','stack(Zd(.07).orbit(1),D(.2))'],
 ['shared delay return to initial offline','stack(D(.25).clip(.9),Zd(.125).orbit(1).late(.4))','stack(D(.25).clip(.9),Zd(.125).orbit(1).late(.4),Zd(.25).orbit(1).late(.8))'],
 ['shared delay return to initial live','stack(D(.25).clip(.9),Zd(.125).orbit(1).late(.4))','stack(D(.25).clip(.9),Zd(.125).orbit(1).late(.4),Zd(.25).orbit(1).late(.8))'],
 ['shared room changes other tail offline','R(.35)','stack(R(.35),Zr(1.2).orbit(1).late(.4))'],
 ['separate room isolates tail','R(.35)','stack(R(.35),Zr(1.2).orbit(2).late(.4))'],
 ['simultaneous shared room stack reversal','stack(R(.35),Zr(1.2).orbit(1))','stack(Zr(1.2).orbit(1),R(.35))'],
 ['shared room changes tail live','R(1.2)','stack(R(1.2),Zr(.35).orbit(1).late(.25))'],
 ['shared delay changes tail live','D(.2)','stack(D(.2),Zd(.07).orbit(1).late(.4))'],
 ['separate room live','R(1.2)','stack(R(1.2),Zr(.35).orbit(2).late(.25))'],
 ['separate delay live','D(.2)','stack(D(.2),Zd(.07).orbit(2).late(.4))'],
 ['duck live','C','stack(C,Z.duck(2).duckdepth(1).duckattack(.25))'],
 ['bus modulation live','C.gain(.3)','stack(S,C.gain(.3).bmod({bus:1,c:"gain",da:.6}))'],
 ['cut shared sample group','stack(s("longlocal").gain(.6).cut(78),s("local").gain(0).late(.35).cut(79))','stack(s("longlocal").gain(.6).cut(80),s("local").gain(0).late(.35).cut(80))'],
 ['cut on synth','stack(C.cut(81),Z.cut(82))','stack(C.cut(83),Z.cut(83))'],
 ['analyze offline','C','C.analyze(1)']
].map(([n,a,b])=>`| ${n} | \`${a}\` | \`${b}\` | ${num(get(n).comparison.nullRms)} |`).join('\n');
const lengths=r.lengths.map(x=>`| \`${x.code.replace('note("c3").s("sawtooth").sustain(1).release(.01)','B')}\` | ${x.lastAboveMinus80dB.toFixed(2)} s | ${(x.lastAboveMinus80dB-x.scoredEnd).toFixed(2)} s |`).join('\n');
const samples=['','.loopAt(1)','.fit()','.splice(4,"0 1 2 3")','.chop(4)'].map(t=>{const a=r.samples.find(x=>x.code===`s("local")${t}`),b=r.samples.find(x=>x.code===`s("longlocal")${t}`);return `| \`s(SAMPLE)${t}\` | ${a.metrics.lastAboveMinus80dB.toFixed(2)} / ${b.metrics.lastAboveMinus80dB.toFixed(2)} s | ${a.metrics.centroidHz.toFixed(1)} / ${b.metrics.centroidHz.toFixed(1)} Hz |`;}).join('\n');
const text=`# Rooms: measured sound, qualified model

**Measured, not listened to:** Chromium ${r.browser}, pinned web/superdough 1.3.0; core 1.2.6. Stereo 24 kHz PCM, 1 cycle/second, onset +50 ms. Offline renders use fresh iframes and seeded generated impulses; live probes use an AudioWorklet tap. Every nested impulse render finishes before offline rendering. RMS subtraction, peak difference, cross-correlation, spectral centroid and 10 ms envelope endpoints are saved in [results.json](results.json); exact executable programs/options are in [cases.js](cases.js). No raw audio is saved.

Distinct scalar setters commute in these probes: twelve pairs null exactly. Vowel active windows differ by ≤${num(ordinaryPeak)}; held-note controls agree equally closely. Post-note vowel tails vary even between identical programs (consistent with asynchronous cleanup), so full-buffer bit identity is **not** established there. No scalar-order counterexample was found. Genuine order effects: FX sequencing, implicit modulator targets, overwriting the same control, and shared-state trigger/tie order. FX reversal changes centroid from 716.8 to 480.6 Hz; native LPF→distortion matches exactly, whereas distortion→LPF differs.

**Read from installed source:** source/envelope → ordered FX bags → native bag → optional FX-release fade → postgain → parallel dry/delay/reverb/bus/analyzer sends. Each bag has the following fixed order (source envelope: synth.mjs:45; gate duration: core/hap.mjs:36). FX bags also have gain (default .8); their delay/reverb are **per voice**, before native effects.

| Order within every bag | Installed source (relative to this directory) |
| --- | --- |
| Kabelsalat → stretch → transient → gain/velocity | node_modules/superdough/superdough.mjs:615,627,633,652 |
| LPF → HPF → BPF → vowel | same file:660,696,732,768 |
| coarse → crush → shape → distortion | same file:775,780,785,790 |
| tremolo → compressor → pan → phaser | same file:801,829,843,850 |
| FX-local delay → FX-local reverb | same file:865,882 |
| FX append API; native bag appended last; routing | node_modules/@strudel/core/pattern.mjs:3773; superdough.mjs:587,917,926,956,968 |

**Rooms:** delay automation is timestamped at onset; later sending events replace shared time/feedback, including silent senders. Equal-onset stack order matters. Reverb regeneration starts during scheduling, not at onset, and replacing its buffer can erase another voice’s tail. Worse, completion order can beat call order: reversing the shared-room stack left roomsize=.35 but an actual 1.8-second impulse (the earlier 1.2-second room’s IR). Offline scheduling therefore cannot establish live timing. Live shared-room replacement reduced the measured tail from 1.42 to .25 seconds; separate rooms stayed equivalent within capture precision. Same-code live reverb also has startup variability (null RMS ${num(get('room live same-code control').comparison.nullRms)}); do not interpret tiny live differences causally. The delay guard compares current AudioParam.value: offline .25→.125→.25 skips the return (null 0 versus omitting it; final value .125), while the live return changes PCM (null RMS ${num(get('shared delay return to initial live').comparison.nullRms)}). Scheduling ahead is therefore materially different. Source: superdoughoutput.mjs:54,65,69; reverb.mjs:25; reverbGen.mjs:25,95.

**Cross-note state:** live ducking reduced .44–.50-second RMS from ${get('duck live').windows.a.toFixed(3)} to ${get('duck live').windows.b.toFixed(3)}. It targets the entire orbit output, including tails; nonexistent targets fail. Cut fades the previous **sample** in 10 ms, not synths. Bus modulation changes another voice; analyze is a tap, not an audible effect (live analyzer RMS ${r.analyzer.rms.toFixed(3)}; disabled offline). Source: superdoughoutput.mjs:102,200; sampler.mjs:340; modulators.mjs:145; superdough.mjs:956,968.

**Length:** a synth gate/release bound is calculable, but thresholded energy is not generally predictable from one event. Excitation, gain, decoded slices, filter ringing, future cuts, shared-room changes and feedback matter. Delay is theoretically unbounded; reverb’s generated IR lasts 1.5×roomsize. The table’s scored end is 1.05 seconds; negative differences mean sound ends earlier.

**Samples:** registration and querying did not decode anything; explicit load changed cached=false to true and revealed .8 seconds. Query can compute fit/loopAt/splice score durations without that length; playback rate (unit=c), offsets, pitch and natural/chop tails need the decoded buffer. Both sample lengths fitted to one second, but pitch changed. Source: core/pattern.mjs:3291,3336,3405,3440; sampler.mjs:41,68,86,314.

**Seen:** five live screenshots, inspected and revised (labels, colors, lookahead explanation, mobile wrapping). No listening or non-Chromium checks. The prototype evaluates pasted Strudel; unlabelled same-sound/orbit branches merge, conflict detection samples one cycle, and opaque/custom sources have incomplete visual coverage.

| Corner | Verdict | Evidence |
| --- | --- | --- |
| A1 | shown | FX order null/spectrum tests; shots/2.png |
| A2 | shown degraded | shared/separate/live renders; IR race; shots/3.png and 4.png; scheduling state differs from heard state |
| A3 | shown degraded | duck/cut/bus PCM; analyzer meter; shots/5.png; pattern identity can merge |
| A4 | shown degraded | measured thresholded tails below; event-only prediction insufficient |
| Q3 | shown | generated .8/1.6 s samples, pre/post decode cache and transform renders |

| Model sentence (quoted) | Correction supported here |
| --- | --- |
| “Two different settings can be applied in either order with the same result.” | Qualify as independent bag assignments. Reordering lpf/gain before an implicit-target lfo changes the target and audio; core/controls.mjs:2923. |
| “Delay and reverb live in shared **rooms** (Strudel calls them orbits) that several patterns can send to, and can fight over.” | Native sends do. FX delay/reverb instead live inside each voice. Shared reverb has asynchronous IR races, not a reliable last-note-wins rule. |

Minimal-pair notation (append methods normally; all are real Strudel expressions):

\`\`\`js
const B = note("c3").s("sawtooth").sustain(1).release(.01)
const X = B.gain(1)
const R = d => s("sine").freq(330).sustain(1).release(.01).clip(.1).room(1).roomsize(d).dry(0).orbit(1)
const Zr = d => s("sine").freq(880).gain(0).clip(.1).room(1).roomsize(d)
const D = t => s("sine").freq(330).sustain(1).release(.01).clip(.1).delay(1).delaytime(t).delayfeedback(.65).dry(0).orbit(1)
const Zd = t => s("sine").freq(880).gain(0).clip(.1).delay(1).delaytime(t).delayfeedback(.65)
const C = s("sine").freq(440).sustain(1).release(.01).orbit(2)
const Z = s("sine").gain(0).late(.4).orbit(1)
const S = s("sine").freq(25).gain(1).bus(1).dry(0)
\`\`\`

Scalar tests are B.a.b versus B.b.a; both append .delaytime(.15).delayfeedback(.4).roomsize(.4).

| Swapped methods | Whole-buffer null RMS | Active-window maximum difference |
| --- | --- | --- |
${ordinary}

| Test | Program A | Program B | Null RMS |
| --- | --- | --- | --- |
${special}

| State test | Program A | Program B | Null RMS |
| --- | --- | --- | --- |
${state}

| Program | Last 10 ms bin above −80 dBFS | Beyond scored end |
| --- | --- | --- |
${lengths}

| Generated sample program | Last energy: .8 / 1.6 s sample | Centroid: .8 / 1.6 s sample |
| --- | --- | --- |
${samples}
`;
await writeFile('FINDINGS.md',text);
const prose=text.split('\n').filter(l=>!l.startsWith('|')).join(' ');console.log('Non-table whitespace words:',prose.split(/\s+/).length);
