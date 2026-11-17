# Order Doesn't Matter

A visual instrument for [Strudel](https://strudel.cc). A Fire Lake Labs project.

The name is the lesson that started it: in Strudel, `.lpf(800).gain(0.5)` and
`.gain(0.5).lpf(800)` are the same thing. A chain of calls is a score being
written, not sound passing through boxes. (Sometimes order does matter. The app
shows you when.)

The [live app](https://odm.firelakelabs.com/) opens the Studio: two live views,
a score with one lane per instrument, and a tray for editing settings and ordered
rewrites. Five themes, transport controls, Undo, portable exports and browser
recovery are available. Outstanding work is in [the backlog](docs/backlog.md).
Production code lives in `src/`; `spikes/` is frozen reference. Start with
[the model](docs/model.md).

Run `npm ci`, `npm run check` and `npm run test:browser` with the Node version in
`.node-version`. The browser suite runs the Studio and shared engine checks in
sequence against a built copy on an allocated port.

## Transcribing recordings

The local transcription tool moved to
[Ghost Notes](https://github.com/FireLakeLabs/ghost-notes/tree/main/tools/audio-to-midi).
Its README covers installation, versioned song folders and the personal-use-only
drum weights. Existing local output and Python environments remain yours.

## Licence

Our own source is [MIT licensed](LICENSE). The built app includes Strudel and
other AGPL-3.0-or-later code, so the app as distributed is under AGPL terms.
Open **About** for the source of the deployed version and the full licence texts
and third-party notices, also served at `/licenses.txt`.
