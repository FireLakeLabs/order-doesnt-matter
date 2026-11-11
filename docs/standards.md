# Standards

Logic runs in Node with vitest against real Strudel: document operations, import,
generation, event comparisons, and pure drawing geometry. Browser tests cover
browser behavior against a built copy. No jsdom is needed for plain logic.

The complete browser command includes build, serving, tests, and shutdown in its
wall time. It fails above three minutes and reports the duration to the console
and GitHub step summary. The timing unit test exercises the limit without waiting.
`ODM_BROWSER_LIMIT_SECONDS` can lower the limit to test the command's failure path.
Each run gets its own build directory. Every server asks the OS for a free port
with port 0, including local development; two copies must run together.

Directory ownership keeps later implementers apart:

| Directory       | Responsibility                                             |
| --------------- | ---------------------------------------------------------- |
| `src/document/` | Plain JSON contract, traversal, validation, shared fixture |
| `src/strudel/`  | Strudel seam and its canaries                              |
| `src/app/`      | Page shell and later composition                           |
| `src/import/`   | Reserved: source to document                               |
| `src/generate/` | Reserved: document to source                               |
| `src/engine/`   | Reserved: playback and sound state                         |
| `src/sheet/`    | Reserved: score sheet and song strip                       |

Only the seam imports Strudel or superdough. Private behavior gets a named wrapper,
a dependency comment, and a canary whose failure names the changed behavior.
The pinned Strudel packages need Vite's module resolver in Node tests because
Kabelsalat's Node entry omits a required export; vitest inlines those dependencies.
Cyclist phase access requires its first tick: an uninitialized phase throws.
Seek sets the origin while stopped; live seeking belongs to the engine.

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

Keep PRs around 400 authored lines where possible. Contracts and their required
canaries can need more; report the actual size and keep features separate.
Report what was measured separately from what was seen; no agent can hear, never
describe how something sounds. Browser assertions are checks, not visual review.
D13 applies: third-party music stays out unless redistribution permission is recorded.
