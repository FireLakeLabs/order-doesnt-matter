# Two maps, one editor

**Recommendation: both, with Score sheet as the default.** Use it to find and
compare settings at 20 voices. Use Constellation to understand ownership,
shared rooms and shell levels. Its spatial cost is substantial; search is
necessary at scale. Neither view should become a sound-flow diagram.

| Task                          | Constellation                                                                | Score sheet                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Find `shore › lpf`, 20 voices | 3 actions: focus search, type `shore lpf`, click exact result                | Same 3 actions; no horizontal hunt required                                 |
| See room membership           | Soft region encloses sending planets; conflict labelled explicitly           | Room column repeats room/conflict; horizontal scroll needed                 |
| Understand nested drivers     | Moons of moons communicate ownership; deep detail needs inspector            | `↳ inspect driver`, then named argument links; less immediately legible     |
| Understand rewrites           | Labelled shells, inside out; bag moons retain their layer number             | Ordered chips; inspector includes before/after and intervening bags         |
| Growth                        | Collapse/search prevent navigation becoming impossible; long vertical travel | Sticky names/headers, separate group-leaf rows, reorder, mute/solo/collapse |
| Coverage                      | 72/72 render at cycle 0                                                      | 72/72 render at cycle 0                                                     |

The importer became available and passed its **37 acceptance tests**; the active
adapter now uses it, not the fallback. All 72 programs and paste are available.
[The per-program table](CORPUS.md) records rendering, labels, selection coverage
and structural observations; [raw results](corpus-coverage.json) include targets
reachable only through search/inspection. No document node lacked a selection
target or label. This establishes access, not that every node is visible at once.

| Program(s)                                                      | What breaks down / qualification                                                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `micro-query-throws`                                            | Both show BROKEN instead of a silent result                                                                          |
| `micro-query-late-throws`                                       | Cycle 0 succeeds; intentional failure begins at cycle 3, confirmed by importer horizon results                       |
| `micro-dense-64`, `micro-dense-stack`                           | Both become visually dense; each miniature caps drawing at 400 queried parts, while counts retain the complete query |
| `micro-callback-deep`, `micro-callback-off`                     | Constellation exposes the outer shell, not the complete callback topology; inspect named arguments/source            |
| `micro-tree-arrange`, `micro-arrange-300/301`, `piece-*` groups | Both expand leaves with actual group timing; inactive branches are empty in this cycle, not absent from the piece    |
| `micro-bare-strings`                                            | Importer reports opaque function values: event projection matches, full equivalence remains unproved                 |

**The owner's complaints.** (1) You can still make an undesirable score by
repeated splitting or editing source, but cannot accidentally rearrange moons
into knots. Undo/Redo restores document edits; Done/Escape exits focus; Fit
recovers the camera. Merge deliberately keeps the first child, so Undo matters.
(2) Named breadcrumbs, one active editor, units, level labels and dim context
lanes clarify what changes. Arbitrary callbacks and unfamiliar controls still
need inspection; first-time usability is an agent judgment, not an owner test.
(3) The sheet holds up better at 20 voices. Constellation remains navigable,
but cannot show 20 expanded planets legibly at once. Phone layout uses one
planet per row and a full-width editor.

Three screenshot critiques led to fixes: clipping and competing labels; phone
framing and overlapping room regions; then driver crowding and composite sheet
rows. Final contact sheets cover every editor at 3/8/20 voices and phone width.

The document shape is awkward around typed rhythm nested inside a `note`/`s`
argument, unnamed group parts, mute state only on top-level voices, and lack of
control units/ranges. Rest also discards its former value. I would add semantic
selection roles, group-part names/mute metadata, argument names and a registry
of units. Row reordering stays presentation-only so it cannot reorder `cat`.
The importer extended the draft with structured data, evaluation order and
global transforms; the editor consumes those types explicitly.

**Checked:** build; 17 Node behavior tests against real Strudel; browser edits,
undo, error recovery, signal handles, registry additions, locked maps, selection
retention, and scheduler dispatches for immediate/aligned swaps. The subgroup-weight and added-voice regression tests failed before their fixes.
Browser suite:
**21.70 s** plus **1.72 s** pointer checks; corpus: **11.26 s**,
combined **34.67 s**, built copies on
free ports, zero browser exceptions. Screenshots total under 6 MB.
**Not heard:** any audio. Event logs and dispatched revisions establish score
changes and pending-state timing; they do not establish speaker latency,
smoothness, audible tails, remote sample availability, or physical-phone feel.

## Study 02: real input

Real imports are now the default material. Thirteen attachment blocks were
extracted verbatim; the sample usage snippet is marked separately. Switch Angel
is available locally but has no clearly recorded redistribution permission, so
its source is read at runtime and never bundled. No audio was heard.

Author const names survive, including single-use definitions. Instrument and
section comments survive as optional `Pattern.comment`; names use optional
`Pattern.label`. Unnamed instruments get unique content-derived names. Both maps
show one shared instrument across its section occurrences. The compact timeline
shows ordered sections, cycle lengths and current position; clicking jumps the
query and, while playing, restarts scheduling there. The editor distinguishes a
shared edit from a section variation. A failing test also caught old aligned
swaps reading the new shared definition; old bindings are now isolated.

The sheet has consistent **110 px rows**, actual pitch/sample tracks for chords
and stacks, value bars with units, and curves from 64 real driver queries per
cycle. Columns rank by instrument usage; rare settings unfold behind “more”.
Inactive instruments retain their values and say “not in this section”; rests
and query failures have separate states. Nested drivers say “open”, with a
breadcrumb and one editor.

Constellation reserves space for headings, shell labels and driver links.
Bounded ring spacing and collision-avoiding moon placement replace level tags.
Rhythmic settings retain their ring ownership; constants share the outer orbit.
Friendly setting names have Strudel names and explanations on hover/focus.

Four screenshot rounds, compared in [shots/v2](shots/v2/README.md), exposed what
fixtures hid: anonymous arrangement paths, duplicated instruments, unrelated
settings repeated in every row, browser binding collisions, missing host
parameters, chord overdraw and long rewrite chains escaping the canvas.

Still poor: Constellation wastes space on sparse instruments and needs scroll
or search at 12–20 voices. Composite cells aggregate part values; opening the
group exposes separate edits. Eight visible pitch tracks / 400 drawn parts
bound dense miniatures. General transformed/nested arrangements remain less
explicit than these top-level songs. No novice usability session was performed.

**Checked:** 43 importer tests; 23 editor Node tests; TypeScript/build; all
85 corpus maps. Combined browser gate **45.11 s**: real-input checks 4.44 s,
existing editor behavior 24.53 s, pointer checks 2.60 s, corpus audit 13.54 s
(including child startup). Dispatched onsets/phase were observed; sample access,
physical output, acoustic continuity and tails were not established.

## Fixes after owner testing

**Silent samples.** The browser's original sound registry contained synths but no
`bd`, `hh` or `cp`; the pinned `@strudel/web` README explicitly says external
samples are not loaded automatically. The engine now prebakes the documented
[default collections](https://github.com/felixroos/dough-samples#usage) plus the
complete Dirt set (deterministic registration order), executes `Doc.setup` sample
setup through Strudel's transpiler, and checks both registration and decoded
files. Loading / Ready / Missing, including the sound name and failure detail,
are visible on every instrument in both maps, the sidebar and its editor. Actual
trigger values are checked too, for sound/index changes beyond the preview window.

**Wrong mute.** A pending query left old rows clickable after the current document
changed: House's clap row ID `n4` addressed Techno's kick **shape driver**, and the
old general-purpose toggle injected a silence layer into that driver. Mute also
lived in opaque source layers and had inconsistent visual readback. New rows now
replace old rows immediately, stale handlers are rejected, and mute accepts only
canonical instruments; typed node mute state is generated and re-imported without
turning it into opaque document source. Shared instruments mute everywhere; IDs
remain stable within a document, and history, edits, sections and map switches
retain the state. [Before](owner-regressions-before.json) /
[after](owner-regressions.json) capture the same real-pointer regression with
query delivery delayed by 250 ms; the before run lost kick events without showing
any muted row. The new Node tests also failed on the original representation.

**Neighbours.** Solo stays temporary and clears when another piece is loaded;
reorder and collapse leave generated source unchanged. A next-cycle mute no longer
waits forever for its own nonexistent onset: its pending badge clears at the
scheduling boundary. Both pieces passed real-click mute-two / unmute-first,
section/cycle jump, map switch, undo/redo, solo, reorder, collapse, and Apply now /
next-cycle dispatch checks. Pending starts are invalidated when transport stops
or another document is loaded. Scroll and unfinished field input survive status
refreshes.

**Measured, not heard.** A 48 kHz AudioWorklet tap at Superdough's output captured
two onsets of each isolated Techno drum with the bass and other drums muted. In
100 ms windows starting 5 ms after the scheduled onset, stereo RMS ranges were
`bd` 0.44308–0.44340, `hh` 0.01454–0.01637,
and `cp` 0.13118–0.13185; the first onset of each also exceeded
its pre-onset background RMS by more than 3×. This proves non-silent rendered PCM,
not physical speaker output, acoustic quality, smooth edits or audible tails.
The forced-offline run reported **not checked: offline**, verified Missing names
in the UI, and made no audio-energy claim.

[Every program's sound list](SOUND-AUDIT.md) / [raw sound checks](sound-audit.json):
85 programs, 15 available names; only `myvocal` in `real-custom-samples` fails
default resolution (the source has a placeholder URL). No corpus piece uses
`.bank(...)`; the standard drum-machine collections are nevertheless registered.
`micro-query-throws` and `micro-query-late-throws` deliberately fail queries and
remain explicitly marked; no successful full-window query is claimed for them.

**Final verification:** 30 editor Node tests (**3.80 s**), 43 importer acceptance
tests (**5.89 s**), TypeScript/build, real screenshots inspected, and the complete
browser gate **77.65 s** including the owner checks (**23.15 s**)
and forced-offline check (**0.69 s**). Pure Node audit queries run alongside
the browser checks and finish before registry resolution.
[Browser evidence](owner-browser-results.json), [offline evidence](owner-browser-offline.json),
and [gate timings](browser-suite-study02.json) record the assertions and durations.
`dist/` was rebuilt. No audio was heard; nothing was committed or pushed.


## Study 03: constellation, last attempt

**Recommendation: keep only the system inset.** Both alternatives remain runnable
for comparison; the Score sheet remains the default.

The full map now has content-sized systems, nested driver disks, shared room
regions with settings and explicit `conflict`, ordered shells, semantic
Far/Middle/Near, double-click/pinch navigation, search-to-owner, and one planet per
shared instrument. Real queried event spans and the engine clock drive the
playhead and restrained onset halos. Signals show their queried current values.
Inactive instruments dim and shift outward on section changes; nothing wanders
continuously. Mute/solo, sound readiness and the existing single editor remain.
The sheet's inset shows that editor's instrument, nested settings and shells,
plus its room and named neighbours.

Four screenshot rounds changed the design:

1. Removing cards exposed separate room puddles, an overlapping inset and bad
   selection text.
2. Continuous room regions and an adjacent inset restored belonging, but cluster
   packing wasted space and near view included distracting neighbours.
3. Focused dives and composite ownership exposed oversized child systems and
   stretched values in the real arrangements.
4. Content-sized children, tighter room packing, stable moon angles and
   screen-sized far labels made 20 planets fit desktop and phone without map
   scrolling. Final refinements fixed phone overflow and reduced-motion handling.

**For the full map:** room membership, conflict and current-section participation
are much clearer. The short real-clock frame sequence looked calm: small onset
halos and one section drift, without perpetual motion.

**Against:** far hides ownership and shell detail; middle makes dense real pieces
and 20-voice settings too small. Near restores those jobs by becoming a selected
system view. The inset supplies that explanation where editing happens, without
another camera. Dense phone insets still require selection/inspection.

[Before/after, all four rounds and motion evidence](shots/v3/README.md) cover the
four owner pieces, local Switch Angel, conflict micro and 20 voices; about 4.5 MB.
**Checked:** 38 Node tests (3.41 s), TypeScript/build, all 85 corpus maps and
the complete browser gate (86.55 s), including owner regressions, both apply
modes, forced-offline sound state and reduced motion. Pure tests cover stability,
separation, full-footprint room membership, shell ownership and far-fit bounds.

**Not judged:** hearing, audible tails/continuity, physical-phone gestures,
long-session fatigue, or first-time clarity tested on people. No audio was heard.
