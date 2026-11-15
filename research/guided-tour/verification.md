# Prototype verification

Research only, based on `56983ed`. Browser evidence captured 2026-11-15 UTC.
No production app, engine, Strudel import or real document recovery was exercised.
No full repository gate was rerun; the parent's 659/107 results are supplied context,
not independent results from this task. No dependency was installed.

## Measured

Owned T3 preview tab, static HTML served with Python on OS-allocated port 49521
(`TCPServer(..., 0)`). Acquired the shared exclusive browser-build-acceptance lock
before the first HTML load. Lock wait: **0.000013 s**, separate from checks.
The first blank-tab URL attempt was rejected as unsupported `about:`; the actual
HTTP preview worked. No fallback browser or deadline changes were needed.

Final HTML passed the following at each actual CSS viewport, using Fit window:

| Viewport | Control checkpoints | Geometry / hit test failures | Root horizontal overflow |
| -------- | ------------------: | ---------------------------: | ------------------------ |
| 1440×900 |                  14 |                            0 | none                     |
| 390×844  |                  14 |                            0 | none                     |
| 390×667  |                  14 |                            0 | none                     |

Each checkpoint measured Stop, End tour and the requested control with
`getBoundingClientRect`, viewport bounds, minimum 44 px height, and center-point
`elementFromPoint` hit testing. Targets: Kiln, Play, Section 2, bass cutoff cell,
exact field, Done, Undo, Section 3, Follow, Enlarge Now, its Close, Enlarge Watch,
its Close, practice document download. All were in bounds and unobscured.
This tests selected control centers, not every pixel, visual contrast or semantics.
The wide score scroll remains intentional.

Representative step-4 geometry in CSS px (rounded):

| Viewport | Stop x/y/w/h | End tour x/y/w/h | Exact field x/y/w/h |
| -------- | ------------ | ---------------- | ------------------- |
| 1440×900 | 88/124/58/44 | 1334/79/87/44    | 123/823/130/44      |
| 390×844  | 86/118/62/44 | 290/599/87/44    | 111/518/130/44      |
| 390×667  | 86/118/62/44 | 290/422/87/44    | 111/341/130/44      |

At 390×667 the enlarged preview occupies y=289–397 and guidance begins at y=409.
The preview scrolls within that space. A first inspection found it extending over
End tour; its height was corrected and the final three-size checks above passed.
A further padding adjustment made the Now names visible on that short phone.

The DOM-driven rehearsal completed all eight lessons at all three sizes, including
Play then Stop, changed 700→800, Done then Undo, section pin then Follow, both preview
open/close pairs, optional simulated exports, Back/Next revisit and Finish. Assertions
also checked Cancel focus, fixture paste/draft return, stopped transport and empty
welcome return. These are prototype assertions, not app outcome signals.

Native keyboard checks: Escape cancelled entry and focused Help; editing the exact
field and Tab submitted its change and advanced to lesson 5; Tab from End reached
the instruction scroller, Back, then the page and Stop (while simulated playing).
Escape from active practice and an enlarged preview returned to Help, hid guidance,
closed preview and left transport stopped. No forced completion action was needed.
No keyboard trap was observed in those traversals; full assistive-technology testing
and keyboard-only production lesson completion remain unverified.

Node 24.22.2 parsed the inline script (`new Function`), static IDs were unique,
and there were no external script/style dependencies. T3 snapshots reported no
console errors. Markdown passed explicit Prettier checking using the parent's
existing 3.6.2 binary; no install or dependency edits. HTML parsed with Prettier and
keeps compact authored formatting (research is excluded by `.prettierignore`).
`git diff --cached --check` passed before commit.

## Seen, separately from measurement

Actually inspected screenshots: desktop entry and cutoff guidance, 390×844 Keep work,
and 390×667 exact field and enlargement. Paper text and focus rings were readable;
the phone guidance occupied its own area, and Stop / End remained visible. Long
instructions and the short-phone preview need scrolling. The source excerpt and
Watch circles are explicit illustrations, not complete generated score results.

Representative captures remain local browser artifacts (not committed):

- Desktop entry: `/home/aaron/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwh5mf8w-e55ea5d7.png`
- Desktop cutoff: `/home/aaron/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwh5gjap-4b9e404c.png`
- Phone 844 Keep work: `/home/aaron/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwh5k89w-2dd67f15.png`
- Phone 667 enlargement: `/home/aaron/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwh5m4ay-f7357a75.png`

CSS viewport geometry is reported above; preview screenshot output scales pixels
(desktop capture 1280×800, phone captures at device scale), not a second viewport.

## Limits and cleanup

No hearing claims. No proof of audio safety, real session restoration, history
preservation, reload/crash isolation, denied storage, real exports, Driver integration,
screen-reader announcements, mobile virtual keyboard or browser chrome behavior.
Driver 1.10.2 release / tagged manifest / MIT licence and official APIs were reviewed;
links and application gaps are in `implementation-brief.md`. No general onboarding
framework is proposed. Optional defaults need no extra owner decision; design review
is the next parent-owned checkpoint.

Owned preview tab closed; static server/runner exited and released the lock. No
production server or repository test runner was started. Only the three requested
research files are committed; no source, tooling, living docs, hosting or PR changes.


## Parent review of the implemented tour

The owner approved the mockup as shown. Parent read the full implementation
handoff/diff and corrected three reproduced state/settlement defects and the
Now List disclosure/editor-return origin. Each regression failed before its
correction and passed after. These are product-state corrections, not retries
or timing changes. Original assertions and optional skips remain.

Independent combined implementation at parent `44e4e6e`, CPUs 0–3, separate
exclusive acceptance-lock acquisitions:

| Gate | Result | Timing |
| --- | --- | --- |
| Full Node/build check |668 tests passed | Node 39.940/60 s; complete 54.714 s |
| Full browser |119 passed,3 existing skips, all 15 audio cases |216.887/300 s; wrapper 217.099 s |
| Slowest completed case | within 25 s guard |15.669 s |

Lock waits were 0.000105/0.000112 s, excluded. The explicit narrower PR base
(typechecked against#67) also passed all 12 tour browser cases; complete command
37.573 s, with 115.364 s lock wait excluded. This verifies routing compatibility;
the combined implementation supplies Paper and the other feature branches.

Parent inspected fresh desktop 1440 x 900 cutoff,390 x 844 Keep work and 390 x 667
Watch captures. Guidance, focus rings, Stop/End/Close and practice export labels
were readable/reachable. Short-phone previews need internal scrolling. The
three-size canary measured 12 checkpoints/36 controls with bounds, center hit tests
and 44 px minimum heights; no root horizontal overflow. Production-only npm audit
reported zero vulnerabilities. Historical development failures remain retained.

No manual screen reader, real mobile keyboard, GPU completion or physical-speaker
behavior was verified. No merge or deployment occurred. Current PR-head CI and
release approval remain separate from these local checks.
