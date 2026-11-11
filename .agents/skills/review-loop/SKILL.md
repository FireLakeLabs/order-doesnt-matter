---
name: review-loop
description: Run a bounded model review when explicitly requested or required by an invoked workflow.
---

# Review Loop

Reviewing or editing this skill does not start a review. Use the user's reviewer
choice, then the invoking workflow or repository policy. If none chooses a
reviewer, ask; never substitute a different provider or model unasked.

Establish scope from status, untracked files and the diff against the fetched
base. Run covering checks first. Keep unrelated changes outside the review.
Follow the active harness's delegation rules. The reviewer is read-only and
starts no subagents. Its brief needs repository path, base SHA, intent, scope,
check results, implementation provenance, and the exact diff command.

Ask for APPROVE or CHANGES, with stable finding IDs, file/line, severity,
evidence and the smallest fix. A blocker breaks the intended case; a should is
a real bug callers will hit; other suggestions are nits. Keep a ledger of
accepted, disputed and declined findings, with reasons.

Default to at most three rounds with one reviewer. Later rounds cover changed
code and unresolved findings only; every T3 round uses a fresh delegated task.
Do not edit scoped files while review runs. A timeout or failed review is not
approval. Follow the tool's waiting instructions rather than polling.

Validate each finding yourself. Fix real bugs with the smallest change and a
focused regression check where useful. Decline scope growth with evidence.
Stop on approval of the current behavior diff with no open substantive finding,
or stop and report a dispute or exhausted budget. Nits alone need no new round.

Report the reviewer, rounds, reviewed revision, fixes, unresolved findings and
usage only if known. Keep review attribution separate from implementation
provenance. Push only when authorized.
