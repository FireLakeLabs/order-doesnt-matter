# The model

One page. If the code and this page disagree, one of them is a bug.

## How Strudel works

A Strudel program does not describe sound flowing through boxes. It describes a
**score**: which notes happen when, and what each note is wearing.

1. **A pattern is a question you can ask about time.** "What happens between
   cycle 3 and cycle 4?" The answer is a list of events. Nothing exists until
   you ask, and you can ask about any stretch of time, in any order.
2. **An event is a span of time plus a bag of settings**, such as
   `{ note: "e", s: "saw", lpf: 2700, gain: 1 }`.
3. **Some calls dress the notes.** `lpf`, `gain`, `pan`, `room` and about 400
   others each add one setting to the bag. Two different settings can be
   applied in either order with the same result. This is where the project
   name comes from. The exceptions: setting the same thing twice (the last one
   wins), and a modulator such as `lfo` with no named target, which attaches to
   whatever was set just before it.
   A constant setting keeps the same notes and values wherever it sits among
   rewrites, though Strudel may cut the unheard fragments differently; a setting
   whose value is itself a pattern does not.
4. **Some calls rewrite the score.** `fast`, `rev`, `off`, `every`, `jux`
   change which events exist and when. Here order does matter.
5. **Programs are trees, not chains.** `stack`, `cat`, `arrange`, `off`, `jux`,
   variables and callbacks all branch and merge.
6. **A cycle is a window, not the whole piece.** `<a b c>`, `every(4)`,
   `arrange` and randomness make cycles differ. Randomness is fixed by time, so
   cycle 17 is always the same cycle 17. There is no general way to know when,
   or whether, a pattern repeats.
7. **Not everything is a note.** `sine`, `perlin` and friends are continuous
   signals with no events of their own. They only ever shape a setting.
8. **Sound is made at the end, per note.** Each note starts one voice whose
   internal order is fixed: filters, then crush and distortion, then tremolo,
   compressor, pan and phaser. `.FX()` inserts extra ordered stages before
   that, each with its own private delay and reverb.
9. **Rooms are shared and unruly.** A voice's ordinary delay and reverb sends
   go to a shared **room** (Strudel calls it an orbit). Any note sent to a room
   can change that room's settings for everyone in it, including tails already
   ringing, and when two disagree the winner is not reliably the last one.
10. **What you hear is longer or shorter than what is scored.** Release, delay,
    reverb and sample length decide when a note really ends, and that cannot be
    worked out from the note alone.

## How we draw it

The Studio draws one piece through live views, a score and an editor tray.

| Thing in Strudel      | What you see                                                          |
| --------------------- | --------------------------------------------------------------------- |
| An instrument         | A score lane and rail entry; marks in the chosen live views           |
| A setting over time   | A tile drawn from real values; a **lane** when opened                 |
| What drives a setting | Nested under it in the editor                                         |
| A rewrite             | A numbered chain in the tray; branch controls in its editor           |
| A note                | A mark with its real start and end, never a step in an assumed grid   |
| A continuous signal   | A curve only, never a note                                            |
| A section of the song | A block in the scrub strip; resting instruments collapse in the score |
| An orbit              | **Room**: shared sends shown by views that use room information       |
| The rendered output   | Measured left, right and spectrum, only in views that opt in (D51)    |
| A sample file         | Its decoded waveform, only in views that opt in (D51)                 |
| Code we do not model  | Still visible, playable, and editable as text                         |

Selecting a target opens **one editor** in the tray or wide rhythm area.
Choosing another target reuses it.

## Rules that follow

- We own the document. Strudel comes in one way, and fresh Strudel is generated
  to play it. We do not preserve the text that came in.
- Anything can show the score it produces, whether or not we understand the
  call, because any pattern can be asked what happens.
- Broken is not quiet. A station whose question failed says so; it never looks
  like silence.
- Only settings that are in use are drawn.
- Nothing in the interface may suggest that a setting processes the sound that
  came before it.

## Current interface (2026-11-16)

- The Studio at `/` has two live stages, a view shelf, instrument rail, score and
  tray. Arcade is default; Sunset, Phosphor, Riso and Pocket are alternatives.
- Play/pause, Stop, speed, stepping, scrubbing and whole-cycle loops share one
  transport. The score follows playback or stays pinned to an editing section.
- Supported mini forms and callback branches have structural controls;
  unproven forms keep source editing.
- Keep work offers browser recovery, JSON download/reopening and generated
  Strudel export. Startup restores the latest saved document, including work
  saved before the Studio switch. Keep current/Replace protects later edits;
  storage failures are visible. Undo and transport are not persisted.
- Guided practice uses Studio controls. It retains the original session and
  mounted drafts in memory, excludes practice from recovery, and restores stopped
  playback.

## Not yet settled

- Whether heard length is drawn at all, and if so from what.
- What a system display would explain beyond the existing context.
