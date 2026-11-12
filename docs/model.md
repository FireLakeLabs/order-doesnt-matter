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

Three views of one piece, each with one job.

| View              | Job                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| **Score sheet**   | Find and edit. One row per instrument, one column per setting in use, a song strip of sections on top. |
| **Constellation** | Overview. Which instruments are sounding now, and who shares a room. Not an editor.                    |
| **Spiral**        | Watch. One turn per cycle, with "now" as a bright gate. Not an editor.                                 |

| Thing in Strudel      | What you see                                                            |
| --------------------- | ----------------------------------------------------------------------- |
| An instrument         | A row in the sheet; a planet in the constellation; a band in the spiral |
| A setting over time   | A cell drawn from its real values; a **lane** when opened               |
| What drives a setting | Nested under it: a moon of the moon                                     |
| A rewrite             | An ordered chip in the sheet; a **shell** around the planet             |
| A note                | A mark with its real start and end, never a step in an assumed grid     |
| A continuous signal   | A curve only, never a note                                              |
| A section of the song | A block in the song strip; instruments not in it say so                 |
| An orbit              | **Room**: a region around the instruments that send into it             |
| Code we do not model  | Still visible, playable, and editable as text                           |

Selecting anything opens **one editor** for that one thing, named by a
breadcrumb. Nothing else is editable while it is open.

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

## Not yet settled

- How a room shows a conflict whose outcome cannot be predicted.
- Whether heard length is drawn at all, and if so from what.
- How the selected instrument's own system is drawn beside the editor.
