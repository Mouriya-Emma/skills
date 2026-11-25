---
name: no-manual-github-polling
description: "Never poll GitHub by hand: no `gh run watch`, `--watch`, sleep-then-gh, or gh in while/until loops"
condition: ["\\bgh run watch\\b", "\\bgh pr checks\\b[^\"]{0,200}--watch", "\\bsleep \\d+\\s*(;|&&)\\s*(gh|ghc|[^\"]{0,80}gh-contract)\\b", "\\b(while|until)\\b[^\"]{0,200}\\bgh (api|pr|run|issue)\\b", "\\bfor \\w+ in [^\"]{0,200};\\s*do\\s+gh run (watch|view)\\b"]
scope: ["tool:bash", "tool:exec_command", "tool:eval"]
---

Do not poll GitHub by hand. All sessions on this machine share one RiriAgent REST quota (5000/h). `gh run watch` polls about every 3 s; several of them running at once used up the whole quota and blocked every session.

Do not use:
- `gh run watch` or `gh pr checks --watch`
- `sleep N; gh …` or `sleep N; ghc …`
- `while`/`until` loops that call `gh`
- a `for` loop that watches several runs

Do this instead:
- To wait for CI, use the `github` device with `op: run_watch`, and keep at most one waiter per session. Otherwise check the run once, do other work, and check once more later.
- When the REST quota is exhausted, do not retry and do not loop on `gh api rate_limit`. Work locally until the reset time and do GitHub operations after it.
- Each GitHub read must answer a question you need answered right now. Do not use it as a heartbeat.