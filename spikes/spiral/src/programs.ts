export interface Program { id: string; title: string; rows: string; hint: string; cycles: number; source: string }
export const programs: Program[] = [
  { id:'alternation', title:'01 · Three-cycle garden', rows:'T1', cycles:12, hint:'One motif, three turns. The amber seam marks a changed cycle.', source:`setcpm(30)
note("<c3 e3 g3> [c4 e4 g4 b4]")
  .s("triangle").gain(.75).lpf(4200)` },
  { id:'every-four', title:'02 · Every fourth turn', rows:'T1', cycles:16, hint:'A reversal every four cycles should read as a recurring accent.', source:`setcpm(30)
note("c3 e3 g3 b3 d4 g4")
  .s("sawtooth").lpf(3600)
  .every(4, x => x.rev().fast(2))` },
  { id:'polymeter', title:'03 · Gears out of phase', rows:'T1 · E3', cycles:16, hint:'Three against four against five. Follow a colour to follow a voice.', source:`stack(
  note("{c3 e3 g3}%4").s("triangle"),
  note("{c4 d4 f4 a4 b4}%4").s("sawtooth").gain(.55),
  s("bd ~ sd ~").gain(.8)
)` },
  { id:'randomness', title:'04 · A deterministic accident', rows:'T2 · T4', cycles:16, hint:'Query a cycle twice: the gaps stay put. A finite window is no repeat proof.', source:`stack(
  note("c3 e3 g3 b3 d4 f4 a4 c5")
    .s("triangle").degradeBy(.45)
    .sometimes(x => x.rev()).gain(rand.range(.3,1)),
  s("hh*16").degradeBy(.35).gain(.3)
)` },
  { id:'arrange-64', title:'05 · A sixty-four-cycle story', rows:'T3 · T1', cycles:64, hint:'Sixteen-turn chapters. Scrub the strip to visit the whole arrangement.', source:`const bass = note("c2 ~ g2 ~").s("sawtooth").lpf(1200)
const keys = note("c4 e4 g4 b4").s("triangle").gain(.65)
const drums = s("bd sd, hh*8").gain(.5)
arrange(
  [16, bass],
  [16, stack(bass, keys)],
  [16, stack(bass, keys, drums)],
  [16, keys.slow(2)]
)` },
  { id:'density-64', title:'06 · Too much of a good thing', rows:'E4', cycles:12, hint:'512 onsets per cycle. Auto detail resolves to occupancy cells; zoom or select Raw.', source:`note("c3 d3 e3 f3 g3 a3 b3 c4")
  .s("sawtooth").fast(64)
  .gain(.6).lpf(4800)` },
  { id:'chop-striate', title:'07 · A thousand little cuts', rows:'E4 · C2', cycles:12, hint:'Real chop and striate haps, including each grain’s begin/end settings.', source:`stack(
  s("breaks").chop(64).gain(.6),
  s("voice").striate(32).gain(.45).pan("0 1")
)` },
  { id:'chords', title:'08 · Voices in company', rows:'E3', cycles:12, hint:'Chords fan across pitch; simultaneous same-pitch voices get separate thin tracks.', source:`stack(
  note("[c3,e3,g3,b3] [a2,c3,e3,g3]").s("triangle").gain(.75),
  note("c4 e4 g4 b4 a4 g4 e4 d4").s("sawtooth").gain(.5).lpf(2200),
  s("bd ~ sd ~, hh*8").gain(.45)
)` },
  { id:'signals', title:'09 · Weather, without notes', rows:'E1 · C1 · T2', cycles:12, hint:'Inner bands are 64 real signal samples per turn. They have no onset heads.', source:`stack(
  note("c3 e3 g3 b3").s("sawtooth")
    .lpf(sine.range(250,7000)).pan(perlin),
  lpf(sine.range(250,7000)).pan(perlin)
)` },
  { id:'bare-values', title:'10 · Before a sound exists', rows:'E5', cycles:12, hint:'Bare strings and numbers remain visible as values; pitch is not invented.', source:`stack(
  mini('a b <c d> e'),
  mini('0 2 4 7').slow(3)
)` },
  { id:'long-overlap', title:'11 · Notes beyond the horizon', rows:'E2 · E3', cycles:16, hint:'A head appears only at whole.begin. Dotted continuations cross the cycle seam.', source:`stack(
  note("<c3 e3>").s("triangle").slow(4).gain(.8),
  note("<g3 b3 d4>").s("sawtooth").slow(3).gain(.55),
  note("e4 g4").s("sine").slow(2).gain(.5)
)` },
  { id:'full-piece', title:'12 · After-hours ensemble', rows:'T1 · T2 · E3 · C1', cycles:16, hint:'A plausible six-voice score. Ring focus is for reading; the coil is for comparing.', source:`setcpm(32)
stack(
  s("bd*4").gain(.85),
  s("~ sd ~ sd").gain(.65),
  s("hh*16").degradeBy(.22).gain(.24).pan("0.3 0.7"),
  note("<c2 c2 ab1 f2> [~ g2]").s("sawtooth")
    .lpf(sine.slow(8).range(300,1600)).gain(.7),
  note("<[c3,eb3,g3] [ab2,c3,eb3] [f3,ab3,c4] [g3,b3,d4]>")
    .s("triangle").slow(2).gain(.4).room(.4),
  note("g4 bb4 c5 eb5 d5 c5 bb4 g4")
    .s("sine").every(4,x=>x.rev()).degradeBy(.2)
    .gain(.4).pan(perlin).delay(.25)
)` },
  { id:'control-bags', title:'13 · More than one number', rows:'C1 · C2', cycles:12, hint:'Colon values normalize to cutoff + resonance. Inspect any glyph for the full bag.', source:`note("c3 e3 g3 b3").s("sawtooth")
  .lpf("<800:2 2400:1 6000:0.3>")
  .gain(".5 .8").pan("0 .5 1 .5")
  .room(.35).delay(.2).orbit(2)
  .fmap(v => ({...v, exampleArray:[800,2], exampleFn:()=>.5}))` },
  { id:'no-repeat', title:'14 · An unclosed horizon', rows:'T4 · T2', cycles:64, hint:'Random filter and a very slow Perlin drift. Only the queried window is claimed.', source:`note("{c3 e3 g3 b3 d4}%5")
  .s("triangle").fast("<1 1.5 2.25>")
  .lpf(rand.range(250,7500))
  .pan(perlin.slow(137))
  .gain(rand.range(.25,.9))` },
  { id:'heard-length', title:'15 · The score is not the sound', rows:'A4 · E3', cycles:12, hint:'Solid = score duration. Thin offset whisker = clip + release estimate, never a measured tail.', source:`stack(
  note("c3 e3 g3 b3").s("triangle").clip(3).release(1.2).gain(.7),
  s("crash ~ ~ ~").clip(.25).gain(.55),
  note("c4 ~ e4 ~").s("sawtooth").clip(.4).release(.7).gain(.45)
)` },
];
