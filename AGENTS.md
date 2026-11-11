# Order Doesn't Matter

A visual instrument for Strudel. It can show any valid Strudel program and lets
you play with the score directly, without making Strudel's syntax the subject.

## Read first

- [The model](docs/model.md): how Strudel works and how we draw it. One page.
- [Decisions](docs/decisions.md): what is settled.
- [Dark corners](research/dark-corners.md): what is not. Evidence, not authority.

## Current phase

Phase 0, design study. No production code. Work lives in `spikes/<name>/`, each
with its own `package.json`, and in `corpus/`. A spike ends with a
`FINDINGS.md` that states what was measured, what was only observed, and what
could not be checked.

## Working rules

- Use the Node version in `.node-version` and npm.
- Strudel versions are pinned: `@strudel/core`, `@strudel/mini`,
  `@strudel/tonal`, `@strudel/transpiler` at 1.2.6; `@strudel/web`,
  `@strudel/webaudio`, `superdough` at 1.3.0.
- Never bind a fixed port. Dev servers and browser tests take a free one.
- Stay inside the directory your task names. Do not commit unless asked.
- Report what you heard or saw separately from what only passed a check.
