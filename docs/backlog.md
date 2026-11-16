# Backlog

Everything known to be outstanding, in one place. The [model](model.md) and
[decisions](decisions.md) record what is settled. Updated 2026-11-15 against the
integrated remaining-work branch. Implemented packages in PRs #56–67 are reviewed
and pass CI; they remain unmerged. Implementation status does not imply deployment.

## Finish the current wave

- **Release approval.** The reviewed feature stack remains open and unmerged.
  Every merge to main publishes; final merge/release needs owner authorization.
- **Final combined acceptance.** The combined implementation including guided
  practice passed 668 Node tests and 119 browser tests, with three existing skips,
  in 216.887 s under the owner-approved limits in [standards](standards.md).
  Current tour-head CI and release verification remain. Full evidence is in the
  [wave record](../research/remaining-work/plan.md).

## Editor and retention boundaries

- **Source fallbacks:** patterned per-cycle counts, legacy/opaque mini chunks and
  unproven forms remain source-editable. Supported structural Lists retain real
  event spans and precise paths.
- **Callbacks:** arbitrary JavaScript, other callback methods and variadic
  `superimpose` remain source-first. Supported branches have navigation and edits.
- **Dependent deletion:** unsafe removal remains refused. Verified dependents are
  navigable; unknown dependencies retain source/mute guidance.
- **Recovery:** one latest browser-managed document, latest writer wins across
  tabs, browser clearing can remove it, and Undo/transport are not persisted.
  Portable JSON and generated Strudel are available; broader persistence is future
  scope rather than a claim of the current recovery feature.

## Playback and timing

- **Arbitrary page execution:** cooperative checkpoints protect authored
  evaluation/query loops and functions, with approximately two seconds of possible
  blocking. Native calls, indirect/generated execution, hostile side effects,
  trigger callbacks and out-of-scope async work still need an off-page boundary.
- **Discovery admission:** constant numeric gain/cutoff edits reuse section
  inventory for a restricted pure generated subset. Unsupported programs still
  rediscover; broaden only with asset-selection and lifecycle canaries.
- **Edit delay:** scheduling margins stay at Strudel defaults (D39). Revisit only
  with deliberate-load measurements that count skipped windows.
- **Speaker sync:** only the browser's reported output delay was measured (D40).
  Physical output measurement remains owner evidence.
- **Watch headroom:** frame-submission measurements are machine-dependent, and
  perspective overlaps can obscure individual notes. GPU completion and motion
  readability are not established by screenshots or submission timing.

## Tests and process

- **Lint advisories:** seven moderate minimatch/typescript-eslint chain entries
  remain without an established compatible remedy. The last recorded
  production-only audit reported none; dependency changes need fresh checks.
- **Redesign wave:** in progress per the [Studio design](../research/redesign/design.md).
  Left: Scope (with the Studio audio tap), the switch to the Studio as the main
  page, and a polish pass.
- **Timing-dependent browser tests:** the Studio transport comparisons, the
  practice start-up wait, the flood delivery count and a Kiln rhythm wait that
  hangs to the 60 s limit failed CI and deploys without a product defect. Being
  fixed before the second wave.
- **Second wave of views:** 24 more views, planned in
  [second-wave.md](../research/redesign/second-wave.md). Starts after the test
  fixes; Afterglow waits for Scope.

## Design questions

- Whether heard length should be drawn, and what evidence would support it.
- What a new system display would explain beyond the current context; omit it
  until it has an agreed purpose.

## Hosting

Any AWS or DNS change needs a fresh owner go-ahead; the original approval covered
first setup only.

## Last implementation wave

**Guided tour — implement last.** The owner approved the
[desktop/phone mockup](../research/guided-tour/mockup.html) on 2026-11-15.
The optional, replayable Driver.js practice flow is implemented through actual loading,
playback, editing/Undo, sections/Follow, Now/Watch and Keep work controls.
Preserve the original session, drafts and recovery state; practice must never
replace the visitor's saved work. Follow the
[specification](../research/guided-tour-spec.md) and
[source-grounded brief](../research/guided-tour/implementation-brief.md).
Session preservation and cancellation preceded visible tour integration. Final-head CI and release approval remain; manual screen-reader and
real mobile-keyboard behavior are unverified.
