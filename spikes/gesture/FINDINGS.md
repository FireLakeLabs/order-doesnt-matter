# Gesture spike findings

**D2 works.** Touching the picture changes an app-owned document, generates
fresh Strudel, and changes queried events. Visual manipulation responds within
roughly one to three frames here. Sound is less immediate: the controlled gain
gesture's first changed note was dispatched after **71.0 ms**, targeting audio
**334.1 ms** after input. Adding Chromium's reported 50.7 ms base/output latency
estimates **384.8 ms** to output. **I cannot hear audio**; these are timestamps,
not speaker measurements or proof against clicks.

All rows passed document, source, and real Strudel event assertions. “Feel” means
inspected visual feedback. Latencies are trusted input `timeStamp` → completed
REPL pattern swap, median / maximum, milliseconds; “single” means one sample.

| Gesture | Worked / visual judgment | Mouse swap ms | Touch swap ms |
| --- | --- | ---: | ---: |
| Turn, snapped / free | Yes; old-position ghost anchors movement | 7.8 / 14.2; free 5.1 single | 24.5 / 25.4, snapped |
| Radial pitch | Yes; predictable, subtle radial travel | 2.4 single | 25.3 single |
| Tap rest and back | Yes; dashed rest remains touchable | 1.7 / 2.9 | 22.7 single, rest |
| Edge split | Yes; subdivision appears during pull | 4.6 single | 26.0 single |
| Edge merge | Yes; nested pair collapses | 3.4 single | 25.8 single |
| Stepped paint | Yes; filled sweeps have no sampling holes | 7.4 / 15.5 | 21.0 / 22.9 |
| Curve paint | Yes; interpolated brightness lane | 7.8 / 16.6 | 23.5 / 24.9 |
| Speed | Yes; two radial wraps; wheel ×2/÷2, pinch ×2 | 32.7 / 32.5, one each | 29.8 single, pinch |
| Echo pull | Yes; distinct ghost ring; angle/distance independent | 8.5 / 16.7 | 20.8 / 21.8 |

**Scheduler evidence.** Installed `@strudel/core/zyklus.mjs:7–29` uses a 50 ms
query quantum, 100 ms interval, and 100 ms overlap: **200 ms lookahead**.
`cyclist.mjs:16,64–65,83–85` adds **100 ms** trigger latency: roughly a 300–350 ms
committed horizon (including the query quantum), plus time to the next affected onset and output latency.
The playhead inverts that target-time equation against the audio clock; its test
error was below 1e-14 cycles.

**Live swaps.** Every pointer move evaluates, serialized without restarting the
clock. In the 2.4-second identical-source stress segment, **99 evaluations**
(~41/s) took **8.4 ms median, 18.4 ms maximum**; 16 logged onsets had **zero
missing, duplicate, or late triggers**. This rate is acceptable for this piece;
120/240 Hz input and physical mobile hardware remain untested. Already scheduled
notes retain old values; editing a sustained note does not retrigger it. A real
Cyclist test proves a shift can compress a 250 ms gap to 125 ms across a swap.
Fast evaluation therefore does not guarantee continuity. I would coalesce to one
update per animation frame, skip identical source, bound the queue, and offer
explicit immediate/beat-aligned swaps. No throttled comparison was measured.

**Boundaries and limits.** Document operations, generation, and scene geometry
run without DOM/audio. **21 Node tests** passed in **0.775 s** (test bodies
0.199 s). **24 browser cases** passed in **16.668 s including shutdown**, against
a built copy on an OS-selected port; 21 screenshots include held gestures.
Zero browser errors. Evidence: `node-results.json`, `browser-results.json`.
This is one bounded run: Node 24.22.2, Linux, Chromium 158.0.8127.18, running
48 kHz headless audio; shared 16-core machine, load about 10. These are not
cross-device performance claims.

The model cannot express chords/parallel branches, unequal step weights, ties,
multicycle alternation, seeded randomness, `every`/`jux` callbacks, arbitrary
settings, `.FX()` chains, room conflicts, or opaque stations. Curves are periodic
linear signals sampled at note onsets, not continuous audio automation. Only
gain/brightness and four rewrite kinds are modeled. Next: enlarge touch handles,
improve pitch/echo value feedback, and test listening and fast combined rewrites.
The web transpiler's JSON-string rewrite needed `// mini-off`; its regression
runs in Node. Referenced `docs/standards.md` was absent.
