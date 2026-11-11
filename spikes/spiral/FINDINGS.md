# Spiral: beautiful locally, lossy globally

**Primary: ring focus, paired with the cycle strip.** The helix is useful spatial
context, but looking down it does not remain a readable score. Fifteen real
Strudel programs were queried; all three views share those haps. No audio was
played or heard.

These are **judgments by eye**, from the final 1440×1000 screenshots (including
three contact sheets). “Yes” means the visible turn can be read; it does not mean
the entire program is understood without scrubbing or inspecting settings.

| Stress program | Fly-through | Ring | Coil | Why / remaining loss |
| --- | --- | --- | --- | --- |
| Three-cycle garden | partly | yes | partly | Radius exposes alternation; depth overlaps the turns. |
| Every fourth turn | partly | yes | partly | Fourth-turn structure is clear; coil occludes exact onsets. |
| Polymeter | partly | yes | partly | Coloured voices separate locally; phase crossings overlap in depth. |
| Deterministic randomness | partly | yes | partly | Real missing onsets remain legible locally; distant gaps merge. |
| 64-cycle arrange | partly | yes | partly | Ring reads the selected chapter; strip reveals chapter boundaries; coil is tiny. |
| fast(64), 512 onsets/cycle | no | partly | no | Occupancy remains visible, individual creatures do not. |
| chop + striate | no | partly | partly | Inner drum lanes crowd; grain settings require inspection. |
| Chords + stacked voices | partly | yes | partly | Pitch fans and sound colours help; rear voices overlap. |
| Sine cutoff + Perlin pan | partly | partly | partly | Headless bands stay distinct, but subtle modulation is small. |
| Bare values | partly | partly | partly | Values remain categorical creatures; identities require hovering. |
| Long overlapping notes | partly | yes | partly | One head plus dotted continuations; coil seams remain ambiguous. |
| Full six-voice piece | no | yes | partly | Ring and voice focus work; tunnel becomes a woven mass. |
| Extra / multi-value controls | partly | partly | partly | Colon values normalize; arrays/functions lack dedicated encodings. |
| Unclosed horizon | partly | yes | partly | Local events read; no finite window establishes a repeat length. |
| Heard versus scored length | no | partly | partly | Offset whiskers distinguish estimates, not actual sample/effect tails. |

At **128–256 raw onsets/cycle**, onset shapes become hard to distinguish; at 512,
short arcs are only a few pixels. This is a screenshot judgment, not a measured
perceptual threshold. Auto detail switches above 128 parts to 64 time bins per
sound/three-semitone group. Gaps and intensity preserve occupancy; exact onsets
and durations are lost. Raw mode and close zoom restore individual haps. Voice
focus reduces polyphonic competition.

Ring shows three turns; fly shows up to 15 including its trailing ghost. About
12–16 coil turns retain useful shape; 64 fit as an overview, and 256 fit but are
not a readable score. Arbitrary start/window queries handle nonrepeating scores
without inferring or caching a purported period. Travel explicitly stops at the
horizon instead of replaying it; this specimen does not prove nonperiodicity. Amber means “different from the
previous queried cycle,” including a comparison just outside the window.

Two screenshot-driven revisions corrected clipped coil framing and clutter,
then added explicit time/pitch references, voice focus, zoom detail and clearer
signal bands. Pass 1/2/3 screenshots retain the evidence.

**Measured:** see `measurements.json` for five interleaved frame windows/view,
real hap counts, query time, load time, CPU render submission and failures.
Chromium 158 / ANGLE SwiftShader, Ryzen 6850U (16 logical cores): 225 windows
completed in 134 seconds, with zero browser/request failures. Frame medians were
16.7 ms for 44 cases; the 64-turn arrange coil was 33.3 ms (five medians
33.2–33.3). CPU draw medians were 0.4–1.4 ms. Single query evaluations ranged
12.3–271.6 ms; the largest program returned 6,144 onsets.
Software rendering and concurrent sibling work limit generalization; frame
intervals include scheduling and GPU work, while draw times do not measure GPU
completion. Browser assertions cover determinism, fragment onsets, failures,
clock/camera travel, mouse and touch. No audible-tail claim was tested.

Next: add selectable angular magnification; unroll a selected phrase into parallel
lanes beside the ring; give signal lanes scales and per-control inspection.

| Dark-corner row | Verdict | Evidence / limit |
| --- | --- | --- |
| T1 | shown | Alternation, every(4), slow and polymeter queried across cycles. |
| T2 | shown | Real deterministic random haps and sampled Perlin; repeat query asserted. |
| T3 | shown degraded | 64-cycle arrange; 256-cycle overview loses detail. |
| T4 | shown | Finite addressable horizon, no repeat-length inference. |
| E1 | shown | No-whole haps produce bands, never onset heads. |
| E2 | shown | Mid-note window gives zero onsets and two continuations. |
| E3 | shown | Chords, unison multiplicity and long-note continuation tracks. |
| E4 | shown degraded | Density requires occupancy or local zoom. |
| E5 | shown degraded | Bare values preserved; categorical identity needs hover. |
| C1 | shown degraded | Selected controls encoded; full bag inspectable, no 411-control schema. |
| C2 | shown degraded | Colon normalization and arrays retained; functions shown opaque, not visualized. |
| A4 | shown degraded | Clip/release whisker estimates; actual heard tails out of scope. |

## Study 02: finding now

Fly-through is now for watching. Four screenshot rounds covered the six-voice
piece, three-cycle alternation, every(4), polymeter, and 512-onset program. I tried
strong depth falloff, a luminous present plane/rim, thicker full-colour current
spans, disappearing past turns, and a short horizon. I kept them together, with
four turns ahead by default and a control reaching fourteen: dimming alone did
not locate now clearly enough by eye.

The white gate names active sounds in their colours. Actual scored spans light
for their duration, swell at onset, and carry bright playhead beads independently
of occupancy aggregation. Continuous lanes get current-value beads. Upcoming
spans are calmer; completed spans fade. Fly-through separates sound names into
radial bands; focus ghosts the rest visually. Ring and coil share the present
cues. Camera gestures remain navigation, with no draggable score handles.

The first central readout covered drums; moving names beside the gate helped.
A fourth pass moved left-side labels outside the rim. Audio starts behind Play
using pinned @strudel/web and its scheduler clock. A mid-span restart re-attacks
the remaining duration. Local bd/sd/hh percussion substitutes are disclosed.

Still limited: dense occupancy loses exact onsets; branches sharing a sound
share a band/focus target; effect tails and prior oscillator phase are not
reconstructed. Readability and one-second recognition were judged by eye, not
measured with viewers. No sound was heard.

Measured: clean-install build passed; full browser coverage took 133.8 s and
focused built-bundle checks 7.1 s, with no page/request failures. Mid-note restart
and synchronized readouts had failing-before/passing-after regressions. The
1280×720 H.264/AAC recording is 46.56 s, 9.95 MB; independently decoded start/end
A/V residuals are +20.0/−6.6 ms, with zero clipped decoded samples. Fourteen capture
gaps exceeded 80 ms (maximum 266 ms), visibly captioned. Evidence: `shots/v2/`,
`measurements-study02.json`, `study02-checks.json`, and the recording’s metrics.

## Owner notes after trying Study 02 (2026-11-11)

Better. Two things to tune during implementation, not now:

- The turn just played blinks out; it should fade. The right duration is
  unknown, only that the current one is abrupt.
- In fly-through the upcoming turns are so faint they almost do not register.
