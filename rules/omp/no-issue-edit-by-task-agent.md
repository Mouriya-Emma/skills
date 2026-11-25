---
name: no-issue-edit-by-task-agent
description: "A task agent must not edit a GitHub issue's body or acceptance rows; report the infeasible row and wait for the user"
condition: ["gh issue edit\\b", "issue edit [0-9]+ [^\"]*--body", "/repos/[^\"]*/issues/[0-9]+[^\"]*(-X|--method) (PATCH|POST)"]
scope: ["tool:bash", "tool:exec_command"]
---

A task agent has no authority to change an issue. That covers its body, acceptance rows, Expect, Env, tested surface, impact scope and the test tool it names (for example replacing `ego-browser` with Playwright). It also covers posting revision comments that redefine acceptance.

When a row looks infeasible or wrong:
- Do not run `gh issue edit` or the GitHub API against the issue, and do not adapt the acceptance to fit a test you can write.
- Report to the user: the exact row, the evidence that it cannot be met as written, and the change you would propose.
- Stop work on that row until the user decides, and keep doing the reachable work that still matches the issue as written.