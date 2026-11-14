# Interface design review · wave 1

Authorized on 2026-11-14 after the Phase 4 status review. This is evidence and a
proposal, not a new product decision. D42 and the backlog define the starting
point; the owner chooses the implementation direction after seeing the mockups.

## Scope and finish line

Review importing a piece, finding an instrument and setting, editing, returning
to the score, watching playback, and retaining work. Deliver a concise review and
interactive desktop/phone mockups in this directory, with remaining decisions
explicit. Finish with a checked, open PR; leave it unmerged.

Production code, dependencies, playback tuning, AWS/DNS, and implementation of
the proposals belong to later authorized waves. Saving/recovery is a design
question in this wave. The mockups do not play or save a real document.

## Ownership and dependencies

- Orchestrator: this brief, final review, README/backlog pointers, browser inspection,
  integration, acceptance results, PR, and CI.
- Workflow reviewer: read-only analysis of source and existing evidence; report
  findings and source locations to the orchestrator. No file changes.
- Designer: `mockups.html` only. Build proposed states from D42 and the backlog;
  identify assumptions. Final owner decisions remain unresolved.

Read `AGENTS.md` and all six documents it names before working. Use the pinned
Node and npm. Keep Strudel behind its seam, spikes frozen, and third-party music
out of new artifacts. No agent can hear; separate measured results from visual
observations. Use original Kiln for current-app checks and illustrative data in
the mockups. No commits or pushes by delegates; no additional delegation.

## Acceptance

- Review every design-review backlog item, distinguishing current evidence,
  proposed treatment, deferred work, and owner decisions.
- Exercise a loaded score, setting editor, rhythm drawer, Now, and Watch at
  desktop and phone sizes; describe only behavior actually inspected.
- Mockups show score, one editor, small/enlarged live previews, section versus
  playback context, long names, and an explicit save/recovery proposal.
- Primary mockup controls work with a keyboard. At 390 px and desktop width,
  labels and controls fit without page overflow or inaccessible bottom controls.
- Preview the final mockup with `html_preview`, then show it with `html_render`.
  Record checks separately from observations; label simulated product behavior.
- Run `npm run check` and `npm run test:browser` on the final artifact diff.
  Preserve the 60-second Node and 180-second browser budgets and use free ports.
- Inspect the full diff, check the final PR head/CI/reviews and mergeability,
  and account for owned servers and dirty files before handoff.
