# Backlog

Everything known to be outstanding, in one place. The [model](model.md) and
[decisions](decisions.md) record what is settled. Written 2026-11-12
at the end of Phase 4, when work paused. Add to it; delete an item when it
ships.

## Next agreed step

The [reviewed layout/context wave](../research/design-review/implementation-brief.md)
is implemented: one in-page editor, small/enlarging live previews, explicit
playing/editing labels, and exact List focus return. Local recovery, document
download and generated-Strudel export are the chosen next retention features;
they remain a separately authorized wave.

## For the design review

- **Theme picker.** The owner dislikes the current colours; not urgent.
- **3D fly-through as a Watch style.** Built in `spikes/spiral`, judged less
  readable than the ring, but the owner would be sorry to lose it.
- **A way from a planet into that instrument's settings.** A planet opens the
  instrument editor only; settings are reached through the sheet.
- **Planets are barely readable** at panel size, and the **room outline is too
  faint** on a busy piece despite a high measured contrast.
- **Watch bands are plain**; short notes on a busy piece are thin.
- **Long names are cut short** under planets. The earlier Watch legend report
  was not reproduced with 14 long names in the 2026-11-14 review.
- **Many instruments on a phone** fall back to the list for touch.
- Phase 0 notes never revisited: the system inset is small; a comment line was
  once used as a breadcrumb name; the "Add to" heading wording.

## Editors

- **Keeping work:** no document save/export or reload recovery. The paste box
  retains imported text after visual edits; loading it again replaces those edits
  and their history. The first retention features are chosen in the model;
  recovery limits and safe replacement still need specification and implementation.

- **Still edited as text:** polymeter, random choice, speed or evenly-spread
  values that are themselves patterns, repeated outer speed marks, negative
  evenly-spread hits.
- **Callback rewrites** (`off`, `every`, `jux` and the like) are read-only or
  edited as source.
- **An instrument that sends to two rooms** is shown only in the one it uses
  most.
- **Delete instrument is refused** when another instrument depends on it or a
  shared rewrite's safety is unknown; there is no guided way through.
- The Setup area's screenshots were never reviewed by the lead.

## Playback and timing

- **A program that behaves at first and loops forever later** can still freeze
  the page (D38). The page cannot interrupt itself mid-question.
- **Edit delay.** The cheap saving is done (D39). Not done, by choice:
  shortening Strudel's scheduling margins. If revisited, expose them through
  the seam and test under deliberate load, counting skipped windows.
- **Section discovery still runs on every edit**; most edits cannot change
  which sounds a piece needs.
- **Sync was never measured at the speaker**, only against the browser's
  reported output delay (D40).
- **Watch drawing has occasional slow frames** (7–20 ms worst against a 4 ms
  aim; median about 1 ms). The owner saw no stutter.

## Tests and process

- **Dev-server port:** Vite's CLI `--port 0` selected its default port during
  the interface wave. The checks used an OS-allocated port instead; repair the
  development launcher in a separate change.

- **Dependency maintenance:** review the development-tool advisories reported by
  `npm audit` (Vite, Vitest and lint dependencies). The production-only audit on
  2026-11-14 reported none. Updates belong in a separate checked change.

- **CI browser time** is about 104 s of a 180 s limit and has reached 128 s
  under load. A requested 10 s saving was not found. Trim before adding more.
- **Two demo tests exceed the 20 s single-test guard**; they run outside the
  normal suite.
- **Pull requests run 500–1,900 lines** against a 400-line aim.
- `metrics/prs.csv`: cycle time measures open-to-merge only; rework-commit
  counts are blank for PRs 42–47.

## Hosting

- Any change to AWS or DNS needs a fresh go-ahead from the owner; the original
  approval covered first setup only.

## Last implementation wave

- **Guided tour — implement last.** After the other outstanding work is complete
  and the interface has settled, build an optional, replayable Driver.js practice
  tour. Cover loading, playback, score editing and Undo, sections/Follow,
  Now/Watch, and the shipped recovery/download/export controls. Preserve the
  visitor's own work and recovery state. The
  [specification](../research/guided-tour-spec.md) defines the proposed flow,
  integration and acceptance checks. Review its mockup before implementation;
  this backlog entry does not start the work. Owner requested this order on
  2026-11-14.
