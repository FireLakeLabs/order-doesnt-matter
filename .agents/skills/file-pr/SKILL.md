---
name: file-pr
description: Open a pull request when the user asks to file, open, or create one.
---

# File PR

Check whether the branch already has a PR. Inspect status and the diff against
the fetched base, including untracked files, before committing or publishing.
Keep unrelated changes out. Honor the user's title, template, base and branch.

Lead with the problem and resulting behavior. Give reproducible checks and
measured results; distinguish unchecked behavior from observed evidence. State
material disagreements and limitations. Include the public implementation model
and harness when known, without guessing or conflating reviewer attribution.

Use a temporary body file with `gh pr create --body-file` to preserve newlines
and literal text. Check the description and attachments for private information.
Open a real PR unless the user requests a draft. Link it through the active
harness immediately after creation or push. If asked to wait for CI, follow
[babysit-pr](../babysit-pr/SKILL.md). Filing a PR does not authorize merging.
