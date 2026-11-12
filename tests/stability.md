# Test stability evidence

This records checks of the tests, not a listening or visual review. No agent can
hear. Full local measurement logs are ignored under `test-results/stability/`.

## Causes and boundaries

- Fresh Node workers repeatedly imported Strudel. Twenty identical four-cycle
  questions measured 2414.76 ms fresh versus 170.02 ms in a one-slot pool;
  warm medians were 118.44 ms and 2.70 ms. This profiles import/startup overhead,
  not application performance. The baseline Node suite took 23.78 s.
- Play's enabled Stop button also covers preparation. Playback readiness now
  requires a new `swapped` event, `canPlay`, and playing transport, followed by
  an empty message. Load readiness waits for `canPlay` and all row queries.
- The old instrument workflow measured 15.416 s and signal workflow 11.872 s.
  Independent cases now own their setup and the unchanged 30 s test deadline.
- Observation windows must stay inside their intended section. The section-mute
  case uses a slower test tempo; the final solo-release observation rewinds the
  drop through the public transport.
- Score proofs retain two worker slots per test file and two Vitest file workers.
  Every question still executes independently; no cross-question result cache.
  Fresh-worker import, termination, and global-isolation canaries remain fresh.
  Pool canaries cover registry/tempo restoration, independent execution, event
  budgets, timeout replacement, queued work, and closing.
- Global Vitest timeout is back to its 5 s default. Named 10/15/20 s overrides
  and the corpus 30 s override are removed. Browser's global deadline remains
  30 s, with no retries. Readiness polls explicitly use that enclosing deadline.
- PRs run Check once, including infra tests and synth. Deploy no longer has a
  PR trigger. This is simpler than conditional duplicate root steps. Its main
  checks, tested-artifact handoff, environments, guard and roles are unchanged.

## Wait inventory

Each row lists the original time-sensitive waits, including optional local modes.
Locator assertions after a completed signal retain their ordinary assertion
budget. A signal that never arrives fails the enclosing test; it is never quiet.

| File                 | Original wait                                                                                                      | Current signal or observation                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `helpers.ts`         | default 5 s load-row and swap polls; editor attribute may already be clear                                         | row results + `canPlay`; new `swapped`; all coordinator entries leave pending                                                                                                                                |
| `app.spec.ts`        | Play/trigger poll; playhead poll; 300 ms advance sleep; 350 ms Stop sleep; error poll; two timeouts sharing a test | playback helper; trigger history; SVG path change; advancing `now()`; 350 ms of captured audio-clock frames; error history; separate 5 s product-timeout cases retain the asserted <7 s responsiveness bound |
| `cleanup.spec.ts`    | ready/not-used labels within 5 s of Play; row-results poll                                                         | playback helper before status assertions; score readiness                                                                                                                                                    |
| `demo.spec.ts`       | 20 s trigger poll, 3200/700/150 ms sleeps; 6500 ms host probe                                                      | playback and cycle signals; queried rows; scroll completion; host request deadline retained                                                                                                                  |
| `edit-demo.spec.ts`  | row/swap polls; 18 × 45 ms drag sleeps; 700 ms final sleep                                                         | score/playback helpers; actual pointer moves; pending clears before capture/Stop                                                                                                                             |
| `editor.spec.ts`     | first swap, playing-now, value/undo polls and 10 s full-cycle poll                                                 | playback + pending helpers; carrying trigger values/history markers; complete cycle                                                                                                                          |
| `engine.spec.ts`     | initialization poll; 400 × 10 ms event loop; 350 ms Stop + 350/500 ms voice-drain sleeps                           | inspect initialization; subscribe-before-check engine event waiter; captured 350 ms PCM window; independent sample/missing/seek pages remove previous voices                                                 |
| `instrument.spec.ts` | repeated default 5 s swap and value polls across one long test                                                     | new swap signal; one complete post-swap cycle before positive and negative assertions; independent mute/use/solo/name cases                                                                                  |
| `measure.spec.ts`    | initial swapped poll; each measured edit waits for swapped                                                         | shared playback signal; existing per-edit event subscription retained                                                                                                                                        |
| `online.spec.ts`     | 6500 ms host probe; 20 s ready; 900 ms voice drain per drum; 5 s/10 ms trigger loop                                | host request deadline retained; independent per-drum page and playback signal; PCM capture bounds the measurement                                                                                            |
| `rewrite.spec.ts`    | default 5 s full-cycle polls and pending waits across several swaps                                                | independent doubled/reset/degraded/restored cases; carrying revision + complete cycle + pending clears                                                                                                       |
| `seam.spec.ts`       | pending and default 5 s carrying-value poll                                                                        | coordinator state and carrying trigger signal                                                                                                                                                                |
| `sheet.spec.ts`      | loaded region/`tbody` selector                                                                                     | existing explicit rendered-sheet readiness; no clock sleep/audio/swap waits                                                                                                                                  |
| `shell.spec.ts`      | `networkidle`'s quiet-time delay                                                                                   | navigation's load event; shell has no requests started after load                                                                                                                                            |
| `signal.spec.ts`     | carrying gain poll, 10 s two-cycle poll, result-values poll; many changes in one test                              | independent bound/period/undo cases; pending, trigger-cycle and queried-value signals                                                                                                                        |
| `values.spec.ts`     | default 5 s cycle polls following Play; pending after edits                                                        | playback/pending helpers and completed cycle in trigger history                                                                                                                                              |

The engine transport's 5 ms interval samples `playing` during a swap. It is a
measurement, not a readiness wait. PCM RMS waits for complete captured frames.

## Reproduction

Use Node `.node-version`, `npm ci`, and installed Playwright Chromium.

- `node scripts/profile-queries.mjs`: cold/warm worker comparison (20 queries).
- `node scripts/stability.mjs matrix`: workers 1/2/4/default, three runs each.
- `node scripts/stability.mjs node`: ten consecutive Node suites.
- `node scripts/stability.mjs browser`: fifteen consecutive browser suites; run
  `npm test` continuously in another shell for the entire measurement.

The browser/Node stress commands stop at their first failure; the matrix records
all three planned runs per worker count. Each writes durations and exit codes to `test-results/stability/<mode>/runs.json`. Browser JSON reports
include per-test durations. No failed run is retried by the runner.

## Assertions changed

No score/value/count/RMS threshold assertion was removed or relaxed. Long tests
are partitioned into independent setups. Instrument negative assertions observe
an entire post-swap cycle. Stop's equal trigger-count assertion spans 350 ms of
captured audio time instead of 350 ms of host sleep. Optional online drums each
start on a fresh page, retaining every drum's ready/RMS/background assertion.
The local edit recording now asserts the current `Playing now` label instead of
its stale `Heard by the engine` label, after the coordinator clears pending.

## Product changes requested

None required so far. The page already exposes the signals used above. The
suite does not infer voice-tail completion: independent pages isolate RMS cases.

## Measured

Final worker matrix, stress runs, and CI logs are recorded in the pull request.
Local baseline browser suite: 27.153 s (24 regular checks; optional modes excluded).
