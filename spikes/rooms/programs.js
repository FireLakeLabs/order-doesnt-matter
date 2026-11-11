export const programs=[
 {title:'01 · A voice, dressed',subtitle:'A fixed path. Settings travel with each note.',code:`setcps(1)
MINT: note("c3 e3 g3 b3").s("sawtooth")
  .lpf("400 1800 700 2400").gain(.35)
  .vowel("a e i o").pan(".2 .8")
  .release(.15).orbit(1)`},
 {title:'02 · The ordered exception',subtitle:'Two inserts before the native strip. Reversal changes sound.',code:`setcps(1)
VIOLET: note("c3 ~ g3 ~").s("sawtooth")
  .FX(distort(2).gain(1), lpf(800).gain(1))
  .lpf(2000).pan(.65).gain(.4)
  .release(.3).orbit(1)`},
 {title:'03 · One room, two intentions',subtitle:'Silent or loud: each sender can change the shared room.',code:`setcps(1)
MINT: note("c4 ~ ~ ~").s("sine").gain(.4)
  .release(.15).delay(.7).delaytime(.2)
  .room(.8).roomsize(1.2).orbit(1)
AMBER: note("~ ~ g4 ~").s("triangle").gain(.25)
  .delay(.4).delaytime(.07)
  .room(.5).roomsize(.35).orbit(1)`},
 {title:'04 · Two rooms, no argument',subtitle:'Independent echoes. The same settings cannot collide.',code:`setcps(1)
MINT: note("c4 ~ ~ ~").s("sine").gain(.4)
  .delay(.7).delaytime(.2).room(.8).roomsize(1.2).orbit(1)
VIOLET: note("~ ~ g4 ~").s("triangle").gain(.25)
  .delay(.4).delaytime(.07).room(.5).roomsize(.35).orbit(2)`},
 {title:'05 · Voices affect voices',subtitle:'Ducking targets a room; cut groups stop earlier samples.',code:`setcps(1)
MINT: note("c3").s("sawtooth").lpf(900)
  .gain(.25).sustain(1).release(.1).orbit(2)
AMBER: s("local*2").cut(3).gain(.25)
  .duck(2).duckdepth(.9).duckattack(.25).orbit(1)
VIOLET: s("~ local ~ local").cut(3).gain(.2)
  .bus(1).analyze(1).orbit(1)`}
];
