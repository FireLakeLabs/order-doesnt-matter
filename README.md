# Order Doesn't Matter

A visual instrument for [Strudel](https://strudel.cc). A Fire Lake Labs project.

The name is the lesson that started it: in Strudel, `.lpf(800).gain(0.5)` and
`.gain(0.5).lpf(800)` are the same thing. A chain of calls is a score being
written, not sound passing through boxes. (Sometimes order does matter. The app
shows you when.)

Status: Phase 1, the walking skeleton (paste Strudel, hear it, see the score sheet
and song strip, edit a constant setting). Wave 0 provides the foundations; those
flows follow in Wave 1. Production code lives in `src/`; `spikes/` is frozen
reference and must not be imported. Start with [the model](docs/model.md).
