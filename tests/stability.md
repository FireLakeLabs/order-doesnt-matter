# Test stability and time evidence

These are assertions and measurements, not listening or subjective visual review.
No agent can hear. Full local logs and timing reports are ignored beneath
`test-results/`. PR #22 established the observable-readiness helpers and two-worker
baseline; the browser-time follow-up keeps those signals, deadlines and thresholds.

## Boundaries retained

Node proofs use real Strudel and the two-slot per-file query pool, with two Vitest
file workers. Every question executes independently; no result cache. Fresh-worker
import, termination, global isolation and pool-recovery canaries remain. The Node
wrapper enforces 60 s, and the complete browser command (build, serve, tests,
shutdown, cleanup) enforces 180 s. No retries or raised timeouts.

Play readiness requires a new `swapped`, `canPlay`, playing transport and an empty
message. Score readiness requires every row result. Pending waits require the
coordinator to clear entries and replacement rows to finish. Negative trigger
observations retain a full post-swap cycle. PCM/Stop observations use captured
audio-clock frames; separate pages isolate voices. Both deliberately nonterminating
programs still exercise the real worker's 5 s deadline and <7 s responsive-page bound.

## Measuring and guarding growth

Every default run prints executed test count, complete-command seconds per test,
and the five slowest Playwright tests (including their per-test hooks). Any test
above 20 s fails the command, even when Playwright reports it passed; 20 s exactly
passes. `tests/checks.test.ts` covers the boundary, ranking, skips and empty reports
without sleeping. The 180 s command budget remains independent.

`ODM_PROFILE_PATH=test-results/timing/run.json npm run test:browser` also retains
per-test timings. `scripts/browser-report.mjs` uses Playwright's step clock,
`ODM:` helper steps and browser performance measures. Categories are navigation,
import plus row questions, engine/start, swap acknowledgement, event/audio-clock
observation, PCM/screenshot capture, teardown and other interactions. Nested steps, poll intervals and gaps
are counted once on one timeline. Overlapping browser marks are unioned (capture, then swap,
playback, observation) inside the surrounding page evaluation.
Categories are elapsed test activity, not CPU profiles; concurrent work overlaps
across tests. Fixture overhead and gaps between API calls are included.
Phase sums equal each test duration, not the parallel command wall time.

`play()` includes engine creation and first scheduling acknowledgement. Harness
engines are timed through their existing play/event/tap interfaces. No measurement
adds a scheduling wait. No video is enabled in the default project.

The default runner selects `audio`, which first runs its `default` UI dependency.
The engine and silent-swap files then run with one worker and no concurrent UI
project. The existing 3 s acknowledgement/RMS bounds are unchanged. `demo`, `edit-demo`, `shots`,
`measure` and `online` belong to `optional`; none of those five specs is collected or launches a page
in the default command. Existing opt-in/environment guards remain. Ordinary specs
assert layout without taking screenshots; `npm run shots:editors` retains capture.

## Assertion audit

UI input, pointer, focus, keyboard, containment, real audio/trigger delivery,
worker limits and one real-piece integration per editor kind remain in Chromium.
The table lists every removed assertion family and its Node replacement. Exact
multisets are queried at the same absolute cycles, including time-addressed Perlin.

| Was in browser                                                                                                                                  | Now in Node                                                                                                                                                                                                    | File                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Constant real-house bass 450 → 900, nonempty bass/other bags, exact unchanged other values                                                      | Explicit bass 450 → 900 full-event multiset; existing independent row round trips                                                                                                                              | `tests/edit.test.ts`                                |
| Mute's exact five unaffected sound names; section mute removes piano only in intro, leaves drop                                                 | Real-house mute/use-mute exact per-row events over all 28 cycles, unmute restoration and generation round trip                                                                                                 | `tests/instrument-editor.test.ts`                   |
| Solo-only event bags before/after rename and undo; section/definition undo/redo preserves solo; kick mute restored; release restores six sounds | Real-house history snapshots, solo playback options across stop/restart, exact bass events, restored mute, six released sounds                                                                                 | `tests/instrument-editor.test.ts`                   |
| Rewrite double/reset/degrade/order/restore counts and exact untouched event bags                                                                | Real-house add/edit/reorder/remove exact per-row events; browser retains doubled-kick delivery and all editing/focus paths                                                                                     | `tests/rewrite-editor.test.ts`                      |
| Signal saw two-cycle 32-value rise, bounds, exact unaffected values; queried values restored after undo                                         | Real-house range/shape/period per-row proof, exact 32-value count; immutable prior snapshots and history tests                                                                                                 | `tests/signal-editor.test.ts`, `tests/edit.test.ts` |
| Techno alternating room value at every event, same counts and untouched fields/instruments                                                      | 16-cycle per-row alternating room proof with every span and unaffected value preserved                                                                                                                         | `tests/values-editor.test.ts`                       |
| Kiln bass alternating cutoff 700/900 and nonempty events                                                                                        | Explicit two-cycle Kiln proof plus two undo snapshots; browser retains input and conversion undo                                                                                                               | `tests/values-editor.test.ts`                       |
| Real-house Node bundle/import/generate/query/model JSON pipeline and eight rows/local label                                                     | Real worker per-row queries, eight-row sheet model, local target label and JSON round trip; browser seam retains real rendering/count/local label and page-error check; fixture suite retains JSON-fetch/mount | `tests/targets.test.ts`                             |
| Seam's pure instrument-kind assertion                                                                                                           | Every selectable real-house/techno target kind, plus handwritten target cases                                                                                                                                  | `tests/targets.test.ts`                             |

Routine screenshots were artifacts, not assertions; all viewport, containment,
control-size, focus, sticky-heading and DOM-identity assertions remain. The nested
values lane's actual SVG attributes remain a browser check: its renderer has no
exported pure geometry function, and this task does not change product code.

## Setup decisions

The baseline's largest costs were full-cycle observations and repeated playback,
not navigation. Independent tests retain their own pages: PCM isolation, pinned
section positions, undo histories and pending revisions make shared mutable setup
costly to restore safely. The rewrite variants still name one behavior each, but
only the real delivery canary starts playback; reset/degrade/order/remove exercise
real keyboard controls and previews while stopped. This removes expensive setup
without coupling failures to a preceding case. Instrument solo keeps its actual
keyboard/banner/stop/restart/release path; repeated score proofs run in Node.

## Reproduction

Use Node `.node-version`, `npm ci`, and installed Playwright Chromium.

- `npm run check`
- `node scripts/stability.mjs matrix`: three runs each at 2/3/4 workers.
- `node scripts/stability.mjs browser 3` and `... browser 4`: fifteen consecutive
  complete browser commands at each count. Run `npm test` continuously in another
  shell for the entire series. Stress stops on its first failure, without retry.
- `node scripts/stability.mjs node`: ten consecutive complete Node commands.

Each series writes exit codes, wall seconds, Playwright JSON and phase timings
under `test-results/stability/<mode>[-<workers>]/`. CI reruns use the same head for
one worker setting; changing worker count starts a new head and count.

## Measured

Local baseline on `c34ab45`: 46 checks, two workers, 73.115 s including build and
shutdown. The marked per-test profile took 77.257 s without deliberate load after phase instrumentation. An earlier
84.296 s diagnostic overlapped a Node run and is excluded from comparisons. Preliminary
reduced-suite runs: 41 checks, 34.017 s at three workers; 30.749 s at four workers.
After rebasing onto `893d971` (the section editor), the unchanged incoming section
specs bring the total to 44 browser checks. The corrected complete command took
34.736 s at three workers; `npm run check` passed with 311 Node checks (15.423 s).
The incoming section spec still takes its own two screenshots, left unchanged by
this task's ownership boundary.

Preliminary CI caught two observation-window errors before reliability counts:
unmute reached the kickless breakdown, so it now rewinds the muted drop through
the public transport first; the rewrite canary observed a partial first cycle,
so it now retains #22's future complete-cycle window and exact eight triggers.
Neither change relaxes a threshold. Incomplete pre-fix local series and these
failed CI attempts are excluded from consecutive evidence and reported in the PR.
The source editor has also merged on `f9084cb`: 47 browser cases are collected,
46 execute, and its incoming opt-in screenshot case retains its existing skip.
Both incoming specs are unchanged. The unisolated three-worker section-base load
series passed 15/15 (40.176–41.044 s), but the full-source CI series passed twice
(54.280 / 57.071 s) then missed the existing Kiln silent-acknowledgement 3 s bound
(85.738 s command). It is not eligible reliability evidence. The final matrix
uses one serial engine/silent-swap phase after the wider UI phase. Its first full
three-UI-worker command passed 46 active checks in 47.536 s, above the 45 s local
target. The rebased `npm run check` passed 320 Node checks in 15.717 s.
Final worker/load/CI evidence is recorded in the pull request before handback.

## Not checked

No listening, subjective visual review, live deployment or merge. Optional online,
recording, measurement and screenshot modes are outside the offline gate.
