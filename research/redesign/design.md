# Redesign: the Studio

Design reference for the redesign wave (D47). Evidence and intent, written by the
lead with the owner on 2026-11-15. The mockups in `mockups/` are hand-drawn
static pictures (they need a host page to render; read them as markup for exact
colours, sizes and copy). Where a mockup and this page disagree, this page wins.

## What it is for

The owner's words: the goal was a "wow, that's cool" experience and we shipped
something "utilitarian, sterile, joyless and clunky". The live views are the
point. This is supposed to be fun. Desktop only; accessibility and phone support
are not requirements (D45). Every brief states the effect it should have and the
owner judges by looking at it run.

What stays true (from `docs/model.md`): no assumed grid, notes are drawn from
their real spans; broken is never drawn as silence; nothing suggests a setting
processes the sound before it; one editor at a time; code we do not model stays
visible, playable and editable as text.

## Layout

One screen, no page scroll, designed for 1920x1080 up to 2560x1440 CSS pixels.
Sizes below are at 2560x1440; regions scale by flex, not by breakpoints.
Mockup: `mockups/Studio.dc.html` (its piece data is illustrative).

| Region          | Size            | Holds                                                                                                                                                                                                                             |
| --------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top bar         | full width x 52 | Wordmark; play/pause, stop, step back, step forward, loop; Speed (1/4, 1/2, 3/4, 1x); tempo and cycle readout; undo, redo, paste, keep work, help; theme swatches; links "Our source", "Strudel <version> source", "About / AGPL" |
| Scrub strip     | full width x 56 | The song as section blocks (or four-cycle pages when there are no sections); loop range; a draggable playhead knob                                                                                                                |
| Instrument rail | 300 x 760       | One row per playing instrument: colour dot, name, sound, level meter, mute. Resting instruments collapse to chips. Below: Window and Trails controls                                                                              |
| Stage A         | 1300 x 760      | The main live view                                                                                                                                                                                                                |
| Stage B         | 560 x 760       | A second live view                                                                                                                                                                                                                |
| View shelf      | 400 x 760       | Every registered view as a tile; click or drag onto a stage                                                                                                                                                                       |
| Score           | 2000 x 572      | One time lane per instrument, drawn on canvas                                                                                                                                                                                     |
| Tray            | 560 x 572       | The selected instrument: rewrites as a numbered chain, settings as tiles, custom functions                                                                                                                                        |

Below 2200 px wide, Stage B and the view shelf share one column (shelf becomes a
popover from a button on each stage).

## Time controls

- **Speed** slows the music: scales the tempo to 1/4, 1/2, 3/4 or 1x. The readout
  shows the actual and the written tempo.
- **Scrub**: dragging the playhead moves time by hand. Views follow immediately.
  While dragging, playback is silent; on release it continues from there if it
  was playing.
- **Step** moves one beat (a quarter cycle) back or forward while paused.
- **Loop** repeats a marked range of whole cycles.
- **Window** (1, 2, 4, 8 cycles) is how much time a scrolling view shows; more
  time on screen means marks travel slower. **Trails** (off, short, long) is how
  long a hit lingers. These two change only the picture.

## Themes

Five themes, switched at runtime by `data-theme` on the root, each a block of
CSS variables and nothing else. Arcade is the default. All five are in scope.

| Token        | Arcade         | Sunset              | Phosphor | Riso                | Pocket     |
| ------------ | -------------- | ------------------- | -------- | ------------------- | ---------- |
| ground       | #07060D        | #1A0B2E             | #020A04  | #F6F0E4             | #C9DB8E    |
| panel        | #12101F        | #2A1247             | #06180B  | #EAE1CF             | #B4C97A    |
| line         | #2A2545        | #4A2470             | #0F3A1C  | #1D1B2F             | #2F5D3A    |
| text         | #F4F1FF        | #FFE9F3             | #B8FFC8  | #1D1B2F             | #0F2A1D    |
| muted        | #A49EC4        | #D4A9D8             | #5FBF7A  | #4A4760             | #2F5D3A    |
| accent       | #FFD23F        | #FF9A56             | #00FF66  | #FF4F7B             | #0F2A1D    |
| display font | Space Grotesk  | Bricolage Grotesque | VT323    | Bricolage Grotesque | Silkscreen |
| mono font    | JetBrains Mono | JetBrains Mono      | VT323    | JetBrains Mono      | Silkscreen |
| radius       | 10 px          | 12 px               | 0        | 4 px                | 0          |
| glow         | yes            | yes                 | yes      | no                  | no         |

Instrument colours, in row order, repeating with a lighter tint after the last:

- Arcade: #FF4D8D #FFD23F #3DDCFF #5BFF8F #B388FF #FF8A3D #6FA0FF #E8A0D8
- Sunset: #FF5E99 #FF9A56 #FFD166 #6EE7E0 #9B8CFF #FF7AD9 #7BD3FF #C6F27A
- Phosphor: #00FF66 #9DFFB8 #00B84A #FFB000 #5CFF9D #C8FF5C #00E0A0 #FFD27A
- Riso: #FF4F7B #2F5BEA #FFC400 #00A66C #FF7A1A #8A4FFF #00A0C6 #C2185B
- Pocket: #0F2A1D #2F5D3A #4E8046 #6E9A4E (four shades only; views separate
  instruments by position and pattern, not hue)

Fonts are bundled (no network font requests). Mockup: `mockups/Themes.dc.html`.

## A view is one file

Each `ViewInstrument` includes document-ordered `settings` (control name, editor
label, constant/values/signal/other kind and optional constant value), ordered
`rewrites` labels and a known `room` orbit or null; the host caches these facts
per document. “Moving” means sampled values that differ from note to note:
Strudel samples a continuous setting signal once per note, so `ViewNote.value`
carries one value throughout that note, not a sweep within it. Querying the real
dubstep wobble bass at cycles 10.2 and 10.7 returns the same cutoff, about 1370.

A view's browser test is the shared smoke only, registered with
`viewSmoke(test, 'view-id')` from `tests/browser/view-smoke.ts`.
Frame cost and theme sweeps are measured locally with `npm run measure:views`
and reported in the pull request, never gated.

`src/views/<id>.ts` default-exports a `ViewDefinition`. A registry discovers the
files, so adding a file adds a view to the shelf. Views never import Strudel,
the engine, the document or React. The host owns the animation frame, resizing
and theme changes and calls `frame` with everything the view may draw from.

```ts
export interface ViewNote {
  instrument: string; // ViewInstrument.id
  start: number; // absolute cycles
  end: number;
  hasOnset: boolean; // false for a fragment or a continuous signal
  value: Record<string, unknown>; // the note's settings
}
export interface ViewInstrument {
  id: string;
  name: string;
  index: number; // row order
  colour: string; // resolved CSS colour for the current theme
  sounding: boolean;
  inSection: boolean;
  muted: boolean;
}
export interface ViewTheme {
  name: string;
  ground: string;
  panel: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  fontDisplay: string;
  fontMono: string;
  radius: number;
  glow: boolean;
}
export interface ViewFrame {
  now: number; // absolute cycles, fractional, already latency-corrected
  playing: boolean;
  cps: number; // cycles per second actually playing (after Speed)
  notes: ViewNote[]; // every note overlapping [from, to]
  from: number;
  to: number; // the stretch of time the host has asked about
  instruments: ViewInstrument[];
  sections: { name: string; from: number; to: number }[]; // empty when none
  rooms: { orbit: number; members: string[] }[];
  lookAhead: number; // the Window control, in cycles
  trails: 0 | 1 | 2;
  theme: ViewTheme;
  width: number;
  height: number;
  dpr: number;
  audio?: { wave: Float32Array; spectrum: Uint8Array }; // only for needs: 'audio'
}
export interface ViewHandle {
  frame(frame: ViewFrame): void;
  dispose(): void;
}
export interface ViewDefinition {
  id: string;
  group: 'rhythm' | 'pitch' | 'settings' | 'song' | 'show' | 'arcade';
  name: string;
  tag: string; // one or two words for the shelf, e.g. "whole song"
  needs?: 'score' | 'audio'; // default 'score'
  span?: 'window' | 'song'; // 'song' asks the host for the whole song
  mount(el: HTMLElement): ViewHandle | Promise<ViewHandle>;
}
```

Rules: a view must draw correctly for any `now`, in any order (scrubbing and
stepping call `frame` with arbitrary times); it keeps no clock of its own; it
must be correct with 1 instrument and with 20, and with 500 notes per cycle
(degrade to occupancy, never drop silently); `dispose` releases everything.
3D views `await import('three')` inside `mount`. Others use Canvas 2D.

## The views

Mockups show the dubstep arrangement (`corpus/programs/real-dubstep-arranged.strudel`)
at bar 11, 40% through the bar. Mapping rules are the design; pixel positions in
mockups are illustrative.

| id            | Name          | Draws with | What it shows                                                                                                                                                                                     | Mockup       |
| ------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| ring          | Ring          | three.js   | One turn is one cycle. Concentric bands, one per instrument, turning past a fixed white gate at the top. Played part dims, sounding notes glow. Cycle number in the centre                        | Main, Studio |
| tunnel        | Fly-through   | three.js   | The current cycle is the nearest ring; the next `lookAhead` cycles recede ahead in perspective. A section change ahead is visibly different                                                       | Tunnel       |
| coil          | Coil          | three.js   | span song. One loop per cycle, side by side, the playing loop enlarged. Section names under brackets                                                                                              | Coil         |
| constellation | Constellation | Canvas 2D  | A disc per instrument with its rhythm this cycle as a ring inside it; settings in use as moons (filled when the value is moving); rewrites as numbered squares; rooms as tinted regions. No wires | Now, Studio  |
| rain          | Rain          | Canvas 2D  | Notes fall down a tilted highway to a bright line and land when they sound, with a ripple. One lane per instrument; pitch shifts a note sideways within its lane                                  | Rain         |
| loom          | Loom          | Canvas 2D  | span song. One thread per instrument across the whole song; a thin line where it rests, pattern where it plays                                                                                    | Loom         |
| ridges        | Ridges        | three.js   | Filled cycle mountains: fixed asymmetric per-note peaks joined at saddles; ground only in rests. Lit spires, coloured faces, section labels and eased slides; no within-note sweep                | Ridges       |
| tracker       | Tracker       | Canvas 2D  | Scrolling text columns, one channel per instrument, sixteen rows per cycle, note / instrument / effect cells, the playing row highlighted                                                         | Tracker      |
| runner        | Runner        | Canvas 2D  | A pixel side-scroller. The song is the level: drum hits are blocks, crates and coins, the lowest pitched instrument sets the ground height, a character runs at the playhead                      | Runner       |
| night-drive   | Night drive   | three.js   | A sunset grid road. Tempo is speed. The most regular drum is gates over the road, others are billboards and lane marks, a moving setting shapes the hills                                         | NightDrive   |
| band          | The band      | Canvas 2D  | Every instrument is a blob with a face. Whoever is sounding opens their mouth and jumps; resting ones wait backstage                                                                              | Band         |
| scope         | Scope         | Canvas 2D  | needs audio. A CRT oscilloscope trace and spectrum from the output tap                                                                                                                            | Scope        |
| piano-roll    | Piano roll    | Canvas 2D  | The Strudel classic: pitch up, time across, playhead fixed                                                                                                                                        | none         |
| punchcard     | Punchcard     | Canvas 2D  | The Strudel classic: one row per instrument, dots for onsets                                                                                                                                      | none         |

First four to build: ring, rain, loom, band.

Roles such as "the most regular drum" or "the lowest pitched instrument" are
chosen from the notes, never from names, so every view works on any piece.

## Score and tray

Lanes are canvas, one per instrument, time across, with model-based hit testing.
A row shows the instrument name and two counts ("2 rewrites", "7 settings"),
never a column per setting. Instruments resting in the section collapse to a
thin row with a mini map of the sections they play in. Selecting a row opens the
tray: rewrites as a numbered chain with arrows (order matters), settings as
tiles in a grid (order does not), functions the piece defined itself marked as
custom with their source one click away. Selecting a tile opens the existing
editor for that setting in the tray. A setting whose value moves can be opened
as its own lane under the instrument.

Generated instrument names come from the sound ("bd", "supersaw 2"), never
"Instrument 3".

## Technology

React 19 with shadcn/ui components copied into `src/components/ui/`, Tailwind 4,
lucide icons. The Studio lives in `src/studio/` as a second page (`studio.html`)
beside the current one until cutover. State comes from the existing controller
through `useSyncExternalStore`; no state library. The playhead, pointer motion
and drawing stay out of React state. Logic directories (`document`, `import`,
`generate`, `engine`, `strudel`) stay framework-free.
