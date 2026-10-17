---
name: gate
description: Run this repo's quality gates from .claude/sdlc.json (lint, typecheck, tests, builds) for the files changed on the branch. Use before opening a PR, after a rebase, or whenever you need to know whether the branch is green.
argument-hint: "[--all] [--stage=stop|pr]"
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs" run $ARGUMENTS
```

- With no arguments it runs every gate (`stop` and `pr` stages) whose `files` globs match a file changed on this branch: uncommitted, untracked, or committed since the merge-base with the default branch.
- `--all` ignores the changed-file filter. `--stage=stop` runs only the fast gates the Stop hook runs.
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs" list` shows what is configured.

If a gate fails, fix the root cause and re-run until everything passes.
Never weaken, skip or delete a check to get green.
If a failure is pre-existing and unrelated, still fix it when it is reasonably small; otherwise report it to the user with the output.
