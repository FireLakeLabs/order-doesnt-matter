# Third wave: five fixes and twenty-two views

Plan written by the lead with the owner on 2026-11-17. It changes none of the
rules in [second-wave.md](second-wave.md): every view is one file behind the
shared view contract, draws correctly for any `now` in any order, keeps no clock
of its own, and never drops notes silently. Games take a genre's mechanics only;
names, characters and art are our own.

Mockups: `mockups/third-wave/`, one `.dc.html` per board (read them as markup),
also on the owner's design canvas. Each shows the dubstep arrangement
(`corpus/programs/real-dubstep-arranged.strudel`) at bar 11, 40% through the bar;
Slalom and Chord bridge use bar 18. The pictures are illustrative; the mapping
rules on each card are the design. Pond and Whack were declined by the owner.

Every wave below ends with a sweep (D50) before the next one starts.

## Wave 3.0: fixes to existing views (merged, #122–#126)

The sweep found four small fixes (Ash Run, Tubes, Swarm, Ribbons) and one
limit that a view cannot fix alone, now in the backlog: a Catwalk flash tail
ends early when its note leaves the notes the host supplies.

| View    | Owner's complaint                                                                                       | Fix                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coil    | Hides detail; dragging only rolls the spiral, and it springs back                                       | A real 3D object: drag orbits in any direction and stays; wheel zooms toward the pointer; shift-drag slides along the song; double-click resets. A stretch control pulls the turns apart so none hides another. Hover names a note (part, pitch, settings). Click a turn to lay that bar out flat and readable; click again to return.                                                |
| Ash Run | Hops on every bass note, floats over rests, buildings unconvincing, see-through background, cape, slams | Approved boards `AshRun.dc.html` and `AshRunParts.dc.html`. The city is generated from distance run, never from notes: real buildings, gaps a runner can clear, section → district style. Music drives the world around him: footfalls, crates he vaults or crashes through, pigeons that flush, distant blasts, the walker and its beam, lit windows.                                |
| Swarm   | Reads as Space Invaders, not Galaga                                                                     | Galaga's mechanics in our own art: formation centred at the top that breathes on the steadiest drum; the next bar's notes swoop in on looping entry paths to their slots; each note peels off in a curling dive at its onset; the ship slides along the bottom to meet each diver; held notes are flagships casting a beam for the note's length; the starfield scrolls downward.     |
| Catwalk | Jerky figures in a line that vanish                                                                     | One model per part, persistent. Runway seen from the audience with curtain, runway lights and photographers down both sides. Parts take turns, one walk per bar in rotation among those playing: walk out, pose on its notes, turn, walk back. Every note of every part fires a camera flash in that part's colour. A smooth walk cycle: hip sway, one foot in front of the other.    |
| Tubes   | Fill level jumps; every vessel the same                                                                 | The level pours from the previous note's value to the new one over a short ease with a small slosh, still exact for any `now`. Vessel by setting family: filters → conical flask; room, size, delay → round-bottom flask; gain → a speaker whose cone pushes out with the level; pan → a left/right speaker pair with a balance; pitch → tall graduated cylinder; others → test tube. |

## Wave 3.1: views with no framework change (merged, #135–#150)

Each is one pull request with the shared smoke test. Lanes run in parallel;
views within a lane run in order so lessons carry. Five were sent back once for
not reading as their subject at a glance (Pinball, Chord bridge, Relay, Slalom,
Stacker). The sweep found a Studio switching defect, the shared analyser's
−30 dB ceiling and small polish items; their fixes land before wave 3.2.

| Lane        | Order                                |
| ----------- | ------------------------------------ |
| Games       | Pinball → Bout → Slalom → Stacker    |
| Show        | Dancer → Mobile → Light rig          |
| Pitch       | Chord bridge → Staff → Graphic score |
| Song        | Orrery → Relay → Garden              |
| Second wave | Marble run → Aquarium → Afterglow    |

The owner folded in the five second-wave views that were never started
(2026-11-18); all five shipped (#138, #141, #145, #146, #147). Their mapping rules are in [second-wave.md](second-wave.md) and
their mockups in `mockups/second-wave/`. Light rig stays last in its lane
because of its GPU cost.

- Orrery's orbit for a moving setting's rate (the wobble's `<2 4 3 8>`) needs
  change C; build the note-period orbits now and add that orbit in wave 3.3.
- Staff engraves with VexFlow 4.2.5 (MIT), pinned and loaded only when Staff
  opens; only Staff may import it.

## Later waves: one framework change with the views it unlocks

| Wave | Change                                               | Views                            |
| ---- | ---------------------------------------------------- | -------------------------------- |
| 3.2  | A. sample waveforms from the loaded samples          | Sampler                          |
| 3.2  | B. stereo measured sound                             | Stereo glass                     |
| 3.3  | C. program structure and rewrite snapshots for views | Origami, Orrery's driver orbit   |
| 3.4  | D. edit history for views                            | Tracing paper                    |
| 3.5  | F. setting values between notes (needs C)            | Strobe, Mixing desk motor trails |

Each contract change lands alone before its views. Change E (views that take
input or request edits) is not planned: its only remaining use is optional
Mixing desk faders.

## Found while designing

In the dubstep arrangement every wobble-bass note samples its moving filter at
1370 Hz: Strudel 1.2.6 reads a signal at the note's start, and every wobble
note starts at a whole number of driver turns. Strobe exists to show this.
