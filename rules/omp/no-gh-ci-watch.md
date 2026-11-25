---
name: no-gh-ci-watch
description: "Never watch or wait on CI runs: no gh run watch, gh pr checks --watch, CI monitors, or wait calls on CI"
condition: ["\\bgh\\s+run\\s+watch\\b", "\\bgh\\s+pr\\s+checks\\b[^\\n]*--watch", "会话\\s*\\d+\\s*在盯", "(?i)waiting (for|on) PR #\\d+ CI", "(?i)monitor will wake"]
scope: ["tool", "text", "thinking"]
---

Never watch CI. That rules out:
- `gh run watch`;
- `gh pr checks --watch`;
- the `run_watch` op of `xd://github`;
- an `exec_command` terminal or `monitor` kept on a CI run;
- `wait` or ending the turn in order to be woken when CI finishes.

The user never authorized waiting on CI. A long CI run also breaks the 5-minute rule.

Do this instead:
- Read the run state once with `gh run view <id> --json status,conclusion,jobs`, and only when the next step depends on it.
- If the run is still going, mark the dependent todo blocked with the reason. Report the measured step durations and their cause.
- If CI is slow, fix the cause, such as the build inputs, instead of waiting it out.
- Start no watcher, poller or monitor reminder for CI.