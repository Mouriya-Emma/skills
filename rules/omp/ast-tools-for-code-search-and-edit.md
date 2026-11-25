---
name: ast-tools-for-code-search-and-edit
description: "Search and change TypeScript source with ast_grep/ast_edit, not grep or a hand-written multi-file edit"
condition: "\"path\":\"[^\"]*/src(/|\"|;)(?![^\"]*\\.(md|txt|json)\")"
scope: "tool:grep"
---

You are running `grep` on source code. To find calls, imports, declarations, constants or identifier uses in `.ts`/`.tsx`, use `ast_grep` with a structural pattern (`localHostProfileRef($$$)`, `const SINGLE_HOST = $V`, `import { $$$ } from './session-local.js'`).

When the same change lands at several sites or files (for example, replacing every `hostId: 'local'` with a value from `getWebLocalHost()`), locate the sites with `ast_grep` and apply the change with `ast_edit`. Do not hand-write one multi-file `edit`.

Keep `grep` for literal text in non-code files: tsc output, logs, docs and config. Keep `edit` for a single, one-off change that is not structural.