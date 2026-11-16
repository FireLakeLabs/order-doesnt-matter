# Second wave: twenty-four more views

Plan for the next set of live views, written by the lead with the owner on
2026-11-16. It builds on the [Studio design](design.md) and changes none of its
rules: every view is one file behind the shared view contract, draws correctly
for any `now` in any order, keeps no clock of its own, and never drops notes
silently.

Mockups: `mockups/second-wave/`, one `.dc.html` per view (they need a host page
to render; read them as markup). Each shows the dubstep arrangement
(`corpus/programs/real-dubstep-arranged.strudel`) at bar 11, 40% through the
bar. Chord star, Harp and Harmonograph use bar 18, where the chords are. The
pictures are illustrative; the mapping rules on each card are the design.

## The views

| id            | Name          | Group    | Draws with | Needs      | What it shows                                                                                         |
| ------------- | ------------- | -------- | ---------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| metronomes    | Metronomes    | Rhythm   | Canvas 2D  | window     | One metronome per instrument; the arm reaches an extreme on each onset, so polyrhythm shows as drift  |
| marble-run    | Marble run    | Rhythm   | Canvas 2D  | window     | Marbles launched one window ahead land on drums, cymbals and pitched bars at their onsets             |
| karaoke       | Karaoke       | Rhythm   | Canvas 2D  | window     | One lyric line per instrument; words are sound names or pitches at their real starts; a ball hops     |
| deja-vu       | Déjà vu       | Rhythm   | Canvas 2D  | whole song | This bar drawn over the previous one: new, vanished and changed notes; a strip of change per bar      |
| chord-star    | Chord star    | Pitch    | Canvas 2D  | window     | Sounding pitch classes on the circle of fifths joined into a polygon; chord named when clear          |
| harp          | Harp          | Pitch    | Canvas 2D  | whole song | One string per pitch the song uses; notes pluck and the string shimmers for the note's span           |
| harmonograph  | Harmonograph  | Pitch    | Canvas 2D  | window     | Lowest and highest sounding pitch drive a two-pendulum figure; simple ratios close, clashes tangle    |
| afterglow     | Afterglow     | Pitch    | Canvas 2D  | audio      | Measured spectrogram with scored notes outlined on top; tails past the outline are measured, labelled |
| catwalk       | Catwalk       | Settings | Canvas 2D  | window     | Notes walk a runway wearing their settings as garments; the posing note's tag lists its whole bag     |
| tubes         | Tubes         | Settings | Canvas 2D  | window     | One test tube per setting in use; moving values jump once per note and bubble, constants sit still    |
| soundstage    | Soundstage    | Settings | Canvas 2D  | window     | Seen from above: pan left to right, room send near to far, gain as size                               |
| aquarium      | Aquarium      | Settings | Canvas 2D  | window     | Each room is a tank; senders are fish; a note that changes the room stirs it and is named             |
| metro         | Metro         | Song     | Canvas 2D  | whole song | Sections are stations, instruments are lines; a departure board names who joins and leaves next       |
| skyline       | Skyline       | Song     | Canvas 2D  | whole song | One building per bar; floors are instruments playing, windows are notes at their real place           |
| quilt         | Quilt         | Song     | Canvas 2D  | whole song | A row per section, a patch per bar, a ring per instrument; repeated bars sew identical patches        |
| graphic-score | Graphic score | Song     | Canvas 2D  | whole song | Proportional graphic notation of the whole song: pitch lines, drum marks, cutoff zigzags, room halos  |
| fireworks     | Fireworks     | Show     | Canvas 2D  | window     | Every note a shell bursting on its onset; held notes become drooping willows for their span           |
| light-rig     | Light rig     | Show     | three.js   | window     | A lighting truss: strobe for the most regular drum, floor wash for the lowest part, heads for others  |
| ribbons       | Ribbons       | Show     | three.js   | window     | Ribbons stream through a curtain of light at now; open where they play, turn when a setting moves     |
| headline      | Headline      | Show     | Canvas 2D  | window     | Instrument names as a giant poster: solid while sounding, hollow at rest, weight from gain            |
| ash-run       | Ash Run       | Arcade   | Canvas 2D  | window     | Dark rooftop runner: bass notes are rooftops, bass onsets are leaps, the snare is a barrier           |
| swarm         | Swarm         | Arcade   | Canvas 2D  | window     | Formation shooter: rows are instruments, the ship rides the playhead, held notes are carriers         |
| saucers       | Saucers       | Arcade   | Canvas 2D  | window     | Saucers zap on short notes and tractor-beam cargo up for held notes; rooms are motherships            |
| rimshot       | Rimshot       | Arcade   | Canvas 2D  | window     | A vector tube: notes climb their instrument's lanes and reach the rim on their onset                  |

"whole song" means `span: 'song'`; "audio" means `needs: 'audio'`. Roles such
as "the most regular drum" or "the lowest pitched part" come from the notes,
never from names. The arcade views take a genre's mechanics only; names, ships
and art are our own.

## Settled for this wave

- **Games have no simulation state.** Runner position, dives, explosions and
  particles are worked out from the notes and `now` alone, with randomness seeded
  by time, so scrubbing and stepping draw the same picture every time.
- **Déjà vu compares with the previous bar only.** Its "last time through"
  switch waits until views can own a setting; that is a contract change for later.
- **Graphic score is on screen only.** A poster download is a host feature for later.
- **Afterglow waits for Scope**, which brings the Studio's audio tap. It labels
  measured and scored apart and never infers a tail from settings.

## Step 0, before any view

One change, done alone and merged first:

- **Shared helpers** in `src/views/shared/`, replacing today's duplicates:
  - onset timing: previous and next onset at a time, progress through the
    current note, and the "launched one window ahead, lands on the onset" path;
  - pitch: one reader (today `retro-2d.ts` and `rain/geometry.ts` each have one),
    pitch class and triad names;
  - roles: one "most regular drum" and "lowest pitched part" finder (today in
    `runner/model.ts` and `night-drive/model.ts`);
  - setting ranges: each setting's range across the song;
  - song summary: who plays in each bar and how much each bar changed from the last;
  - time-pure particles: bursts, sparks, ash and stars from a seed and a time.
- **View shelf grouping.** The shelf's two-column grid holds today's 14 views.
  With 38 it groups tiles by the six groups above, each collapsible.

After step 0 the shared helpers are frozen for the wave. Views keep new helpers
local; promote them afterwards.

## Lanes

Six lanes run in parallel, each building its views one after another so lessons
carry within a lane. Every view is one pull request with the shared smoke test.

| Lane        | Order                                                  |
| ----------- | ------------------------------------------------------ |
| 1. Rhythm   | Metronomes → Déjà vu → Karaoke → Marble run            |
| 2. Pitch    | Chord star → Harmonograph → Harp → Graphic score       |
| 3. Settings | Catwalk → Tubes → Soundstage → Aquarium                |
| 4. Song     | Metro → Skyline → Quilt                                |
| 5. Arcade   | Swarm → Rimshot → Saucers → Ash Run                    |
| 6. Show     | Fireworks → Headline → Ribbons → Light rig → Afterglow |

Each brief names its mockup, its mapping rules and one end-to-end check on the
dubstep arrangement; the pitch lane also checks bar 18.

## Before the wave starts

- The browser suite must stop failing for timing reasons. The test-reliability
  fixes for the Studio transport, practice start-up, flood and Kiln rhythm tests
  land first; without them most view pull requests would be blocked by unrelated
  failures.
- Scope lands before Afterglow.
- The switch to the Studio as the main page can run alongside the lanes; views do
  not touch the page layout.

## Risks

- Ribbons and Light rig may cost too much GPU time; build them last in their lane.
- CI renders WebGL in software, which made Ring's motion check fail repeatedly
  while it was built. New view tests go through the shared smoke test and its
  readiness waits rather than writing their own.
- Each view adds a browser smoke test, and Studio browser tests run one at a time,
  so the suite grows by roughly 24 tests.
