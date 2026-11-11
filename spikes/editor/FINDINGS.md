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
