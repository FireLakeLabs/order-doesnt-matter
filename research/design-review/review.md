# Interface review · 2026-11-14

Review following D42. The owner has selected the
[next interface direction](../../docs/model.md#chosen-next-interface-2026-11-14).
Open [the interactive mockup](mockups.html) and use Desktop/Phone, the score's
setting/rhythm buttons, and Enlarge on either live preview. All behavior there is
simulated. [The wave brief](brief.md) records scope and acceptance.

## Findings

1. **Put the score within reach.** On deployed Kiln at 1440×900, with the import
   panel open, the score table began at y=890 and its first instrument at y=980.
   The import form and section metadata occupied the first screen. Closing import
   helped, but still left substantial navigation above the rows. The proposal
   condenses transport and section context, and makes importing another piece an
   explicit replacement flow.
2. **Keep orientation while editing.** Opening bass → lpf hid Now; Escape returned
   focus to that sheet cell. The rhythm editor changed to a bottom drawer. Its
   desktop body showed 252 px of 361 px; lower actions required internal scrolling.
   On the 390×844 phone, the rhythm body showed 349 px of 890 px. These controls
   were reachable by scrolling, not permanently inaccessible. The proposal places
   one editor in normal document flow, preserving score context and live access.
   Tradeoff: longer phone pages; reaching the selected editor needs deliberate
   scroll/focus handling. The owner chose the in-page editor for implementation.
3. **Name editing and playback separately.** Selecting a section pins the sheet;
   Now derives its section from the playback clock ([state](../../src/app/state.ts),
   [live model](../../src/live/model.ts)). This is source-verified behavior. The
   proposal labels both contexts and keeps live views tied to playback, as the
   owner has now chosen.
4. **Protect work before replacing it.** A visual lpf change from 700 to 900 left
   `.lpf(700)` in the paste box. Load reads that box and replaces the edit session
   ([load](../../src/app/controller.ts), [paste](../../src/app/main.ts)). There is
   no document persistence or export UI. The proposal separates import from the
   active document and shows local recovery, JSON download and generated-Strudel
   export. The owner chose these first retention features; none is implemented.
   Recovery policy, replacement confirmation and storage-failure UX need specification.
5. **Make names and return paths reliable.** A synthetic 14-instrument, two-room
   score on the phone used full-name List buttons, each 55 px tall. Planet labels
   were too compressed to identify the long names visually. Watch's legend wrapped
   all 14 names without measured horizontal text overflow; its backlog truncation
   claim was not reproduced. Opening bass from Now's List and pressing Escape
   focused its planet, rather than the initiating List button. The proposal gives
   expanded Now a full-name list and a path into the single instrument editor;
   focus must return to the exact initiating control in later implementation.

## Backlog disposition

The model records the three owner choices. Their implementation and the other
interface-review items below remain outstanding.

| Backlog item | Proposed treatment or remaining evidence |
| --- | --- |
| Small live previews that enlarge | Both previews in the chosen layout enlarge without replacing the score. An enlargement can be restored while the editor remains open. The model records the change to D34's placement; implementation is pending. |
| Panel visibility; rhythm controls | Preserve small live previews during editing. Normal-flow editor avoids nested clipped controls; test a long score and keyboard return before implementation. |
| Theme picker | Defer palette and theme mechanics until hierarchy is chosen. Mockup colours are provisional; no selected theme. |
| 3D fly-through | Retain as a possible optional Watch style. Frozen spike evidence still finds the ring clearer; no 3D implementation in this wave. |
| Now follows playback or selection | Owner chose playback for live views with explicit playing/editing labels. Implementation is pending. |
| Planet → instrument settings | Enlarged Now offers full-name instrument buttons; its one editor offers setting/rhythm navigation. Keep settings off the planet drawing (D37). |
| Planet and room readability | Larger preview has explicit room wording and full-name access. Dense/contradictory room settings still need a detailed visual design; no claim that the mockup solves unpredictable conflicts. |
| Plain Watch bands; thin short notes | Mockup preserves unequal event spans and a gate. Production already has onset heads. Defer stroke/contrast/density tuning to a focused Watch study. |
| Long planet and legend names | Full-name List access is shown. Planet compression reproduced; Watch legend truncation not reproduced. Future checks need unbroken long names and dense pieces. |
| Many instruments on a phone | Preserve List as a first-class touch route. Current 14-row buttons fit, but the list length pushes the sheet down; exact compact presentation remains unresolved. |
| Small system inset | Historical spike concept, absent from current production. Decide whether it still has a job before designing it. |
| Comment used as breadcrumb | Setup now has `setupSummary`; its fallback still uses the first 60 source characters. Investigate a concrete current example before calling this fixed or defective. |
| “Add to” wording | Not found in current production source. Historical note needs a current example before work is scheduled. |

## Owner choices and remaining work

The owner selected the in-page editor, playback-based live views with explicit
context labels, and local recovery/document download/Strudel export. The model is
the authoritative record. Detailed recovery limits, replacement confirmation,
storage-failure feedback, and focus/scroll behavior remain implementation-brief work.

The [next implementation brief](implementation-brief.md) specifies files and
real-piece acceptance checks; it awaits separate authorization. Dependency
maintenance and the later-loop playback limitation remain separate backlog work.
No merge is part of this wave.

## Evidence and limits

- Current app: deployed `b0d9fb3`, inspected through T3 preview at 1440×900 and
  390×844 using original Kiln. Checked import, selected section, a constant edit,
  undo, rhythm drawer, Now visibility and phone Watch. Screenshots were visually
  inspected; coordinates and scroll sizes above were read from browser geometry.
- After List automation failed in T3 and the alternate browser host was unavailable,
  a separate headless Chromium check completed phone editor, List focus, and dense
  long-name checks against the same deployed app. Its captures were also inspected.
  The illustrative score used 14 generated sine instruments, not third-party music.
- Current-app playback/section divergence is source-verified, not a listening or
  subjective sync finding. No agent listened; audio timing was not measured here.
- Mockup fit and keyboard checks, final repository checks, and PR acceptance are
  recorded in the PR. This proposal is not proof of production editing, saving,
  arbitrary dense layouts, room conflict resolution, or audio behavior.
