# Lessons

What four phases of building this taught us about how to work, beyond what
[decisions](decisions.md) and [standards](standards.md) already say. Each is
something that went wrong at least once. Written 2026-11-12.

## Writing a task

- **Every task names an end-to-end check on a real piece** (D21). The first
  score sheet passed its tests and was wrong on every arranged song.
- **Say sizes, not adjectives.** "A small constellation" came back as 4-pixel
  dots on a grid. The rework brief gave radii and a share of the box to fill.
- **Size a limit from the whole corpus, never from two pieces.** A flood limit
  of 32 notes per window, measured on two pieces, would have dropped notes from
  an ordinary chord; the corpus maximum was 49.
- **A safety rule must not punish a hiccup.** Stopping playback after one slow
  answer would stop music on a slow phone. Stop on sustained trouble; warn on
  the rest.
- **Give each parallel task its own files**, and say who owns the shared ones.
  When a fix belongs in someone else's files, they report it; the lead wires it.
- **Check that a brief does not contradict itself** before sending it.

## Reviewing

- **Look at the screenshots.** Tests passed on both the tiny planets and the
  unusable narrow rhythm editor.
- **Parallel work is checked together before the last one merges** (D28).
  Each passed alone; together an editor hijacked another's button.
- **Run the suites yourself on the branch.** Implementers' timings taken while
  other work ran were up to twice the quiet figure.
- **The demo is a check** (D33). It found stale instrument copies that no test
  had. It also flags behaviour that is intended: read each limitation before
  calling it a defect.

## Measuring

- **Measure the thing the person experiences.** "364 ms from edit to sound"
  timed the first note of the new code, which could belong to another
  instrument. Timed to the edited instrument's own note it was about 700 ms on
  a sparse piece.
- **Find the cause before tuning.** The edit delay looked like a scheduler
  problem; most of it on arranged pieces was our own repeated questions.
- **A faster setting that skips work is not faster.** Shorter scheduling
  margins cut the delay and skipped scheduler windows.
- **Say what was not measured.** No agent can hear; latency figures are the
  browser's claim, not the speaker's.

## Tests

- **An intermittent failure has a cause.** A test that failed one run in many
  was excluding a note starting exactly at cycle zero. Re-running hid it twice.
- **Wait on signals, never on time,** and keep a hard budget per test and per
  suite (D27). The budget is what made slow tests visible.
- **Strudel's web bundle carries its own scheduler.** Patching `@strudel/core`
  alone changes nothing in playback.

## Working with the owner

- **Show a mockup and ask in plain words** before building anything visible.
- **Keep one list of outstanding work in the repository** ([backlog](backlog.md)).
  Until Phase 4 it lived in pull-request descriptions, chat and the lead's
  private notes, and the owner could not see it.
- **Ask early about things only the owner can judge** (how a delay feels, a
  default, a colour) and keep asking; several went unanswered for two phases.
