# Test stability and timing evidence

These are assertions and measurements, not listening or subjective visual review.
No agent can hear. The current rules are in [standards](../docs/standards.md).

## Runner and boundaries

`npm run test:browser` builds the Studio and engine harness, serves them on a free
port, runs the `studio`, `views` and `engine` projects in sequence with one worker,
and shuts down the server. Their playback clocks never overlap locally. CI runs
`test:browser:studio`, `test:browser:views` and `test:browser:engine` on separate
runners, each with one worker. The views project includes every `view-*.spec.ts`,
including Scope’s smoke and feed test, and uses Playwright shards. Studio and
views share a shard list in both workflow matrices, starting with
`shard: ['1/2', '2/2']`; expand that one line to add shards.
Studio excludes those view files; engine selects `engine.spec.ts` and
`silent-swap.spec.ts`. Every job retains separately named timing and failure
evidence. The Check aggregator requires the complete browser matrix. Engine and
silent-swap canaries retain their real PCM, scheduling, discovery and acknowledgement proofs.
Individual audio tests may use separate pages to isolate voices.

Only `online.spec.ts` belongs to the optional project; use
`npm run test:browser:online` for its network sample checks. View measurements are
separate, through `npm run measure:views`. Tests target the built Studio; the
redirect test checks `/studio.html`.

A 60 s per-test timeout protects against hangs. Retries remain off. Suite and
completed-case durations are informational: the Node command warns above 60 s,
and the complete browser command warns above 300 s. Neither warning changes the
exit status. Complete browser time includes build, serving, tests, shutdown and
cleanup. Failed builds and assertions still fail the command.

Node tests cover document/import/generation logic and drawing geometry against
real Strudel. Browser tests cover the Studio controls, actual worker behavior,
transport and engine delivery. The tray walks several editor kinds on real corpus
pieces; independent Node proofs retain exact event spans, unchanged instruments,
structural paths, refusal cases and Undo snapshots.

## Observable readiness

Helpers live in `tests/browser/helpers.ts`. Play readiness requires a new
`swapped`, `canPlay`, playing transport and an empty message. Score readiness
requires a playable document and the Studio's `data-score-ready` signal; a
whole-program setup can be playable without modeled rows. Pending waits require
the coordinator to settle. Practice uses `data-practice-ready`.

Wait on application state and acknowledged revisions, never fixed delays or a
particular note in one scheduling window. D39 allows the engine to skip late
windows. Delivery comparisons use the windows the scheduler actually queried;
exact score/event comparisons belong in Node. PCM and Stop observations use
captured audio-clock frames.

## Timing and reproduction

Use the Node version in `.node-version`, `npm ci` and installed Playwright Chromium.
Run `npm run check` and `npm run test:browser`. Serialize heavy commands under
`flock /tmp/odm-gates.lock`, detached, retaining their full logs and exit codes.

Every browser run prints its executed test count, complete-command seconds per
test and five slowest Playwright tests. `ODM_PROFILE_PATH` retains per-test JSON
and command phase timing. The reporter uses Playwright steps and browser `ODM:`
performance measures; nested steps and overlapping marks are counted once.
Categories describe elapsed activity, not CPU profiles. Per-test phase sums do
not equal command wall time when setup and teardown are included.

Earlier worker-width experiments and shared-page protocols are historical
measurements, available in `git show 5a0ccd2:tests/stability.md`. Their retired
runner modes, shared setup and former hard time budgets are not current guidance.
