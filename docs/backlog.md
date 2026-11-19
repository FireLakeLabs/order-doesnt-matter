# Backlog

Everything known to be outstanding, in one place. The [model](model.md) and
[decisions](decisions.md) record what is settled. Updated 2026-11-19.

## Studio cutover

- **Done:** the Studio is the main page, saved documents survive the switch, and
  the retired interface and its separate browser job are removed.

- **Retired editor shell cleanup:** `src/editor/panel.ts` is unreferenced;
  `src/editor/style.css` retains inert selectors for the retired shell. These
  files were outside cutover ownership and need an editor-owner cleanup.

## Editor and retention boundaries

- **Source fallbacks:** patterned per-cycle counts, legacy/opaque mini chunks and
  unproven forms remain source-editable. Supported structural Lists retain real
  event spans and precise paths.
- **Callbacks:** arbitrary JavaScript, other callback methods and variadic
  `superimpose` remain source-first. Supported branches have navigation and edits.
- **Dependent deletion:** unsafe removal remains refused. Verified dependents are
  navigable; unknown dependencies retain source/mute guidance.
- **Startup recovery failure:** an unplayable saved document stays recoverable
  in Keep work, with its load error visible. A disposable example fallback would
  need to preserve the saved candidate through the replacement flow.
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
  Left: a polish pass.
- **Second wave of views:** all 24 merged, planned in
  [second-wave.md](../research/redesign/second-wave.md); the last five shipped
  in the third wave's 3.1.
- **Third wave of views:** 3.0 (five fixes) and 3.1 (sixteen views) are
  merged, as are 3.2 (Sampler, Stereo glass) and 3.3 (Origami, Orrery's driver
  orbit), planned in [third-wave.md](../research/redesign/third-wave.md). Three
  views remain: Tracing paper (3.4), Strobe and Mixing desk (3.5).
- **Structure queries:** a full queue (32 outstanding) leaves Orrery's driver
  unknown for that window, and failed queries stay cached per key; both need a
  retry policy. Origami raised p95 frame gap by 5 ms in one paired run; profile
  before acting. Orrery's crowded key can say "1 drivers".
- **View follow-ups accepted in review:** extract one shared scored-pitch reader
  (Chord bridge, Light rig and Ribbons each guard locally); share log-band
  extraction between Scope and Afterglow; a real-browser pause/resume probe for
  Afterglow; Marble run stations can share a surface at extreme pitch ranges;
  move the vendor typing for `getCachedBuffer` to the vendor typing home.
- **Scope spectrum offset:** Scope's spectrum is read live while its waveform
  is latency-corrected; measured 51 ms apart (#159). Deriving the spectrum from
  the corrected PCM would align them.
- **Sampler source facts:** exact cursors for pitched banks, explicit pitch,
  looping and modulation need each bank's root and playback rate, and a
  whole-song source list; until then Sampler labels those cursors unavailable.
- **Flash tails past the supplied notes:** Catwalk's camera flash ends early
  when its note leaves the notes the host supplies. Fixing it needs the host to
  supply notes whose effects outlive the window, a contract change.

## Design questions

- Whether heard length should be drawn, and what evidence would support it.
- What a new system display would explain beyond the current context; omit it
  until it has an agreed purpose.

## Hosting

Any AWS or DNS change needs a fresh owner go-ahead; the original approval covered
first setup only.
