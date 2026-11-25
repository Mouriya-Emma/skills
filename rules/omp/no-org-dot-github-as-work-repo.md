---
name: no-org-dot-github-as-work-repo
description: "Never use an org's .github repository (e.g. oh-my-omp/.github) as a working repo: no branches, commits, pushes, PRs or edits there"
condition: ["oh-my-omp-dot-github", "[A-Za-z0-9_-]+/\\.github\\b(?!/workflows/)", "--repo\\s+[A-Za-z0-9_-]+/\\.github\\b"]
scope: ["tool:bash", "tool:write", "tool:edit"]
---

Do not use any `<org>/.github` repository as a working repository: no clones, worktrees, branches, commits, pushes, PRs or file edits there, and no buffer or tree branches. This holds even when an issue body names it under `Repo:`.

Do not reference anything in `<org>/.github` from other repositories either: no `uses: <org>/.github/...` reusable workflows, actions or scripts; each repository runs its own workflows.

If a task seems to need changes in `<org>/.github`, stop. Tell the user which change you planned there and why, then wait for their instruction on where the work belongs.