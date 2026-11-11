# Study 03: constellation, last attempt

**Recommendation: keep the system inset; retire the full constellation as a second working map.** Both implementations remain available in this prototype for the owner to compare. The Score sheet is still the default.

Open [the gallery](index.html) for all comparison pairs, [the short review](review.html) for three examples, and [the motion sequence](motion.webp) / [frame index](motion-contact.jpg) for playback and a section change. All captures came from built copies, using real Strudel queries. Nothing was heard.

## Reading the evidence

`before-<piece>-far|middle|near.jpg` captures the former card map at three camera scales. The old implementation had no semantic detail levels: these are approximately comparable scales, not claimed equivalent behavior. `before-<piece>-inset.jpg` shows the former sheet editor, without an inset. `before-<piece>-phone.jpg` records the former phone map.

`after-<piece>-far|middle|near.jpg` shows the final semantic levels. Near chooses the largest system when no instrument has been focused; double-clicking a planet chooses that planet instead. `after-<piece>-inset.jpg` selects the first real setting in the piece and shows its instrument's own system beside the existing editor. `after-<piece>-phone-<level>.jpg` and `after-<piece>-phone-inset.jpg` use 390 × 844 CSS pixels. Desktop captures use 1440 × 1000.

Material: Techno sketch, House with vocals, DnB arrangement, Dubstep arrangement, the local Switch Angel piece, room-conflict micro, and the 20-voice fixture. Switch Angel files include `switch-angel` in their names, so the existing repository ignore rule excludes them. Its source was read locally and was not added or bundled.

Each `round1`–`round4` contact image contains far, middle, near, phone far/middle/near, and the inset. Round 4 also contains the phone inset. Intermediate originals were inspected before being reduced to contacts to keep this directory under 6 MB. Final and baseline comparisons retain their original capture dimensions. Contacts are an index; use the final images to judge text.

## Four screenshot rounds

1. **Round 1: remove the cards.** Content-sized systems, nested driver disks, semantic camera, and the inset replaced the fixed grid. Sparse Techno instruments improved, but separate circular room washes still looked like puddles. The inset overlapped the editor, and selection inherited a text stroke.
2. **Round 2: restore shared regions.** Continuous convex room regions replaced separate washes; explicit conflict labels and shared settings returned. The inset became adjacent and selection text was repaired. Room membership was clearer, but circular cluster packing left large gaps. Near view included distracting cut-off neighbours.
3. **Round 3: expose composite ownership.** Near became a focused system with a room/member caption; inner instrument parts and nested signals were included. Real DnB and House showed that composite sub-systems were themselves oversized. Long values stretched rather than merely fitting, and room clusters still wasted space.
4. **Round 4: spend space on content.** Smaller composite sub-systems, fitted values, tighter packing of room footprints, and screen-sized far labels made 20 planets fit on both widths. Moon angles now depend on preceding contents, so appending a small setting does not rotate every existing moon. Final refinements removed a phone overflow, kept the inset out of the toolbar, corrected outward drift about the scene centre, retained the existing state-label hook, and made playback screenshots independent of DOM replacement.

## What this implementation establishes

- One planet per canonical song instrument, independent of section reuse. Section absences dim and shift outward by 12 scene units over 700 ms; there is no idle wandering. Reduced-motion preference suppresses the spatial transition and pulse expansion.
- Planets show actual current-cycle event spans, a moving clock mark, and a 160 ms onset halo with at most 2 scene units of expansion. Mute/solo suppress halos. These are scored onsets, not a claim about release or room tails.
- Signals, including signals nested in driver arguments, are queried at 64 real times per cycle. The displayed current value uses the same engine phase. No assumed rhythmic grid is introduced.
- Constants share an outer orbit; rhythmic settings retain their ordered shell ownership. Nested disks express ownership; no connecting paths imply sound flow.
- Room membership follows positive delay/reverb sends and orbit values, including nested instrument parts. Regions state `conflict`, list parameter disagreement, and predict no winner. Inactive instruments remain part of the piece's potential room membership; this is not a measurement of a room's instantaneous audible state.
- The inset contains only the selected instrument, its settings/drivers/shells, and a textual room summary naming other members. Selecting inside it changes the existing editor and breadcrumb. On phone it sits above the editor; dense systems remain small and rely on selection/inspection.

## Verification and limits

Pure scene tests cover value/mute/small-addition stability, system and moon separation, full-footprint room enclosure/exclusion, shell ordering, nested containment, actual onset timing, shared identities, and camera bounds for 20 instruments. Browser checks additionally measure actual desktop/phone fit, double-click/back, search-to-owner, inset navigation, current signal values, onset pulses, section transitions, and all existing editor/owner checks.

The final run passed **38 Node tests in 3.41 s** and the combined browser gate in **86.55 s**, below the 90-second cap. Vite built the final bundle in 2.40 s; that figure excludes the preceding TypeScript/import preparation. `dist/` is rebuilt. The new scene browser checks took 7.52 s including process startup. Independent real-input and pointer checks run concurrently, with every child included in the same wall-clock limit.

Timings and assertions are in [the Node log](../../study-03-node.txt), [the full browser gate](../../browser-suite-study03.json), [scene/browser checks](../../study-03-browser.json), and [clock/frame data](../../study-03-motion.json). The build log is [here](../../study-03-build.txt). Motion capture is separate from the bounded regression gate: `CAPTURE_MOTION=1 node study-03-browser.mjs`. The animated copy uses a fixed 200 ms frame cadence for inspection; actual engine phases are recorded in the JSON. Still frames cannot establish a precise frame-rate or perceptual fatigue threshold.

**For retaining the full map:** far view now clearly groups rooms, distinguishes section participants, and shows the piece's onsets without scrolling. Near view makes ownership and rewrite shells visible.

**Against:** far hides ownership and shell details; middle shrinks the dense real arrangements and the 20-voice settings below a comfortable reading size. Near recovers those jobs by becoming a selected-system view. The inset provides that same local explanation at the point of editing, without a second camera. The phone inset also needs selection/inspection for dense systems. The full map has not earned another permanent navigation mode.

No first-time human clarity test, physical-phone gesture test, hearing, acoustic continuity, tails, or long-session fatigue judgment was possible. The short sequence looked calm to this reviewer; that is a limited visual judgment, not a user study.

## Reproduce

From `/home/aaron/projects/order-doesnt-matter/spikes/editor`, using Node 24.22.2 and npm:

```sh
npm ci
npm test
npm run build
npm run test:browser
npm run serve
```

The server chooses a free port and prints its URL. `npm run dev` also uses a free port. Recreate final captures with `ROUND=after node study-03-shots.mjs`. Intermediate capture rounds each run separately; they are design evidence, not additional work hidden inside the 90-second regression gate. No commit or push was made.
