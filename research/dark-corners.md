# Dark corners

Not authoritative. Working list of Strudel behaviours that stress the design in
`docs/model.md`. Verified against `@strudel/core` 1.2.6 and `superdough` 1.3.0
on 2026-11-10 unless marked. Each row needs a Phase 0 verdict: **shown**,
**shown degraded**, or **out of scope**.

| ID  | Behaviour                                                                                           | Stresses        | Verdict |
| --- | --------------------------------------------------------------------------------------------------- | --------------- | ------- |
| G1  | Trees: `stack`, `cat`, `seq`, `arrange`, `pick`                                                     | Floor plan      |         |
| G2  | Branching callbacks: `off`, `jux`, `superimpose`, `layer`, `every`, `sometimes`, `when`             | Floor plan      |         |
| G3  | Variables, reuse, user functions, `register`                                                        | Floor plan      |         |
| G4  | Patterns as arguments: `.lpf("<400 2000>")`, `.fast("<1 2>")`, `.lpf(sine.range(..))`               | Floor plan      |         |
| G5  | Several `$:` patterns, labels, muting with `_$:`, global `all()`                                    | Floor plan      |         |
| T1  | Long periods: `<a b c>`, `every(n)`, `slow(n)`, polymeter `{a b c}%4`                               | Spiral          |         |
| T2  | Randomness: `rand`, `irand`, `degradeBy`, `sometimes`, `perlin` (time-addressed, wraps at 300 cycles) | Spiral        |         |
| T3  | `arrange` over hundreds of cycles                                                                   | Spiral          |         |
| T4  | No detectable repeat length                                                                         | Spiral          |         |
| E1  | Continuous signals: events with no `whole`                                                          | Creature, lane  |         |
| E2  | Fragments: `part` shorter than `whole`; only onsets sound                                           | Creature        |         |
| E3  | Overlap and polyphony: chords, `stack`, long notes                                                  | Creature, lane  |         |
| E4  | Density: `.fast(64)`, `chop`, `striate`, `ply`                                                      | Spiral          |         |
| E5  | Bare values: strings or numbers before a control is applied                                         | Creature        |         |
| C1  | 411 controls plus 234 aliases; no type schema                                                       | Lane            |         |
| C2  | Multi-value settings: `"800:2"` colon syntax, arrays, functions                                     | Lane            |         |
| A1  | Ordered `.FX()` stages                                                                              | Voice           |         |
| A2  | Shared orbit delay/reverb; conflicting settings across patterns                                     | Room            |         |
| A3  | Cross-note audio state: `duck`, `cut` groups, buses                                                 | Voice, room     |         |
| A4  | Heard length differs from score length: `clip`/`legato`, release, sample tails                      | Creature        |         |
| S1  | State outside patterns: `setcpm`, `samples()`, `await`, `hush`                                      | Floor plan      |         |
| S2  | Side effects at trigger time: `onTrigger`, `.log()`, MIDI/OSC, `pianoroll`, `scope`                 | Floor plan      |         |
| Q1  | Query errors are swallowed and look like silence                                                    | All             |         |
| Q2  | Expensive, impure, or non-terminating queries                                                       | All             |         |
| Q3  | Sample-dependent behaviour: `loopAt`, `fit`, `splice` need decoded sample length                    | Creature        |         |
