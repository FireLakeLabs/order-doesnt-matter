# Backlog

Everything known to be outstanding, in one place. The [model](model.md) and
[decisions](decisions.md) record what is settled. Updated 2026-11-16.

## Studio cutover

- **Done:** the Studio is the main page, saved documents survive the switch, and
  the retired interface and its separate browser job are removed.

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

## Tests and process

- **Lint advisories:** seven moderate minimatch/typescript-eslint chain entries
  remain without an established compatible remedy. The last recorded
  production-only audit reported none; dependency changes need fresh checks.
- **Redesign wave:** in progress per the [Studio design](../research/redesign/design.md).
  Left: Scope (with the Studio audio tap) and a polish pass.
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
