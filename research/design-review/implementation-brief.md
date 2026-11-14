# Proposed next wave · in-page editing and live context

Status: ready for owner authorization; no implementation has started. Direction
comes from [the model](../../docs/model.md#chosen-next-interface-2026-11-14).
Use the [mockup](mockups.html) for hierarchy and interaction, not as a new engine
or document implementation. Preserve existing editing semantics.

## Result and scope

The score remains the editing home. One editor opens in the page, with its
selected row and breadcrumb identifiable. Small Now/Watch previews remain
available during editing and enlarge without destroying editor state or
interrupting transport. Live views follow playback; explicit playing/editing
labels explain a pinned sheet's different section. Returning from an editor or
enlargement restores the exact initiating control when it still exists.

This wave changes layout, view lifecycle, context labels and focus handling.
Recovery, document download and generated-Strudel export are the chosen first
retention features, for a separately authorized wave. Themes, 3D, new editors,
audio scheduling, dependency updates and hosting are outside this scope.

## Ownership after authorization

- Orchestrator owns `src/app/main.ts`, `src/app/controller.ts`,
  `src/app/style.css` and shared integration tests. It preserves one engine,
  worker deadlines, the edit coordinator, and one view instance per preview.
- A layout delegate owns `src/editor/style.css`, `src/live/style.css` and
  `src/spiral/style.css`: editor in page, readable controls, preview/enlargement
  sizing. It reports shared-shell needs to the orchestrator.
- A focused delegate owns a new layout/context browser spec under
  `tests/browser/`; it coordinates selectors with the orchestrator and preserves
  current assertions. Existing specs remain the orchestrator's responsibility.

Give delegates `AGENTS.md`, its six linked docs, this brief and explicit file
ownership. They do not change shared files, commit, push, merge or add delegates.
Launch no work until the owner authorizes this wave.

## Acceptance and known failures

- On original Kiln, edit bass cutoff, undo, open rhythm, return to the selected
  row, and enlarge/shrink both live previews while stopped and playing. Preserve
  the document, editor target, pending state, transport and undo history.
- Start playback in one section and pin another. The labels identify both;
  Follow resumes the sheet's existing behavior. A stopped view is labelled paused.
- At 1440×900, 390×844 and 390×667, controls remain reachable without page
  horizontal overflow or hidden lower actions. Preserve intentional score-table
  horizontal scrolling and real event spans. Touch targets remain at least 44 px.
- Exercise a generated 14-instrument, two-room score with long names. Names are
  available in List/legend; List → editor → Escape returns to that List button.
- Enlarging Watch preserves its read-only role; Now's instrument entry preserves
  the single-editor rule. A resize preserves selection and input focus.
- Use existing worker/cache paths for preview questions. Do not add score queries
  to playback or duplicate animation loops when a preview enlarges or shrinks.
- Run `npm run check` and `npm run test:browser` with the pinned Node/npm and free
  ports. Retain 60 s/180 s limits, existing assertions and no retries. Inspect the
  changed desktop/phone flows visually; automated geometry alone is insufficient.

Finish with a reviewed, checked, open PR, leaving merge to the owner. Report
actual size against the 400-line aim and any unmet checks. A completed wave does
not launch the retention wave. No AWS/DNS change is authorized.
