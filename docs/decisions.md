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
- **D14 (2026-11-11) One Strudel seam.** Only `src/strudel/` imports Strudel.
  Every reach below its documented surface lives there with a test that fails
  if Strudel changes. Enforced by `check:boundaries`.
- **D15 (2026-11-11) The document is one ordered list.** `Doc.body` holds
  setup, tempo, shared patterns, instruments and global transforms in evaluation
  order; it is plain JSON. Derived state (rooms, sound loading, pending) is never
  stored. Replaces the parallel lists in the Phase 0 draft.
- **D16 (2026-11-11) Budgets are checked, not promised.** The browser suite
  fails over three minutes; the four living documents fail over their word
  budgets; fixed ports fail the boundary check.
- **D17 (2026-11-11) An instrument is a leaf of the score tree.** Walk each
  top-level pattern down through groups and shared names; each leaf, with its
  own layers, is one instrument however many sections use it. Layers applied on
  the way down are that instrument's section-local changes, not new instruments.
  A bare `silence` is a spacer, not an instrument. Sections come from a single
  top-level `arrange`. Replaces "one row per top-level pattern".
- **D18 (2026-11-11) One section at a time.** The song strip shows the whole
  song; cells show the selected section, or a four-cycle page when there are no
  sections. Follow tracks the playhead; choosing a section pins it, and Play
  then starts there.
- **D19 (2026-11-11) Not loaded yet is its own state.** Before the engine has
  looked at a sound it says "not loaded yet", distinct from loading, ready and
  missing. Extends D12.
- **D20 (2026-11-11) Score questions run in a worker with a time limit.** A
  pasted program that never finishes becomes a broken row, not a frozen page.
  Playback still evaluates on the main thread; that gap is open.
- **D21 (2026-11-11) Every wave contract has an end-to-end check on a real
  piece.** Wave 1's parts each passed alone while the seam between them was
  wrong for arranged pieces.
- **D22 (2026-11-11) Hosted from `main`.** odm.firelakelabs.com is its own
  stack; every merge to `main` publishes after its checks. Runbook:
  `infra/README.md`.
- **D23 (2026-11-11) Edits go through one coordinator.** One swap runs at a
  time with the latest value queued; a rejected swap restores the last confirmed
  document. Measured edit-to-scheduled-sound delay: median 364 ms, worst 443 ms
  over 20 edits on one machine. Whether that feels acceptable is the owner's call.
- **D24 (2026-11-11) Editors are files.** One editor kind per file, one document
  edit per file; the panel shell is shared. Six kinds so far: constant, values
  over time, signal, rewrite, instrument, and a read-only fallback that gives
  the reason.
- **D25 (2026-11-11) Silence is acknowledged.** The engine reports `committed`
  when new code is in effect but has no note to play, so a change that mutes
  stops being pending. Extends D9.
- **D26 (2026-11-11) "The same notes" means note starts and their values.**
  Comparisons that decide whether a change is safe ignore fragments that never
  sound. Evidence: 720 program pairs; `fast`, `slow`, `early`, `late` across a
  constant setting differ only in fragments.
- **D27 (2026-11-11) One gate per pull request, both budgets enforced.** The
  Node suite fails over 60 seconds as the browser suite fails over three
  minutes. No retries, no raised timeouts: a slow test is fixed at its cause.
- **D28 (2026-11-11) Parallel pull requests are checked together before the
  last one merges.** Wave 3.1's four editors each passed alone and three
  failed once combined.
- **D29 (2026-11-12) Document version 2.** Every group member has its own id,
  shared patterns say what they are for and whether the author named them, and
  a localized copy points at the instrument it came from. `migrate` brings
  version 1 forward. Extends D15 and D17.
- **D30 (2026-11-12) An editor may ask for room.** A kind declares `wide` to
  dock along the bottom at full width; the rhythm editor does. Boxes are at
  least 20 px with a mouse and 44 px with touch.
- **D31 (2026-11-12) Rhythm has two views of one structure.** Boxes, where each
  part is as wide as its real time, and List. Timing the stored structure
  cannot establish is never drawn as boxes; the real notes are shown instead.
  Implements D11.
- **D32 (2026-11-12) Text is always available.** Every editor offers "Edit as
  source"; what is typed is re-imported in place and becomes an ordinary
  editable setting when the notes come out the same. Implements D3.
- **D33 (2026-11-12) The demo is a check.** Each phase's recorded demo asserts
  every step on a real piece and lists what it could not do. Phase 2's found
  that a section made separate kept stale copies of its instruments.
- **D34 (2026-11-12) The sheet stays; the live views sit around it.** The score
  sheet is always present and is where editing happens. A small Now panel beside
  it draws the constellation; the spiral is a full-window Watch mode. The owner
  chose this over three switchable views.
- **D35 (2026-11-12) Live views read the score, not the audio.** Who is sounding
  is derived from the events the app already holds and the playhead
  (`src/live/model.ts`), checked against engine triggers on a real piece. No view
  adds load to playback.
- **D36 (2026-11-12) Unknown is not quiet.** Time nobody has asked about is drawn
  as "not asked yet", never as empty; a looping arrangement's end is labelled as
  an end that repeats.
- **D37 (2026-11-12) The constellation always fits.** No zoom levels; planets
  are sized to the box; settings and rewrites are not drawn on planets. With many
  instruments, names and touch fall back to the list.
