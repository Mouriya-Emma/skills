---
name: evidence-run-five-minute-budget
description: "Test scripts, probes and acceptance-evidence runs must finish within 5 minutes; never watch or wait on a longer chain"
condition: ["while ! grep -q[^\\n]{0,80}EXIT=", "remind_after_ms\\\\?\"?\\s*:\\s*(?:[4-9]\\d{5}|\\d{7,})", "(?:已|已经)?(?:运行|跑)了?\\s*(?:约\\s*)?(?:[5-9]|[1-9]\\d)\\s*分(?:钟|\\s*\\d+\\s*秒)"]
scope: ["tool", "text"]
---

Any test script, probe or acceptance/evidence collection that cannot finish within **5 minutes** is a major violation. Do not set up a watcher, a long monitor reminder or progress reports for it. Stop it and fix the cause.

- Each `ghc ev run` covers one acceptance row against instances that are already running, with `--timeout 300` or less. Do not chain rows, rebuilds, reseeds and full gates into one long script.
- When a step runs over, measure where the time goes: per-test durations, page load, store latency. Then fix the cause:
  - Shrink the data, for example a small store copy instead of 209 runs.
  - Split the rows into separate short runs.
  - Reuse a gate run that already finished on the same HEAD.
  - If the slowness comes from the product or the tests, such as tests that wait out real 60 s bounds instead of using an injected clock, open a new issue for it.
- Report the measured duration and its cause to the user. Do not let a 20-minute chain run silently while you wait on it.