# Source and evidence review · 2026-11-14

Evidence, not authority. Baseline `67e6b7f`; read AGENTS and its six linked docs,
all three prior design-review artifacts, current editor/live/spiral code and edit
helpers. All illustration data is authored here in the spirit of the project's
original CC0 Kiln. No third-party composition, frozen-spike import or dependency.

## Source findings (not visual observations)

- `src/app/main.ts` retains `liveOrigin` and sheet origin, closes the panel then
  focuses the initiating control; `src/app/previews.ts` moves existing preview
  nodes, uses a nonmodal dialog and focuses enlarge/close controls. E0 keeps that
  contract. `src/editor/kinds/instrument.ts` currently has rename/mute/solo,
  sounds, counts, section uses and delete, but no settings/rhythm navigation.
- `src/live/model.ts` counts top-level positive room/delay sends over the selected
  playback section/window, chooses the most-used orbit (ties numeric), and drops
  other sends before room conflict aggregation. Default orbit is 1. The count
  sort is **not** an effect-conflict winner. Multi-room UI needs a model change.
- `src/live/constellation-view.ts` reserves at most one room per instrument;
  `src/live/constellation.ts` packs circles/region labels. Full-name List nodes
  are stable in `src/live/panel.ts`. Existing dense-touch fallback and full-name
  Watch legend already exist; they are not missing features to reinvent.
- `src/spiral/view.ts` already draws exact-onset heads, reports unknown spans,
  broken lanes and density bins, and has reduced-motion drawing. `model.ts`
  retains true starts/ends; >128 starts per lane/cycle become occupancy bins.
  Styling needs inspection, not a claim that heads were absent. Ring is default;
  fly-through is only an optional new style proposal and has no animation here.
- `src/import/mini.ts` models polymeter/choice/Euclid; unsupported speed forms
  remain `other`. `step-shared.ts` descends only sub/alternate/together.
  `rhythm-layout.ts` cannot establish timing for all stored forms. The UI already
  says real notes/List for unresolved timing; E0 extends that policy.
- `src/editor/kinds/values.ts` gives choose/polymeter/Euclid/source chunks text
  fields. `rhythm-marks.ts` rejects duplicate mark names and patterned rates;
  `rhythm-euclid.ts` rejects negative or patterned hit counts. More visual controls
  require immutable operations and real-engine canaries, not only new inputs.
- `src/editor/kinds/rewrite.ts` renders primitive/pattern arguments and describes
  callbacks read-only; its nested ordered-list support does not supply callback
  argument editing. `setRewriteArgument` refuses callback values. Preserve source
  fallback, branch order, request version guards and before/after queried strips.
- `instrument-remove.ts` refuses driver/source dependencies and unproven shared
  transformations. Its refusal is a sentence, not a navigable dependency graph.
  Guided UI must add verified addresses first, without claiming opaque source is
  fully understood. A safe deletion and undo already exist.

## Phase 0 notes: bounded dispositions

**Setup comment breadcrumb is still reproducible by source, not fixed.**
`src/document/edit.ts::setupSummary` whitespace-normalizes the entire string,
then matches only anchored sample/helper forms; fallback is first 60 characters.
`src/import/index.ts` slices ordinary setup statements by AST span, excluding
leading comments; an ordinary comment before `samples(...)` does not reproduce
this issue. However, unsafe whole-program retention passes the entire original
source to Setup: `// Setup note\nfunction accent(p){return p.gain(.5)}; note(60)`
therefore misses the helper recognizer and starts its breadcrumb with the comment. `tests/setup-row.test.ts` covers maps,
helpers, register and long fallback, but not comment-leading setup. Proposal:
ignore leading comments for label recognition (parser/token ranges, not a regex
that eats strings); generic `Setup source` if unidentified, retain complete source
in editor. Add regression plus actual desktop/phone Setup inspection in that PR.

**“Add to” is stale wording evidence.** A source search in `src/` finds no literal
“Add to”. Current headings/actions include `Add rewrite` in
`src/editor/kinds/rewrite.ts`, `Add a part` in `rhythm.ts`, `Add value` in
`values.ts`, `Add a section` in `src/sheet/render.ts` / `section.ts`, and the
section membership “Plays in …” in `instrument.ts`. The sheet rewrite button already says `Add rewrite to <instrument>` in its
accessible name. No generic “Add to” heading remains; no rename task without a new
concrete example. These findings do not imply every flow's wording was reviewed.

**System inset is absent.** Current editor panel/kinds and live/spiral views have
no system inset. The historical concept has no surviving production component to
resize. Existing instrument context can support section uses, sound state and
settings/rewrite counts; room memberships need the multi-room model change.
Recommend this bounded summary inside the instrument editor, not a processing
map or a new permanent panel. A new job for a system display is an owner question.

## Verification boundaries

Verification uses the T3 preview browser on this static HTML without a server.
Keyboard and geometry results, capture paths and full-gate timings are recorded
in [verification.md](verification.md). These checks are scoped artifact verification,
not proof of Strudel editing or audio behavior.

The mockup's note spans, status, room membership and dependency explanation are
illustrative. No clocks advance, no notes are queried, and source Apply does not
change an actual document. The fly-through is a frozen depth sketch. Contrast
measurements cover the shown palette token pairs only. No accessibility, universal
layout, conflict protection, camera performance or listening claim follows.

## Proposed living-doc / backlog edits (orchestrator owns these)

- Link this directory as a **proposal awaiting production work** under design
  review; leave all implementation items outstanding until their checked PRs ship.
- Replace “instrument sends to two rooms shown only in one” with “derive and show
  all positive top-level room/delay memberships in queried playback window;
  currently dominant orbit only; preserve unpredictable-conflict wording.”
- Replace “Phase 0 notes never revisited” with “Setup leading-comment fallback
  reproduces in current source; repair label only. Literal Add-to absent; archive
  old wording concern. System inset absent; default to existing context summary;
  new display requires a purpose from owner.”
- Record phone List four-row disclosure, Fern palette, stroke styling and optional
  Watch fly-through as recommendations, not decisions or measured preferences.
- Keep mini forms/callbacks and dependency-guided refusal open, using the brief's
  sequence and semantic canaries. Keep Setup screenshot review open for production.
- Do not alter model/decisions for this research-only package. No lesson proposed:
  existing “look at screenshots” and real-piece seam rules already cover the gap.
