# Torture set

72 pasteable programs: 42 `micro-*` probes, 15 `mms-*` owner-fixture adaptations,
and 15 original `piece-*` arrangements. Original sources are CC0-1.0; MMS adaptations retain MIT attribution in
`MMS-LICENSE.txt`. `index.json` records provenance, tags and observation horizons.
`build-corpus.py` regenerates sources and metadata.

Use Node 24.22.2: `npm ci && npm run check` here.
Strudel is pinned to 1.2.6. Workers have a 5-second
budget including imports; termination stops synchronous infinite queries.
`check-report.json` covers cycles 0..8 inclusive. Pattern counts describe
active outputs; concurrency excludes audible tails.
Direct queries expose errors swallowed by `queryArc()`. Unexpected or missing failures fail the command.

Kabelsalat's browser REPL is stubbed: its Node entry lacks `SalatRepl`.
Samples, tempo, hush and visual/log/MIDI/OSC outputs are stubbed; labels,
muting and `all()` are emulated. Trigger callbacks never fire.
No audio was auditioned. Decoded sample duration, effects, orbit conflicts,
and release tails need browser acceptance. Both intended query failures have
notes. Long transitions beyond cycle 8 require the indexed `cycles` horizon.
T4 does not assert aperiodicity.

| Tag | Programs |
| --- | ---: |
| A1 | 7 |
| A2 | 13 |
| A3 | 2 |
| A4 | 20 |
| C1 | 4 |
| C2 | 4 |
| E1 | 2 |
| E2 | 7 |
| E3 | 23 |
| E4 | 5 |
| E5 | 3 |
| G1 | 22 |
| G2 | 12 |
| G3 | 20 |
| G4 | 9 |
| G5 | 3 |
| Q1 | 2 |
| Q2 | 3 |
| Q3 | 3 |
| S1 | 2 |
| S2 | 2 |
| T1 | 11 |
| T2 | 4 |
| T3 | 17 |
| T4 | 4 |
