# Dark corners

Not authoritative. Working list of Strudel behaviours that stress the design in
`docs/model.md`. Verified against `@strudel/core` 1.2.6 and `superdough` 1.3.0
on 2026-11-10 unless marked. Verdicts come from `spikes/capture/FINDINGS.md` and `spikes/spiral/FINDINGS.md`. Each row needs a Phase 0 verdict: **shown**,
**shown degraded**, or **out of scope**.

| ID  | Behaviour                                                                                             | Stresses       | Verdict                                                                         |
| --- | ----------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| G1  | Trees: `stack`, `cat`, `seq`, `arrange`, `pick`                                                       | Floor plan     | shown                                                                           |
| G2  | Branching callbacks: `off`, `jux`, `superimpose`, `layer`, `every`, `sometimes`, `when`               | Floor plan     | shown degraded: late callbacks give a sampled family of scores                  |
| G3  | Variables, reuse, user functions, `register`                                                          | Floor plan     | shown degraded: `eval` and self-inspecting code excluded                        |
| G4  | Patterns as arguments: `.lpf("<400 2000>")`, `.fast("<1 2>")`, `.lpf(sine.range(..))`                 | Floor plan     | shown                                                                           |
| G5  | Several `$:` patterns, labels, muting with `_$:`, global `all()`                                      | Floor plan     | shown degraded: partial REPL state                                              |
| T1  | Long periods: `<a b c>`, `every(n)`, `slow(n)`, polymeter `{a b c}%4`                                 | Spiral         | shown                                                                           |
| T2  | Randomness: `rand`, `irand`, `degradeBy`, `sometimes`, `perlin` (time-addressed, wraps at 300 cycles) | Spiral         | shown                                                                           |
| T3  | `arrange` over hundreds of cycles                                                                     | Spiral         | shown degraded: overview loses detail past ~16 turns                            |
| T4  | No detectable repeat length                                                                           | Spiral         | shown: time is addressable, repeat never assumed                                |
| E1  | Continuous signals: events with no `whole`                                                            | Creature, lane | shown                                                                           |
| E2  | Fragments: `part` shorter than `whole`; only onsets sound                                             | Creature       | shown                                                                           |
| E3  | Overlap and polyphony: chords, `stack`, long notes                                                    | Creature, lane | shown                                                                           |
| E4  | Density: `.fast(64)`, `chop`, `striate`, `ply`                                                        | Spiral         | shown degraded: occupancy above ~128 onsets per cycle                           |
| E5  | Bare values: strings or numbers before a control is applied                                           | Creature       | shown degraded: identity needs inspection                                       |
| C1  | 411 controls plus 234 aliases; no type schema                                                         | Lane           | shown degraded: only settings in use                                            |
| C2  | Multi-value settings: `"800:2"` colon syntax, arrays, functions                                       | Lane           | shown degraded: functions opaque                                                |
| A1  | Ordered `.FX()` stages                                                                                | Voice          | open: needs audio                                                               |
| A2  | Shared orbit delay/reverb; conflicting settings across patterns                                       | Room           | open: needs audio                                                               |
| A3  | Cross-note audio state: `duck`, `cut` groups, buses                                                   | Voice, room    | open: needs audio                                                               |
| A4  | Heard length differs from score length: `clip`/`legato`, release, sample tails                        | Creature       | shown degraded: scored length only; heard tails open                            |
| S1  | State outside patterns: `setcpm`, `samples()`, `await`, `hush`                                        | Floor plan     | shown degraded: effects stubbed                                                 |
| S2  | Side effects at trigger time: `onTrigger`, `.log()`, MIDI/OSC, `pianoroll`, `scope`                   | Floor plan     | out of scope                                                                    |
| Q1  | Query errors are swallowed and look like silence                                                      | All            | shown degraded: nested swallowed errors stay hidden                             |
| Q2  | Expensive, impure, or non-terminating queries                                                         | All            | shown degraded: sandbox with time budget; impure programs show final score only |
| Q3  | Sample-dependent behaviour: `loopAt`, `fit`, `splice` need decoded sample length                      | Creature       | open: needs decoded samples                                                     |
