---
name: orchestrate
description: How the lead runs a wave. Write briefs, hand them to implementers, judge results against intent. The lead does not implement and does not review code line by line.
---

# Orchestrate

The lead's attention is the scarce resource. Spend it on what to build, whether
it was built, and whether it is delightful. Implementers own the code; the
build skill's gates and Opus review own code quality.

## A brief has

- Intent, in two or three sentences, and what a person will see when it works.
- The effect it should have, stated as sizes and behaviour, never adjectives.
- The files the task owns, and who owns shared ones.
- One end-to-end check on a named real piece from `corpus/programs/`.
- What is out of scope.
- The line: `Follow .agents/skills/build/SKILL.md. You may start one Opus
reviewer per round as that skill describes, and no other subagents.`

Check the brief does not contradict itself before sending it. Implementers work
in their own worktree and open their own pull request.

## Running a wave

Give parallel tasks disjoint files. Land shared contracts first, alone. Do not
poll running tasks. When parallel pull requests are ready, check them together
on one branch before the last one merges.

## Judging a result

Look at it running on the real piece: screenshots first, then the page. Ask:
does it do what the brief intended, and does it have the stated effect? Read
code only where the ledger shows an open dispute or the behaviour is wrong.
Send back with a specific, sized correction. The owner merges.

## Do not

Add verification write-ups, recorded demos, metrics upkeep, word budgets or
time budgets. Do not require phone layouts or accessibility checks. Do not ask
for conservative defaults: say what would make it good.
