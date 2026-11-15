# Order Doesn't Matter

A visual instrument for Strudel. It can show any valid Strudel program and lets
you play with the score directly, without making Strudel's syntax the subject.

## Read first

- [Studio design](research/redesign/design.md): the redesign specification.
- [The model](docs/model.md): how Strudel works and how we draw it. One page.
- [Decisions](docs/decisions.md): what is settled.
- [Standards](docs/standards.md): test rules, boundaries, and ownership.
- [Dark corners](research/dark-corners.md): what is not. Evidence, not authority.
- [Backlog](docs/backlog.md): everything known to be outstanding.
- [Lessons](docs/lessons.md): what went wrong once, so it need not again.

## Current phase

The redesign wave is next; [D44–D47](docs/decisions.md) set the process,
desktop scope and design direction. Details land with its briefs. Preserve the
visitor's session and recovery state through guided practice.

Now (`src/live/`) and Watch (`src/spiral/`) share `src/live/model.ts`.
The app is live at odm.firelakelabs.com
and every merge to `main` publishes. An editor is one file in `src/editor/kinds/`;
a document change is one file in `src/document/edits/`. Production code lives
in `src/`. `spikes/` is frozen reference and must not be imported; `corpus/`
is evidence.

Run `npm run check` for the Node checks and build, and `npm run test:browser`
for the built-page browser suite.

## Working rules

- Desktop only; accessibility and phone support are not requirements.
- Implementers follow `.agents/skills/build`; the lead follows `.agents/skills/orchestrate`.
- Use the Node version in `.node-version` and npm.
- Strudel versions are pinned: `@strudel/core`, `@strudel/mini`,
  `@strudel/tonal`, `@strudel/transpiler` at 1.2.6; `@strudel/web`,
  `@strudel/webaudio`, `superdough` at 1.3.0.
- Never bind a fixed port. Dev servers and browser tests take a free one.
- Stay inside the directory your task names. Do not commit unless asked.
- Report what was measured separately from what was seen. No agent can hear;
  never describe how something sounds.
