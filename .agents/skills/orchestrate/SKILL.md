---
name: orchestrate
description: Run tracked work in waves when the user asks to orchestrate. Editing this skill does not launch work.
---

# Orchestrate

Keep the plan and decisions with the owner. Give each authorized wave a brief
with acceptance checks, scope, dependencies, and a finish line. Launch separate
threads only when the owner requests them; a completed wave does not authorize
the next. Preserve the owner's workflow limits. Without merge authorization,
use [full-stop](../full-stop/SKILL.md).

Settle decisions before dependent work. Record durable decisions in the living
docs; keep evidence and unresolved questions distinct. When delegating, pass the
repository instructions and acceptance commands, directory ownership, and known
failure cases. Follow the active harness's delegation and waiting rules.

Before declaring a wave complete, read its full report, inspect the final diff,
verify acceptance results on the final head, and check CI and reviews. Distinguish
what you checked yourself from the implementer's claims. Track remaining work
explicitly. Check for leftover servers and dirty worktrees. For visual work,
inspect the changed flows when browser work is authorized.

Propose lessons only where the current docs or checks have a gap. Prefer an
executable check to another promise. Changes to scope, new waves, and merges
need the owner's authorization; monitoring and read-only review can continue.
