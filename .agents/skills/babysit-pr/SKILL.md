---
name: babysit-pr
description: Follow CI and review when the user asks to monitor, watch, or babysit a pull request.
---

# Babysit PR

Handle current check failures and substantive review findings first. Verify each
finding against the source; keep fixes within the intended behavior. Decline
unneeded scope with evidence. Post replies only when the user's request
authorizes communication, and avoid redundant comments.

Use the active harness's supported PR watcher and waiting rules. Never create a
polling loop or run two watchers on one PR. In T3, the owning top-level thread
calls `watch_pull_request` and ends its turn; delegated children report the PR
and head to their parent without watching. Unwatch before handoff. If the watch
is unavailable, report that limitation and the latest checks you could read.

After each push, verify the new head and follow its checks. Failure or timeout
is not approval. Investigate reproducible failures; distinguish infrastructure
failures from repository defects. A wake is news, not permission to merge.

Before reporting readiness, fetch the base and check the live PR head, checks,
reviews and mergeability. Recheck meaningful rebases or conflict fixes. Report
what remains pending, including required human approval. Merge only with
explicit authorization; otherwise leave the PR open.
