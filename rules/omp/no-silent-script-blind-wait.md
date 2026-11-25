---
name: no-silent-script-blind-wait
description: "Never run output-less scripts and block on them with sleep/pidwait/watch; run logged scripts via exec_command and read the log"
condition: ["\\bpidwait\\b", "\\bsleep\\s+(?:[1-9]\\d{1,})\\b", "(?:\\.sh|run watch|--watch)[^\"]{0,120}>\\s*/dev/null", "\\btimeout\\s+\\d+\\s+(?:pidwait|tail -f|gh run watch)"]
scope: ["tool:bash", "tool:exec_command"]
---

Do not start a script whose output goes nowhere and then block on it with `sleep N`, `pidwait`, `timeout … pidwait`, or `gh run watch … >/dev/null`. This leaves the work unwatched and can poll forever: three `gh run watch` loops used up the GitHub REST quota, and owners sat in `sleep 290` or `pidwait -f ev-all.sh` loops.

Do this instead:
- Start long work with `exec_command`, and have the script write a complete log: `cmd > /tmp/<dir>/<name>.log 2>&1; echo EXIT=$? >> /tmp/<dir>/<name>.log`. The log has a start marker, per-step markers, and an exit code.
- Read the log, or let the exec session's own output wake you. Do not sleep-poll. Do not chain waits.
- Use the waiting time for other reachable work: integration, PR text, evidence assembly, or dispatching slices.
- Never discard a watcher's output to `/dev/null`. Never run `--watch` polling against the GitHub API.