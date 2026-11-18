# Standards

Logic runs in Node with vitest against real Strudel: document operations, import,
generation, event comparisons, and pure drawing geometry. Browser tests cover
browser behavior against a built copy. No jsdom is needed for plain logic.

The complete browser command includes build, serving, tests, cleanup and shutdown
in its wall time. Node and browser suite durations are printed to the console and
GitHub step summary, with an informational warning above 60 s and 300 s respectively.
Suite durations and completed case durations do not fail a run (D44). Each run gets
its own build directory. Every server asks the OS for a free port with port 0,
including local development; two copies must run together.

The browser suite runs locally only (D49); CI and the deploy run the Node
checks and build. Studio, view and shared real-engine browser projects run
serially with one worker, so their audio clocks never compete.

A 60 s per-test hard timeout protects against hangs; retries remain off. Worker
execution deadlines still apply. `npm run check` keeps format check, lint,
typecheck, Node tests, docs check, boundaries and build as deterministic gates.

Directory ownership keeps later implementers apart:

| Directory       | Responsibility                                             |
| --------------- | ---------------------------------------------------------- |
| `src/document/` | Plain JSON contract, traversal, validation, shared fixture |
| `src/strudel/`  | Strudel seam and its canaries                              |
| `src/app/`      | Shared controller, state and recovery                      |
| `src/import/`   | Reserved: source to document                               |
| `src/generate/` | Reserved: document to source                               |
| `src/engine/`   | Reserved: playback and sound state                         |
| `src/sheet/`    | Shared score model                                         |

Only the seam imports Strudel or superdough. Private behavior gets a named wrapper,
a dependency comment, and a canary whose failure names the changed behavior.
The pinned Strudel packages need Vite's module resolver in Node tests because
Kabelsalat's Node entry omits a required export; vitest inlines those dependencies.
Cyclist phase access requires its first tick: an uninitialized phase throws.
Seek sets the origin while stopped; live seeking belongs to the engine.

Implementation extensions to D38/D39 (2026-11-15): cooperative checkpoints cover
authored loops/functions during evaluation and queries. Failed evaluation retains
the installed pattern; a later query overrun stops transport. Native/indirect code,
hostile side effects, trigger callbacks and out-of-scope async work remain outside
that protection. An off-page execution boundary is still needed for arbitrary code.
Constant gain/cutoff edits reuse extra section inventory only for an admitted pure
generated subset; unsupported programs rediscover. Every replacement retains
current-window preflight, audio preparation, asset checks and default margins.

Document paths use property names and array indices from the serialized root.
Selectors keep body order; `shared` returns the last matching pattern and `tempo`
the last cpm value. Validation checks shared-name existence, not JavaScript scope.
Rooms, sound loading and pending state are derived outside the document. Control
units and ranges also belong outside it.

`check:boundaries` parses static imports, exports, dynamic literal imports and
literal `require` calls. It rejects Strudel imports outside the seam and spike
imports in source/tests. Its pragmatic port pattern catches positive literal
`port:`/`port=`, `PORT=`, `--port`, URL ports and `listen(number)` in configs,
scripts, tests and workflows. Computed ports and aliased module names are outside
this check; review them. Frozen spikes and corpus stay outside root checks.

Keep features separate and code quality intact. D44 drops the 400-line aim,
doc word budgets, mandatory recorded demos and metrics upkeep.
Report what was measured separately from what was seen; no agent can hear, never
describe how something sounds. Browser assertions are checks, not visual review.
D13 applies: third-party music stays out unless redistribution permission is recorded.

## Done

A visualization is done when the owner sees it running on a real piece on desktop,
it has the effect the brief stated, it keeps time with playback, and the gates
pass. No verification write-up is required.
