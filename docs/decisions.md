# Decisions

Append only. A new entry that changes an old one says which one it replaces.
Keep each entry to a few lines.

- **D1 (2026-11-10) Name and home.** Order Doesn't Matter, a Fire Lake Labs
  project, to be hosted at odm.firelakelabs.com.
- **D2 (2026-11-10) One-way import.** The app owns its own document. Strudel is
  imported into it and fresh Strudel is generated to play it. Reproducing the
  imported text is not a goal.
- **D3 (2026-11-10) Opaque stations.** Code the app does not model stays
  visible, playable, and editable as text. It is never dropped.
- **D4 (2026-11-10) Strudel is the engine.** Sound and pattern evaluation stay
  Strudel's job.
- **D5 (2026-11-10) Where tests run.** Import, the document, generation, and
  "which events result" are tested in Node against real Strudel. Drawing is a
  pure function from document to shapes, also tested in Node. Browser tests
  cover only what needs a browser, run against a built copy on a random port,
  and stay under three minutes in total.
- **D6 (2026-11-10) Small living docs.** `AGENTS.md`, `docs/model.md`,
  `docs/decisions.md`, and `docs/standards.md` are the only authoritative
  prose. Anything code can state is generated from code. `research/` is
  evidence, not authority.
- **D7 (2026-11-10) Phase 0 writes no production code.** Everything under
  `spikes/` is throwaway and is not imported by later phases.
- **D8 (2026-11-11) Three views, one editor.** The score sheet with its song
  strip is where you find and edit. The constellation is a live overview and
  the spiral is for watching; neither is an editor. Selecting anything opens
  one editor for that one thing. Evidence: `spikes/editor/FINDINGS.md`,
  `spikes/spiral/FINDINGS.md`.
- **D9 (2026-11-11) Changes are shown pending until heard.** Sound follows an
  edit by about a third of a second, or up to a cycle for a note that plays
  once. The changed element is drawn as pending until the first event that
  carries it. Evidence: `spikes/gesture/FINDINGS.md`.
- **D10 (2026-11-11) Three tiers of understanding.** Understood (purpose-built
  editor), recognised by shape (generic editor for a named call), not modelled
  (source text). Import never drops code. Evidence: `spikes/import/FINDINGS.md`.
- **D11 (2026-11-11) No assumed grid.** Rhythm is drawn and edited from real
  event spans and the nested structure that produced them, never equal steps.
- **D12 (2026-11-11) Missing is not quiet.** Every instrument shows whether its
  sound is loading, ready, or missing. Extends the rule that broken never looks
  like silence.
- **D13 (2026-11-11) Other people's music stays out of the repository** unless
  permission to redistribute is recorded. It may be tested from a local path.
