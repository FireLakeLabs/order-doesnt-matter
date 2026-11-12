# Backlog

Everything known to be outstanding, in one place. Nothing here is decided or
scheduled; [decisions](decisions.md) holds what is settled. Written 2026-11-12
at the end of Phase 4, when work paused. Add to it; delete an item when it
ships.

## Next agreed step

An overall design review of the interface (D42). The owner's words: the design
is "fine, but a little jumbled." Start it with a plan and mockups; build
nothing first.

## For the design review

- **Live views as previews that enlarge.** Now and Watch start small and can be
  made bigger, instead of a fixed column and a full-window mode.
- **Which panels show when.** The Now panel hides while an editor is open; the
  rhythm drawer cuts off its lowest controls until scrolled.
- **Theme picker.** The owner dislikes the current colours; not urgent.
- **3D fly-through as a Watch style.** Built in `spikes/spiral`, judged less
  readable than the ring, but the owner would be sorry to lose it.
- **Should Now follow playback or the selected section?** Today it follows
  playback, so it disagrees with a pinned sheet while playing.
- **A way from a planet into that instrument's settings.** A planet opens the
  instrument editor only; settings are reached through the sheet.
- **Planets are barely readable** at panel size, and the **room outline is too
  faint** on a busy piece despite a high measured contrast.
- **Watch bands are plain**; short notes on a busy piece are thin.
- **Long names are cut short** under planets and in the legend.
- **Many instruments on a phone** fall back to the list for touch.
- Phase 0 notes never revisited: the system inset is small; a comment line was
  once used as a breadcrumb name; the "Add to" heading wording.

## Editors

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
