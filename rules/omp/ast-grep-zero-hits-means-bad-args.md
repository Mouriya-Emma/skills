---
name: ast-grep-zero-hits-means-bad-args
description: "When ast_grep finds nothing, fix your own arguments and never blame or abandon the tool"
condition: ["\\bpat\"?\\s*:\\s*\\[", "ast_grep[^\\n]{0,80}(匹配不到|搜不到|故障|不可靠|失灵|改用文本搜索|改用\\s*`?grep)"]
scope: ["tool", "text"]
---

`ast_grep` is correct. Zero hits mean your call is wrong. Never conclude that the tool is broken, and never fall back to `grep` for that reason.

- `pat` is ONE string. Never pass an array or a number: the host JSON-stringifies them (`["x($$$)"]`) and silently searches for an array literal, which returns 0 hits with no error.
- Write `path` as a glob over code files (`dir/**/*.ts`). A bare directory also parses `.md` files, and their hits are noise.
- TS functions with annotations need `$_` slots: `export function $NAME($$$): $_ { $$$ }`.
- Before claiming something is absent, run a self-check: search a bare identifier you know exists, with a string `pat`, on the same narrow `path`. If that check also misses, the fault is still in your arguments; re-read `tool://ast_grep/patterns` and `tool://ast_grep/scope`.