---
name: build
description: Use when a brief says to follow the build skill. Implement one task, pass the gates, get one bounded Opus code review, open a pull request and hand back.
---

# Build

You are the implementer. The lead judges whether the result does what the brief
intends. This loop exists so the lead never reads code for small defects. Do not
trade code quality for speed, and do not grow scope to please a reviewer.

## 1. Implement

Stay inside the files the brief says you own. If a fix belongs in someone
else's files, report it; do not make it. Make the smallest change that delivers
the brief's intent and its stated effect.

## 2. Gates: correct yourself here, before any review

Run `npm run check` (format, lint, types, Node tests, boundaries, build) and,
when the brief touches the page, `npm run test:browser`. Fix every failure at
its cause. Never weaken a rule, skip a test or add a suppression comment to
pass. If you believe a gate is wrong, leave it and say so in the handback. Do
not send code to review while a gate fails. Suite durations are printed for
information; they are not gates.

For anything visible, take screenshots on the brief's real piece and look at
them. Compare against the sizes and effect the brief states. Passing tests are
not evidence that it looks right.

If the same gate fails three attempts in a row, stop and report. Do not loop.

## 3. Review: one Opus reviewer, bounded

Commit locally first. Call `orchestrator_capabilities` once and pick the latest
Claude Opus it lists. Do not hard-code an id and do not substitute another
model; if Opus is unavailable, report that as a blocker. Start each round with a
fresh `delegate_task` (`role: "review"`, `mode: "async"`), using the brief
template in [code-review](../code-review/SKILL.md). One reviewer only. Do not
edit scoped files while a review runs, and do not poll. A timeout or error is
not approval.

Budget: three rounds. Round 1 is full; later rounds cover only changed code and
open findings. Extend to five only while a blocker or should stays open with
evidence and concerns data loss, document corruption, playback state or
concurrency. Stop early when a round returns only nits. Declined nits and
comment, doc or format-only fixes need no new round.

Check every finding and its severity yourself. Agree: make the smallest fix,
preferring to delete or narrow over adding a helper, option or guard, plus one
focused test that fails without the fix where the intent needs it. Disagree:
say why with evidence (file:line, test, output). Out of scope: decline in one
line and list it as follow-up. Keep a ledger: id, severity, outcome. Re-run the
gates after fixes. If review grew the diff, cut first. Do not agree just to end
the loop.

Done when the reviewer approves the current behaviour diff with no blocker or
should open. Stuck when an item stays disputed after two replies or the budget
ends: show both sides in two or three lines each and hand back. Budget end is
not approval.

## 4. Ship

Push the task branch and open a pull request: what changed, what a person will
see, how it was checked, screenshot paths, the ledger, and the line
`Reviewed with build loop: <N> rounds with <model>. Verdict: <verdict>`.
Watch CI once through and fix failures at their cause. Leave the pull request
open and unmerged. Never enable auto-merge or push to the default branch.

## 5. Hand back

Report: what a person will now see; what was measured and, separately, what was
seen (no agent can hear; never describe how something sounds); gate results;
review rounds with fixed, declined and open findings; anything needed in files
you do not own. Last line: `PR <full URL>, head <SHA>, checks and reviews <state>`.
