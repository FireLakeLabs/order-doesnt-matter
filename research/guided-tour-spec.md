# Guided tour specification

Specified 2026-11-14. **Deferred: implement last, after the other outstanding
work in the [backlog](../docs/backlog.md).** Reconcile this specification with
the finished interface before implementation. The owner has requested planning
and backlog tracking; this document does not start implementation.

The settled direction is recorded in [the model](../docs/model.md): use
Driver.js for presentation and navigation, with application-owned lessons and
state transitions. The interaction details below are the proposed implementation
baseline. Review a desktop/phone mockup with the owner before building the UI.

## Result and scope

A new visitor can load a piece, start and stop playback, find an instrument's
settings, make and undo an edit, understand the live views, and keep their work.
Teach the visual instrument in ordinary language; knowing Strudel syntax is not
a prerequisite. Explain rows, settings and real event spans without suggesting
an assumed step grid or a chain of audio processors.

The first release has one short, guided practice tour. Advanced editor lessons,
feature-announcement tours, analytics, accounts, a tour-authoring UI and a
general-purpose onboarding framework are outside its scope.

## Entry and practice safety

- Offer **Take a tour** in the empty welcome state and a persistent **Help →
  Take a tour** entry. Starting is opt-in; visiting or reloading never launches
  an overlay or starts playback automatically.
- Before starting, explain that practice uses an original example and changes
  will be discarded. Provide **Start practice** and **Cancel**. Starting a
  practice session stops existing playback; returning never resumes it
  automatically.
- Keep the visitor's original session intact while practice is active. Retain
  the document, undo/redo history, pasted-but-unloaded text, selected section,
  Follow/solo state, editor target and uncommitted editor input. Re-importing the
  paste box is not restoration: visual edits may have made it stale.
  Wait for already submitted edits to settle before switching sessions; on
  failure, remain in the original session and show its existing error.
- Practice uses disposable state and the ordinary application controls. Isolate
  it from normal recovery/autosave so it cannot replace a saved or recoverable
  piece, including if the page reloads or crashes during the tour. Reload exits
  practice and uses ordinary recovery for the visitor's own work.
- Show **Practice** throughout. **End tour** and completion discard practice,
  restore the original session with playback stopped, and return focus to the
  initiating control or its surviving equivalent. A visitor who started from
  the empty state returns there. Ending does not add an undo entry to their work.
- Keep Stop and End tour reachable throughout. A tour must not require completing
  an action to exit. Back revisits guidance; Undo remains the explicit way to
  reverse a practice edit. Do not replay earlier edits when revisiting a step.

## Lesson sequence

Use the project's CC0 original **Kiln** through the normal load path. Its
arrangement, drum rhythm and bass cutoff provide real targets. Resolve those
targets from the imported document; do not depend on generated IDs or table
positions. Recheck the example against the final editors before implementation.

| Step | Visitor action and explanation | Advance when |
| --- | --- | --- |
| 1. Load a piece | Choose Kiln. Explain that originals or pasted Strudel become a score. | Import, score questions and playback preflight succeed; the score is ready. |
| 2. Play and stop | Press Play. Identify Stop and tempo. Offer **Continue without playback**. | Playback actually starts, or the visitor chooses to continue stopped. |
| 3. Read the score | Identify an instrument row, setting columns and note spans. Pin the section containing the bass. | The chosen section and its bass settings are rendered. |
| 4. Change a setting | Open bass cutoff and make one change. Explain one editor at a time and pending feedback during playback. Point out rhythm and **Edit as source** as other routes. | A valid change is accepted; explain any pending state without claiming it is already audible. |
| 5. Undo | Close the editor, then Undo. | The practice edit is undone and the original cutoff value is restored. |
| 6. Sections and Follow | Pin a different section. Explain the separate playing/editing labels; use Follow to return to the playback context. | Selection and Follow state match the requested actions. If stopped, explain the behavior without requiring playback. |
| 7. Now and Watch | Enlarge and close the live previews. Explain Now's instrument overview and Watch's read-only cycle view; settings live in the score. | Each requested preview opens and closes; stopped views are described as paused. |
| 8. Keep your work | Explain the shipped local recovery, portable document download and generated-Strudel export controls. Distinguish recovery from a portable copy. | The visitor finishes. Download is optional, clearly labelled as the practice example, and uses the real export path. |

Use concise text, a step count, Back where applicable, and an always-available
End tour action. Informational steps use Next; action steps advance from their
completion signal. Optional playback and downloads must never block completion.
Teach the actual limits of recovery, replacement and export once those features
ship; do not promise retention that the app does not provide.

## State, failures and accessibility

Observe existing application state and edit outcomes. A click alone does not
prove loading, playback or an edit succeeded. Do not use fixed delays or invent
parallel document, scheduling or score-query paths for the tour. Keep only one
active playback engine and the existing preview instances.

Use stable semantic tour anchors, resolving elements again after rendering.
Handle the sheet replacing cells, editor changes, and previews moving into or
out of their dialog. Missing required targets pause with Retry and End tour;
never point at empty space or silently mark an action complete. Cancel pending
listeners and asynchronous advances on exit/restart, and ignore stale results.
Errors retain their existing notices. Missing sounds offer retry or continuing
without playback; successful audio loading is not a prerequisite for learning
the score.

Keyboard users must be able to reach the explained control and the tour actions.
Coordinate Escape with the app so one keypress does not also close the editor or
preview beneath the tour. Announce the step's title and instructions, label
buttons, and restore focus on exit. Verify screen-reader behavior rather than
relying on the library's claims. Honor reduced motion, maintain readable contrast
and visible focus, and use touch targets of at least 44 px. At narrow widths,
keep guidance and its control usable without obscuring transport or essential
actions; preserve intentional score-table scrolling.

## Integration and dependency

Own the flow under `src/app/`, preferably `src/app/tour/` with a small adapter
in the page shell. Keep step definitions, practice lifecycle and completion
conditions separate from Driver.js callbacks. Document edits continue through
their existing coordinator. Prefer application signals over DOM-event guesses.

Install and pin a reviewed Driver.js release only when this work starts.
Recheck its licence and APIs then, bundle it locally, load it on demand, theme
it to the finished app, and include its MIT notice in the existing licence
output. No hosted onboarding service or telemetry is needed. A storage failure
must not prevent the tour from running or exiting. Completion persistence is
unnecessary for the first release because the tour always starts explicitly.

The earlier research found relevant support for [interactive actions](https://driverjs.com/docs/action-driven-tours),
[application-completion signals](https://driverjs.com/docs/wait-for-a-save),
[replacement elements and focus](https://driverjs.com/docs/configuration), and
[dialog steps](https://driverjs.com/docs/steps-inside-a-dialog).
These are integration leads, not proof that our finished flow is accessible.

## Acceptance

- Run the entire sequence on real Kiln through the built page, asserting each
  completion condition and exercising an edit followed by Undo. Verify both
  playback and Continue without playback paths without asserting how it sounds.
- Enter with visual edits, redo history, different pasted text, a pinned section,
  solo state and uncommitted editor input. Exit at multiple steps and verify
  restoration. Reload during practice and verify ordinary recovery contains the
  original work. Practice exports must not overwrite its recovery state.
- Exercise failed loading/playback/editing, missing targets, rapid Back/Next,
  entry/exit during pending work, restart and unavailable storage. Verify no
  stale callback changes another session or leaves an overlay, focus trap or
  listener.
- Check keyboard-only completion, Escape ownership, focus return, screen-reader
  announcements and reduced motion. Visually review desktop at 1440×900 and
  phones at 390×844 and 390×667, including enlargement and scrolling.
- Run `npm run check` and `npm run test:browser` with the pinned Node/npm, free
  ports and existing 60 s/180 s budgets. Add focused coverage within those
  budgets; do not raise timeouts or add retries. Measure browser assertions
  separately from visual review and report any unverified accessibility behavior.
