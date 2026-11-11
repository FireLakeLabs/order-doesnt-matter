# Torture set

85 pasteable programs: 42 `micro-*` probes, 15 `mms-*` owner-fixture adaptations,
15 original `piece-*` arrangements, and 13 verbatim `real-*` owner-collected inputs (12 compositions and one usage snippet). Original `micro-*`/`piece-*` sources are CC0-1.0; MMS adaptations retain MIT attribution in
`MMS-LICENSE.txt`. `index.json` records provenance, tags and observation horizons.
`build-corpus.py` regenerates constructed sources while retaining collected entries.
`extract-real.py` re-extracts the 13 programs byte-for-byte from the owner attachment.
Collection records provenance; it does not assert a third-party licence.

Switch Angel is **local only**: the earlier project records attribution but no clear
redistribution permission. Its source remains at
`/home/aaron/projects/monkeyboys-modular-synth/src/library/patches/switch-angel-trance-demo.strudel`.
The import Study 02 and editor runtime load it there when present; no source,
imported document, or regenerated copy is bundled in this repository.
Attribution: **Switch Angel · transcription by cosimo · user-supplied variant**;
[transcription](https://gist.github.com/cosimo/b0843897efb5f23b4594cb5082be1a85).

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
| --- | -------: |
| A1  |        7 |
| A2  |       23 |
| A3  |        4 |
| A4  |       23 |
| C1  |        4 |
| C2  |        4 |
| E1  |        9 |
| E2  |        7 |
| E3  |       35 |
| E4  |        6 |
| E5  |        3 |
| G1  |       34 |
| G2  |       12 |
| G3  |       24 |
| G4  |       16 |
| G5  |        3 |
| Q1  |        2 |
| Q2  |        3 |
| Q3  |        4 |
| S1  |       15 |
| S2  |        2 |
| T1  |       22 |
| T2  |        8 |
| T3  |       17 |
| T4  |        4 |
