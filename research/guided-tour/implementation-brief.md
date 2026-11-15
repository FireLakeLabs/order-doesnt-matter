# Guided practice: implementation handoff

Design approved by the owner on 2026-11-15. This records the research baseline;
the tour is now implemented. See the parent implementation acceptance in
`verification.md` for current evidence and limits.

Research against parent `56983ed`; no production tour or dependency added.
Review `mockup.html` before implementation. Open Prototype controls to select a
390×844 / 390×667 device or the empty-entry fixture; Fit window uses the available
viewport. Paper tokens come from `src/app/theme.css`. The score and previews are
illustrations, not captured Strudel results. Controls rehearse the sequence;
restoration, scheduling, downloads and accessibility are not proved by simulation.

## Proposed interaction

Explicit **Take a tour** in the empty welcome, plus **Help → Take a tour** at all
times. Help is a proposed addition; today there is About, no Help menu. A compact
entry dialog offers Start practice / Cancel and says that the example is disposable,
starting stops playback, and returning keeps it stopped. Do not launch on reload.
Cancel changes nothing. The existing-work fixture has a visually edited cutoff of
900 Hz, an unfinished 850 field, and different unloaded paste text. Return shows
that distinction; it is illustrative, not a recovery test.

Keep the existing app structure: transport, The score, one in-page editor, and
Now / Watch previews that enlarge. Desktop reserves 320 px beside it for guidance.
Phones reserve space below the app, with the step text scrollable independently;
Practice / End tour and Back stay outside that text scroller. During practice only,
keep transport outside the score scroller so Stop is always visible. This requires
an app-shell layout seam; the current page header scrolls with the page. Keep the
intentional horizontal score scrolling. The prototype's entry modal precedes
practice; ongoing practice and enlarged previews do not trap access to transport.

Eight lessons, no extra wizard or grid:

| Lesson                | Actual target / completion contract to implement                                                                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Load a piece        | `examples` Kiln button → ordinary `app.load(example.source)`; await successful import, preflight and all required score answers, not its click or only `canPlay`.                                                                                                                |
| 2 Play and stop       | `#play`, `#stop`, `#tempo`; engine transport starts, or Continue without playback. Stop remains available during preparation and all later steps.                                                                                                                                |
| 3 Read the score      | Pin Section 2, cycles 4–12, containing bass. Resolve the arrange occurrence with the imported bass use; verify bass and its settings rendered. Name rows, setting columns and real spans.                                                                                        |
| 4 Change a setting    | Bass's `lpf` = 700 Hz, labelled as cutoff in guidance. Open real constant editor; submit a distinct valid value. Observe accepted edit outcome. Explain pending as scheduled feedback, never proof of audibility. Mention drum Rhythm and Edit as source without requiring them. |
| 5 Undo                | Done, then ordinary Undo. Match restored bass cutoff to 700 and the expected history operation, rather than treating any document change as success.                                                                                                                             |
| 6 Sections and Follow | Pin Section 3 (12–28), then Follow. Verify both transitions. `contextLabels` separates Editing from Playing; while stopped Follow stays armed but does not move the window (`tick(null)`).                                                                                       |
| 7 Now and Watch       | Enlarge Now / Close, Enlarge Watch / Close using existing instances. Observe each actual open/close and focus return; each preview remains paused when stopped. No settings editor in Watch.                                                                                     |
| 8 Keep your work      | Open Keep work. Explain one latest browser/device document, browser clearing, portable JSON and fresh generated Strudel. Finish never requires a download.                                                                                                                       |

The original Kiln (`corpus/programs/piece-kiln.strudel`, CC0) has four arrange
occurrences: drums 0–4, drums+bass 4–12, all 12–28, pad+lead 28–32; bass starts at
700 Hz, tempo 33 cycles/min. Resolve instrument/setting targets through
`instruments`, `sections`, shared-reference/use relationships and `describeTarget`,
then find the matching semantic anchor after rendering. Never store generated IDs,
`nth-child` or section indices as the target contract. The prototype condenses the
score; production keeps every row, setting and absence indicator.

Action completion advances from app outcomes; Back revisits guidance and does not
rerun loads, edits, Undo or downloads. Remember completed lesson predicates within
this practice run so revisiting does not deadlock on an already restored value.
Informational explanations may use Next after their requested actions are met.
Missing targets pause with **Retry** / **End tour**; do not skip required lessons.
Retain existing errors, offer Play retry / Continue without playback for missing
sounds. No forced downloads and no stored completion flag. Unsupported forms remain
source-first through the shipped Edit as source path; no tour-specific parser,
importer, document edit, scheduler, query pool, camera or palette.

## Retain the original session: required seams

Retain the **same controller** and original EditSession, not just serialized Doc.
Prefer a small controller-owned suspend/activate pair for two session records,
using the same existing engine and query services. Do not call `createApp()` a
second time. Keep the original record in memory until exit. Proposed names below
are contracts to add, not claims that those APIs exist.

| Preserve                        | Existing ownership / missing seam                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document and Undo+Redo          | `controller.ts` closes over `state` and `editor`; `session.ts` closes over full `h` (past, present, future, depth, gesture group). `loadDocument` currently **disposes** editor and constructs another. Add an internal session record / suspend switch preserving these identities; do not restore by `load`, `loadDocument`, JSON import or Undo.                                                                                                                                                                                                            |
| Submitted edits                 | `session.ts` owns running, queued and timer; the source kind owns async validation; controller owns serialized `swaps`, loads, preflight and `starting`. No public quiescence/result API. Add an outcome-bearing drain/barrier that admits no new submissions, waits for latest submitted work (including rollback), and reports failure. `entries` empty and `canPlay` alone are insufficient.                                                                                                                                                                |
| Pasted but unloaded text        | `main.ts` DOM `#source.value` can differ from `state.source` after edits or typing. Capture value, selection, scroll and disabled state before entry's focus/blur; keep both values. Main's editor-session-change subscription currently clears target and sometimes source: make it session-aware.                                                                                                                                                                                                                                                            |
| Pinned section, Follow, solo    | `AppState` owns selected, follow, fromCycle/toCycle, solo; `selectSection` pins, `startCycle` changes Play's start. Retain the original values, including absolute repeated-cycle window. Practice must not call original `select`, `follow` or `solo`.                                                                                                                                                                                                                                                                                                        |
| Editor target and return origin | `main.ts` locals targetId, origin (id/control/row), liveOrigin and selectedSession, plus panel mount. Expose a shell session binding retaining target and semantic origin; nodes can be replaced by sheet render and preview reparenting.                                                                                                                                                                                                                                                                                                                      |
| Uncommitted field input         | Constant editor only preserves its draft while focused; source editor owns textarea, errors and busy state; `EditorKind` only offers update/destroy. Add explicit suspend/resume draft capture before focus leaves, or park the original mounted editor without update/destroy and gate it inert. Generic DOM value capture alone misses kind-local state. Preserve text (including invalid/partial values), checked/selection/scroll, field focus identity and kind-local draft state. Never blur-submit an unfinished `change` field just to enter practice. |
| Exact exit focus                | Capture initiating control and semantic fallback before opening entry; after restoring original shell/drafts, focus that same Help or welcome control with preventScroll. If rerendered, resolve its semantic equivalent; if gone, use surviving Help. Retain the editor's prior field selection so it remains intact when revisited; exit focus itself belongs on the entry control, as the spec requires.                                                                                                                                                    |

Entry ordering: capture drafts **before focusing Help or opening the entry dialog**, fence
new submissions, wait for already submitted edits / source validation / loads /
transport starts to settle using explicit outcomes, then stop the original engine
via the ordinary transport. Stop cannot be the barrier: `stop()` calls
`editor.clear()`, which cancels queued work and resets pending to current Doc.
Keep a draft snapshot on input and guard the entry pointer/focus transition: an
`onclick` snapshot is too late if focusing Help already fired a field change.
A failed drain leaves the original session and its existing error visible, without
loading practice. Starting remains cancellable; Stop and Cancel remain available
while waiting. Do not wait forever for a sparse instrument trigger: distinguish
submission/commit completion from its pending scheduled-note display. On successful
settlement, stopped state can clear display-only pending via the existing semantics.

Practice activation then moves the retained original aside without disposing it,
suspends its retention, creates disposable editor/state under that controller,
and uses the **normal Kiln load path**. Refactor the internals of that path to avoid
its current disposal/replacement confirmation against the retained original; do
not invent a second import or validation path. Explicit Start practice is consent
to the disposable switch, not to replacing original recovery.

## Recovery, engine and cancellation boundaries

`retention.ts` already has namespace and `suspend(boolean)`. `record` skips writes
while suspended, but `adopt()` still clears candidate and suspension does not
suppress initial reads. Suspension alone is therefore insufficient. Keep the
original retention object's candidate/last/notice intact, flush the settled
original Doc through its normal record policy before switching (respect an existing
unadopted recovery candidate), and bind practice to an in-memory retention object
whose storage has no persistent writes. Do not read normal recovery into practice.
No practice marker or resumable tour goes into localStorage. A reload/crash creates
the ordinary original controller and offers its ordinary recovery; it must never
find practice there. Recovery stores Doc only, not Undo, drafts or UI state across
a crash. If storage is full/unavailable, preserve in-memory original, show existing
failure notice, and still permit entry/exit. Do not promise crash recovery then.

Only the original controller owns the one lazy engine. Every switch first invalidates
transport/load/window/watch generations and cancels queued or active query work.
Existing revision/epoch checks and `createBrowserQueries.cancel()` are useful but
there is no complete controller suspend/dispose method. Add one coherent activation
generation around load continuations, play's catch/finally, solo rollback, retained
editor ports, subscriptions and frame work. A late callback from a prior session
must not mutate active state, save practice as original, or restart playback. Map
engine revisions to session activation ownership too: `observe` currently forwards
events to whichever editor is active; a late trigger/commit from the old score
must not acknowledge the practice editor.
Drain existing serialized swaps before activating practice. Do not dispose the
original history; cancel obsolete engine work and display listeners separately.

End / Finish / Escape share one idempotent exit: abort lesson subscriptions and
advances first; stop practice and invalidate its pending transport/query/edit
callbacks; close/reparent enlarged previews using their existing shrink route;
discard disposable practice state; rebind the same original session/controller,
drafts and UI values with playing=false; resume original retention; then restore
entry focus. Do not resume playback, append an undo entry or re-import paste text.
Release all listeners on exit/restart. Use one AbortController per practice and
per lesson, plus an activation token for promises that cannot abort. Automatic
advance requires current token, session, lesson and target predicate. Rapid Back,
Stop or restart invalidates old work immediately; no fixed delay means success.

## Driver.js adapter proposal

Propose exact pin **`driver.js: "1.10.2"`**, locally bundled and dynamically loaded
only on explicit entry. Reviewed official [latest release](https://github.com/nilbuild/driver.js/releases/tag/1.10.2),
[tagged package manifest](https://github.com/nilbuild/driver.js/blob/1.10.2/packages/driver/package.json)
and [tagged MIT licence](https://github.com/nilbuild/driver.js/blob/1.10.2/license).
Upstream's former kamranahmedse URL redirects to nilbuild. No dependency installed.
Include the complete copyright/permission/warranty notice through the existing
`scripts/licenses.ts` output and licence test when implementation adds the package.
Recheck registry tarball integrity and exported types then; live docs can move ahead
of the tag. These research links establish a proposed version, not a supply-chain audit.

Use the smallest presentation adapter: `driver`, `drive`, `moveTo`/`movePrevious`,
`refresh`, `updatePopover`, `destroy`; application-owned outcomes choose when to
`advance` or `moveNext`. Official [API](https://driverjs.com/docs/api),
[action tour](https://driverjs.com/docs/action-driven-tours) and
[wait-for-save recipe](https://driverjs.com/docs/wait-for-a-save) support this separation.
Do not use `advanceOn: "click"` for import, playback or edits. No instructional
pulsing/shaking needed; use reduced motion and application outcome notices.

The [configuration reference](https://driverjs.com/docs/configuration) describes
function/selector targets, allowedElements, replacement callbacks, focus modes and
missing-target hooks. Keep Stop, End tour, Back, the active editor and preview Close
allowed. Do not accept the default centered missing-element popover or `"stay"`
pointing at vanished geometry. Use the app's Retry/End paused state. Reserve the
same desktop/phone layout space as the mockup; configure/position the Driver popover
within it, validate after render, and scroll the actual target clear of transport.
Avoid a new generic positioning framework. No second renderer or preview instance.

[Dialog recipe](https://driverjs.com/docs/steps-inside-a-dialog) documents moving
overlay/popover into a native dialog. That is not proof of our focus behavior:
`previews.ts` uses **nonmodal `dialog.show()`**, reparents the view and focuses Close;
Keep replacement/About use `showModal()`. Test both reparenting and focus scope.
Expose the existing preview open/close state and shrink method rather than cloning
content as this illustration does. Ensure in-dialog guidance cannot make Stop or
End unreachable; choose an allowed nonmodal presentation and verify actual Tab order.
The mockup illustrates reserved space, not Driver's default popover.

Disable Driver keyboard navigation (`allowKeyboardControl: false`) and give the app
one capture-phase Escape owner: during practice, one Escape ends the tour and
restores original stopped state, suppressing the editor/preview handlers below.
Entry Escape means Cancel; outside practice keep existing behavior. Main's current
Escape handler closes previews/editor and ignores only About/Keep dialogs, so this
needs a real shared ownership seam. Driver's automatic focus return is conditional
on focus still being on its popover; use explicit app restoration instead. Verify
Tab/Shift+Tab, Enter, editable arrow keys, no trapped focus, polite step announcements,
zoom, reduced motion and at least 44 px targets. Screen-reader behavior remains
uncertain until manual assistive-technology testing; the library's claims do not
certify this integration.

Source anchors: [controller](../../src/app/controller.ts), [shell](../../src/app/main.ts),
[retention](../../src/app/retention.ts), [Keep work](../../src/app/keep.ts),
[session](../../src/editor/session.ts), [pending](../../src/editor/pending.ts),
[history](../../src/editor/history.ts), [editor contract](../../src/editor/kind.ts),
[constant draft](../../src/editor/kinds/constant.ts), [source draft](../../src/editor/kinds/source.ts),
[previews](../../src/app/previews.ts), [context](../../src/app/context.ts),
[query cancellation](../../src/strudel/evaluate-browser.ts).

## Next implementation order

1. Owner reviews this compact layout and copy. Default: downloads optional, renamed
   **Download practice document** / **Export practice Strudel**, with practice
   filenames; Continue without playback always offered. No essential choice left
   open beyond design approval.
2. Add/test session retention and pre-blur draft capture, submission barrier,
   stopped restoration, crash/reload isolation and cancellation **before tour UI**.
3. Expose semantic anchors/outcome signals and preview lifecycle. Resolve real
   Kiln targets using the existing model; keep source-first limits.
4. Add the pinned Driver adapter, entry, reserved guidance and eight lessons.
   `keep.ts` needs active-session binding plus practice labels/filenames; reuse
   `downloadDocument()` / `exportStrudel()` and its Blob path, never mock exports.
5. Parent runs the spec's real built-page acceptance: both playback paths, edit/Undo,
   original histories/drafts/solo/pin, exit at multiple points, reload/crash recovery,
   failures/missing targets/storage denial and rapid navigation. Lock shared browser
   work, retain 60 s Node / 25 s cases / 300 s browser command, no retries or deadline
   changes. Manually review keyboard, three sizes, screen readers and reduced motion.

Parent owns living-document reconciliation: model/backlog still describe retention
as future work despite the integrated source shipping it. This research changes none
of those documents and makes no CI, audio, recovery or production-accessibility claim.
