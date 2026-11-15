# Remaining-work delivery record

The owner authorized all remaining implementation, with guided practice last.
This branch contains the final tour change and documentation. Its explicit PR
base is the discovery/retention stack; the final release also depends on the
other reviewed feature PRs. Every merge to main publishes; no merge is implied.

## Reviewed feature stack

| PR | Package | Reviewed head | State at tour handoff |
| --- | --- | --- | --- |
| #56 | Free-port tooling and shared proof | `a98573c` | CI passed, unmerged |
| #57 | Cooperative playback checkpoints | `0f396d8` | CI passed, unmerged |
| #58 | Recovery, JSON and Strudel export | `f6baf91` | CI passed, unmerged |
| #59 | Interface/editor research | `9871443` | CI passed, unmerged |
| #60 | Mini edit operations | `f605fa9` | CI passed, unmerged |
| #61 | Paper/Fern/Night and Watch marks | `9903478` | CI passed, unmerged |
| #62 | Instrument navigation and guidance | `32622ae` | CI passed, unmerged |
| #63 | Structural mini controls | `f8cdd35` | Both CI runs passed, unmerged |
| #64 | Callback branch editing | `741e88b` | CI passed, unmerged |
| #65 | Sampled rooms and phone disclosure | `4b09ad8` | CI passed, unmerged |
| #66 | Optional Watch Fly-through | `5e28eec` | CI passed, unmerged |
| #67 | Admitted section-discovery reuse | `de24e63` | Both CI runs passed, unmerged |

Parent inspected the full reports/diffs and source corrections. Actual desktop
and phone flows, document downloads/reopening/recovery, three palettes, exact
List origins, real generated queries and engine canaries were checked. Limits
are retained in the backlog; no physical-speaker or accessibility certification
claim follows. No production deployment was performed.

## Testing-policy change

The growing suite repeatedly reached the original 180-second total cap. Some
completed CI runs passed every assertion but failed the 20-second accounting guard
on a multi-action rhythm workflow. All failures were retained and distinguished
from functional failures; no unchanged retry or weakened assertion made them green.

The owner explicitly approved 25 seconds per completed case and 300 seconds for the
complete browser command on 2026-11-15. Standards records the exception to
D5/D16/D27. Exact-boundary canaries pass at 25000/300000 ms and fail one millisecond
later; Node 60 seconds, worker execution deadlines and scheduler margins remain.
Parent four-CPU pre-tour acceptance:659 Node passed 39.959/60 s;107 browser passed,
3 existing skips,185.573/300 s,slowest 16.032/25 s. Those figures do not claim a speedup.

## Final guided-practice wave

The owner reviewed the desktop/phone prototype and selected "Use the mockup as
shown." The research prototype is simulated, not a recovery or audio-safety proof.
The implementation retains the original controller/editor/history and mounted
drafts, isolates practice from recovery, uses one lazy engine and restores stopped
playback. Driver 1.10.2 is exact, local and lazy, with its MIT notice in licence output.

Parent review reproduced and corrected three settlement/failure-state defects
(practice failure leaking into a later entry, hidden failure after Stop, disposed
queue not waking its barrier). All three new Node regressions failed before and
passed after. A browser regression also failed before/passed after preserving
Now List disclosure and its editor return origin. Original assertions remain.
Final combined acceptance passed 668 Node tests and 119 browser tests, with
three existing skips, in 216.887/300 s on four CPUs; slowest 15.669/25 s.
The narrow base typecheck and all 12 tour browser cases passed. Current-head CI
and merge approval remain pending. See the tour PR and its verification record.

Retained limits: screen-reader behavior, real mobile keyboards and physical
speaker behavior remain unverified. History/drafts persist in memory only;
crash recovery holds only the normal document and depends on browser storage.
The backlog is the single inventory of remaining release work and boundaries.
