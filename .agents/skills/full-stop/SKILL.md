---
name: full-stop
description: Take an explicitly requested full-stop task through implementation and an open PR, leaving merge to the user.
---

# Full Stop

Implement the authorized task, run the repository checks, review the final diff,
and use [file-pr](../file-pr/SKILL.md). Commit and push on the task branch. Follow
[babysit-pr](../babysit-pr/SKILL.md) through CI and review, fixing justified
findings. Use a model review only when requested or required by project policy.

Leave the PR open and unmerged. Never enable auto-merge, enter a merge queue,
push to the default branch, or bypass protection. Check for existing automatic
merge settings before pushing and prevent an unintended merge within the task's
authorization. Report any blocker you cannot resolve.

At handoff, fetch the base and check the live head, checks, reviews and
mergeability. Proof must cover the final behavior diff, including meaningful
conflict fixes. Report ready, awaiting human approval, or blocked with the
specific reason. Include the PR link, head, evidence and remaining limits.
Stop the PR watch before handing back, according to the active harness's rules.
