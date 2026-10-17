---
name: adopt
description: Onboard an existing repository onto the sdlc kit - discover and verify its real build/test/lint/run commands, write .claude/sdlc.json, shared settings, CLAUDE.md additions and the Claude GitHub workflows, and fix the baseline so gates start green. Use when bringing an existing project under the agentic SDLC.
disable-model-invocation: true
argument-hint: "[--no-ci]"
---

Templates live in `${CLAUDE_PLUGIN_ROOT}/templates/`. Read them before writing the repo's files.

## 1. Survey (read-only)
- Stack and layout: manifests (`package.json`, `*.sln`/`*.csproj`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Package.swift`, ...), monorepo subprojects, existing CLAUDE.md files, `.claude/` (skills, settings), CI workflows, scripts, E2E harnesses.
- How CI builds, lints and tests each part. CI is the best source of truth for commands that actually work.
- Which files are generated or CI-owned (versions, changelogs, generated code), and which hosts are production.
- `git status` in the main checkout. Leave any uncommitted user changes alone.

## 2. Verify commands
For every candidate command, run it locally and record duration and result.
Only commands that run are allowed into the config.
Classify each one:
- `format`: per-file fixers that take well under ~5s per file (`rustfmt`, `prettier --write`, `eslint --fix`, `ruff format`, `gofmt -w`). Use `{file}` for the path.
- `stop` gates: whole-project checks that finish in roughly 90s or less (lint, typecheck, unit tests, a build that catches compile errors).
- `pr` gates: slower checks (full test suites, clippy on big crates, release builds). Prefer mirroring CI exactly.
Scope every gate with `files` globs so a change only triggers the checks it can affect.

## 3. Baseline
Run all gates with the new config (`node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs" run --all`).
Fix lint errors, failing tests and flakiness you find, in separate commits before the adoption commit.
If a fix is large, stop and ask the user whether to fix now or quarantine with a tracking issue.
Gates that start red teach agents to ignore them.

## 4. Write the repo layer (on a branch in a worktree, never the default branch)
- `.claude/sdlc.json`: from `templates/sdlc.example.json`. Include `verify` describing how to run the product for E2E checks (point to an existing skill when there is one).
- `.claude/settings.json` (committed, shared): from `templates/settings.json`. Merge into an existing file instead of overwriting.
  Add a permission allowlist for the repo's verified build, test and lint commands, and `deny` rules for destructive or production-touching commands you identified.
- A project `verify` skill under `.claude/skills/verify/` if the repo has no documented way to run and drive the product end to end. Write the recipe you actually used, including safety rules.
- CLAUDE.md: add a short `## Agentic workflow` section from `templates/claude-md-section.md`. Do not restate what CLAUDE.md already covers.
- Unless `--no-ci`: copy `templates/github/claude.yml` and `templates/github/claude-review.yml` into `.github/workflows/`.
  Adapt the setup steps (toolchains, package installs) to match the repo's existing CI so the agent can build and test in Actions.
  In `claude.yml`, set `--allowedTools` to the toolchain commands the gates use: in `@claude` mode the action ignores `.claude/settings.json` permissions and otherwise allows only read tools and committing.

## 5. Prove it
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs" run --all` passes.
- Touch a file covered by a formatter and confirm the PostToolUse hook runs it.
- Introduce a deliberate gate failure, confirm the Stop hook blocks with a useful reason, then revert it.

## 6. Hand off
Open a PR titled `chore: adopt the sdlc kit` with the gate list, timings, baseline fixes and anything quarantined.
Tell the user the one-time manual steps:
- `claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN` in the repo.
- Install the Claude GitHub App on the repo (`/install-github-app` or https://github.com/apps/claude).
- Other contributors accept the workspace trust prompt so the kit's marketplace and plugin auto-enable.
