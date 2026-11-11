import json,pathlib,re
root=pathlib.Path(__file__).parent
entries=[]
def add(id,title,source,tags,cycles=2,notes='',origin='original',licence='CC0-1.0'):
 (root/'programs'/f'{id}.strudel').write_text(source.strip()+'\n')
 entries.append(dict(id=id,file=f'programs/{id}.strudel',title=title,origin=origin,licence=licence,tags=tags.split(),cycles=cycles,notes=notes))
small=[
('tree-stack','Nested score trees','stack(cat(note("c3 e3"), note("g3")), note("[c4,e4,g4]").slow(3)).s("sine")','G1 E3',6),
('tree-arrange','Alternating branches','arrange([2, s("bd*4")], [3, s("hh*8")], [1, stack(s("cp"), s("bd*2"))])','G1 T1',6),
('callback-off','Offset shadow','note("c3 e3 g3").s("triangle").off(1/8, p => p.add(note(12)).gain(.3))','G2 E3',2),
('callback-deep','Callbacks inside callbacks','note("c3 e3 g3 b3").s("sine").layer(p => p, p => p.off(1/8, q => q.superimpose(r => r.rev().off(1/16, t => t.fast(2).gain(.2)))))','G2 G3',2),
('reuse','One motif in two registers','const motif = note("c3 eb3 g3 bb3");\nstack(motif.s("sine"), motif.add(note(12)).s("triangle").slow(2))','G3 G1',2),
('register','Registered custom transform',"register('ghosts', (amount, pat) => pat.off(1/8, p => p.gain(amount)));\nnote(\"c3 e3\").s(\"sine\").ghosts(.3)",'G3 G2',2),
('pattern-fast','Time is a pattern','note("c3 e3 g3").s("sine").fast("<1 2 3 5>").lpf("<400 2000>")','G4 T1',4),
('pattern-slow','Nested rate modulation','s("bd hh cp hh").slow("<1 3 2>").early("0 .125")','G4 T1',6),
('labels','Labels and muted voice','$: s("bd*4")\nhats: s("hh*8").gain(.3)\n_$: s("cp*8")\nall(p => p.slow(2))','G5 G1',2),
('orbit-conflict','Two voices fight over room zero','$: s("bd*4").orbit(0).room(.8).roomsize(2)\n$: note("c4 e4").s("sine").orbit(0).room(.2).roomsize(8)','G5 A2',2),
('long-alternation','Seven and eleven','note("<c3 d3 e3 f3 g3 a3 b3>").s("sine").firstOf(11,p=>p.ply(3))','T1 G2',77),
('polymeter','Three across four','s("{bd cp hh}%4").slow(5)','T1 G1',15),
('seeded-drop','Time addressed dropout','s("hh*16").degradeBy(.37).seed(42)','T2 T4',300),
('random-pitch','Sampled random pitch','note(irand(24).segment(7).add(48)).s("sine").gain(perlin.range(.1,.7))','T2 T4',300),
('arrange-300','A three hundred cycle score','arrange([120,s("bd*4")],[90,note("c3 eb3").s("sine")],[89,s("hh*8")],[1,s("cp*16")])','T3 T1',300),
('arrange-301','Distant single ending','arrange([299,note("c3").s("sine").slow(7)],[1,s("cp*4")],[1,s("bd")])','T3 E2',301),
('signal-bare','Continuous values are not notes','sine','E1 E5',2),
('signal-lanes','Several continuous settings','note("c3*4").s("sawtooth").lpf(sine.range(300,3000)).pan(cosine.range(0,1)).gain(perlin.range(.1,.8))','E1 G4',8),
('fragments-slow','Whole spans multiple windows','note("c3 e3").s("sine").slow(7)','E2 A4',7),
('fragments-chop','Chopped overlapping whole spans','note("[c3,e3,g3]").s("sawtooth").slow(3).early(1/3)','E2 E3',3),
('dense-64','Sixty four times four','s("hh*4").fast(64)','E4 Q2',1),
('dense-stack','Polyphonic dense lattice','stack(note("[c3,e3,g3,b3]"),note("[d4,f4,a4]")).s("sine").ply(128)','E4 Q2',1),
('bare-numbers','Numeric score before controls','pure(7).fast(3)','E5 G4',1),
('bare-strings','Strings before controls','cat(pure("north"),pure("south"))','E5 G1',2),
('control-aliases','Aliases and uncommon controls','note("c3 e3").s("sine").lpf(900).lpq(2).vib(4).vibmod(.2).velocity(.7)','C1 G4',2),
('control-multivalue','Colon settings','note("c3 e3").s("sine").lpf("800:2").delay(".3:.125:.6")','C2 C1',2),
('control-array','Array valued partials','note("c3 g3").s("user").partials([1,.5,0,.25]).phases([0,.25,0,.5])','C2 C1',2),
('fx-filter-drive','Filter then distortion','note("c3 e3").s("sawtooth").FX(lpf(500),distort(1)).delay(.3)','A1 C2',2),
('fx-drive-filter','Distortion then filter','note("c3 e3").s("sawtooth").FX(distort(1)).FX(lpf(500)).delay(.3)','A1 C2',2),
('orbit-delay','Separate rooms with delay','$: s("bd*4").orbit(1).delay(.3).delaytime(.25)\n$: s("cp*2").orbit(2).delay(.8).delaytime(.375)','A2 G5',2),
('cut-group','Shared cut group','stack(s("oh*2").cut(1),s("hh*8").cut(1))','A3 E3',2),
('duck-room','Cross voice duck routing','$: s("bd*4").orbit(0).duck(1).duckdepth(.8).duckattack(.01)\n$: note("[c3,eb3,g3]").s("sawtooth").orbit(1).slow(2)','A3 A2',2),
('tails','Release outlasts score','note("c4*8").s("sine").release(3).legato(.2)','A4 E3',2),
('clip-length','Legato and clip','s("oh*4").clip(.2).legato(2)','A4 C1',2),
('external-state','Tempo samples await and hush',"await samples('github:tidalcycles/dirt-samples');\nsetcpm(100);\nhush();\ns(\"bd*4\")",'S1 Q3',2),
('external-tempo','Tempo outside score','setcpm(73);\nawait Promise.resolve();\nnote("c3 g3").s("sine")','S1 G3',2),
('trigger','Trigger time callback','note("c4*4").s("sine").onTrigger(() => console.log(\'a note was triggered\'))','S2 G2',2),
('visuals','Visual and log hooks','s("bd hh cp hh").log().pianoroll().scope()','S2 G2',2),
('query-throws','Broken is not quiet',"new Pattern(() => { throw new Error('corpus intentional query failure'); })",'Q1 Q2',1),
('query-late-throws','A later window fails',"new Pattern(state => { if (Number(state.span.begin) >= 3) throw new Error('corpus intentional late failure'); return note(60).query(state); })",'Q1 T1',4),
('sample-loop','Loop length metadata','s("breaks165").loopAt(3)','Q3 A4',3),
('sample-splice','Slices need decoded duration','s("breaks165").splice(8,"0 1 [2 3] 7").fit()','Q3 E4',2),
]
for slug,title,source,tags,cycles in small:
 notes=''
 if slug.startswith('query-'): notes='INTENDED FAILURE: valid construction; underlying query throws. queryArc would swallow this error.'
 if slug=='external-state': notes='Sample loading is stubbed. No decoded audio is required for score inspection.'
 if slug.startswith('sample-'): notes='Score only: actual duration, slicing and playback require decoded sample metadata and are unverified.'
 if slug.startswith('arrange-'): notes='The checker queries only cycles 0..8; inspect the full cycles horizon to see the distant transition.'
 add('micro-'+slug,title,source,tags,cycles,notes)
# Owner fixtures: retain exact transforms, supply the same simple source where needed.
base=pathlib.Path('/home/aaron/projects/monkeyboys-modular-synth/src/modules')
fixtures=[('clock','.slow(2).swingBy(1/3, 4).late(1/8)','T1 E2'),('euclid','.euclidRot(3, 8, 2)','G4 T1'),('euclid-legato','.euclidLegato(3, 8)','E2 A4'),('ratchet','.ply("<1 2 4>")','E4 G4'),('seed','.degradeBy(0.3).seed(45)','T2 T4'),('palindrome','.palindrome()','T1 G1'),('shuffle','.shuffle(8)','T2 T4'),('ribbon','.rib(45, 2)','T1 G4'),('zoom','.zoom(0.25, 0.75)','E2 G4'),('echo','.echo(3, 1/8, 0.5)','E3 G2')]
for slug,call,tags in fixtures:
 assert call in (base/'pattern-time.fixtures.ts').read_text()
 add('mms-'+slug,'MMS '+slug,'note("c3 e3 g3 b3").s("sine")'+call,tags,8,'Adapted exact call from src/modules/pattern-time.fixtures.ts; supplied neutral note source.', 'mms','MIT; Copyright (c) 2026 Aaron Hoyt; see MMS-LICENSE.txt')
for slug,call,tags in [('chunk','.chunk(4, x => x.ply(2).rev())','G2 E4'),('off','.off(1/8, x => x.rev().gain(.5))','G2 E3'),('within','.within(.25, .75, x => x.ply("2").rev())','G2 E2'),('jux','.jux(x => x.ply("2").rev())','G2 E3'),('nested','.chunk(4, x => x.off(1/8, y => y.ply("2").rev()).rev())','G2 G3')]:
 assert call in (base/'function-loops.fixtures.ts').read_text()
 add('mms-'+slug,'MMS '+slug,'note("c3 e3 g3 b3").s("sine")'+call,tags,4,'Adapted exact call from src/modules/function-loops.fixtures.ts; supplied neutral note source.','mms','MIT; Copyright (c) 2026 Aaron Hoyt; see MMS-LICENSE.txt')
# Original complete pieces: hand-authored voice/arrangement recipes, no third-party tunes.
pieces=[
('harbour',90,'c2 ~ g2 bb2','[c4,eb4,g4] [bb3,d4,f4]','bd ~ bd ~','hh*8','cp ~ cp ~', 'triangle', '.delay(.3).delaytime(.375)'),
('foundry',138,'c2 c2 eb2 gb2','[c4,eb4,gb4] ~ [bb3,db4,f4] ~','bd*4','[hh hh oh hh]*2','~ cp ~ cp','sawtooth','.FX(coarse(4),lpf(1200),distort(.5))'),
('lichen',68,'d2 ~ a2 ~','[d4,f4,a4]@3 [c4,e4,g4]','bd ~ ~ bd','hh*4','~ ~ cp ~','sine','.room(.7).release(1.5)'),
('night-bus',112,'f2 ab2 c3 eb3','[f3,ab3,c4] [eb3,g3,bb3]','bd ~ bd [~ bd]','hh*16','~ cp ~ cp','triangle','.delay(.4)'),
('copper',124,'e2 e2 g2 b2','[e4,g4,b4] [d4,fs4,a4]','bd*4','hh*8','~ cp ~ cp','sawtooth','.FX(lpf(1800),distort(.3))'),
('paper-lantern',78,'a2 ~ e3 g2','[a3,c4,e4] [g3,b3,d4]','bd ~ ~ bd','hh*8','~ cp ~ ~','sine','.room(.6).pan(sine.range(.2,.8))'),
('tidal-stairs',105,'g2 bb2 d3 f3','[g3,bb3,d4] [f3,a3,c4]','bd ~ [bd bd] ~','hh*12','~ cp ~ cp','triangle','.delay(.25).delaytime(.333)'),
('glass-garden',96,'b1 fs2 a2 d2','[b3,d4,fs4] [a3,cs4,e4]','bd ~ bd ~','hh*8','~ cp ~ cp','sine','.FX(phaser(.3),delay(.2)).room(.5)'),
('relay',150,'d2 d2 f2 a2','[d4,f4,a4] ~ [c4,e4,g4] ~','bd*4','hh*16','~ cp ~ cp','sawtooth','.lpf("<500 1800 900 3000>")'),
('slow-orbit',60,'eb2 ~ bb2 ~','[eb4,g4,bb4] [db4,f4,ab4]','bd ~ ~ ~','hh*4','~ ~ cp ~','sine','.room(.8).release(2)'),
('moss-radio',84,'c2 g2 bb2 eb3','[c4,eb4,g4] [ab3,c4,eb4]','bd ~ bd ~','[hh ~ hh hh]*2','~ cp ~ cp','triangle','.delay(.4).lpf(perlin.range(500,2400))'),
('sundial',118,'a1 e2 g2 b2','[a3,c4,e4] [f3,a3,c4]','bd ~ bd bd','hh*8','~ cp ~ cp','sawtooth','.FX(distort(.25),lpf(1600))'),
('kiln',132,'fs2 fs2 a2 cs3','[fs3,a3,cs4] [e3,g3,b3]','bd*4','hh*16','~ cp ~ cp','triangle','.room(.3).delay(.2)'),
('blue-hour',72,'bb1 f2 ab2 c3','[bb3,db4,f4] [ab3,c4,eb4]','bd ~ ~ bd','hh*8','~ cp ~ ~','sine','.release(.8).room(.6)'),
('switchyard',142,'g1 g2 bb1 d2','[g3,bb3,d4] [eb3,g3,bb3]','bd*4','hh*16','~ cp ~ cp','sawtooth','.FX(coarse(3),bpf(1200),distort(.4))'),
]
for i,(slug,bpm,bass,chords,kick,hats,snare,wave,fx) in enumerate(pieces):
 source=f'''// Original: {slug.replace('-', ' ')}
setcpm({bpm}/4);
const drums = stack(s("{kick}"), s("{hats}").gain(.22).pan(.65), s("{snare}").gain(.5));
const bass = note("{bass}").s("{wave}").lpf(700).gain(.45).release(.12);
const pad = note("{chords}").s("triangle").slow(4).gain(.23){fx};
const lead = note("<{bass.split()[0]} {bass.split()[-1]}>").add(note(24)).s("sine").ply("<1 2 3 2>").gain(.18).delay(.3);
arrange([4, drums], [8, stack(drums,bass)], [16, stack(drums,bass,pad,lead)], [4, stack(pad,lead)])
'''
 add('piece-'+slug,slug.replace('-',' ').title(),source,'G1 G3 T3 E3 A4'+(' A1' if '.FX' in fx else ' A2'),32,'Original multi-voice piece; no audio audition. Final arrangement transition occurs outside checker window.')
# Generated fixtures must not replace owner-collected entries.
index_path=root/'index.json'
collected=json.loads(index_path.read_text()) if index_path.exists() else []
entries.extend(e for e in collected if e.get('origin')=='owner-collected')
index_path.write_text(json.dumps(entries,indent=2)+'\n')
print(len(entries))
