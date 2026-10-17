---
name: new
description: Bootstrap a brand-new project with the sdlc kit from day one - scaffold the stack with official generators, wire tests, lint, formatting, CI and an E2E harness, create the GitHub repo, then adopt it. Use when starting a new repo or project.
disable-model-invocation: true
argument-hint: "<name> [stack description]"
---

1. Pin down the project with at most 4 questions in one round, each with a recommended default: what it is, stack, deploy target, public or private repo.
   Skip anything `$ARGUMENTS` already answers.
2. Scaffold with the stack's official generator at its current version (look the generator and flags up in current docs, do not rely on memory), e.g. `npx sv create`, `npm create cloudflare@latest`, `dotnet new`, `cargo new`, `uv init`.
   Create `~/source/<name>` unless the user names another location.
3. Wire the essentials before any feature code, each one verified to run:
   - Strict type checking and a linter with the stack's recommended rules; a formatter.
   - A unit test runner with one real test.
   - An E2E harness that drives the real app (Playwright for web, the platform's UI test runner for mobile) with one smoke test.
   - A `README.md` with how to run, test and deploy.
   - A root `CLAUDE.md`: purpose, architecture, layout, commands, and a "Key design decisions" section that starts empty and grows with the project.
   - CI from `${CLAUDE_PLUGIN_ROOT}/templates/github/ci.yml` adapted to the stack: install, lint, typecheck, unit tests, E2E smoke.
4. `git init -b main`, commit (`chore: scaffold <name>`), create the GitHub repo (`gh repo create <owner>/<name> --source . --push` with the visibility the user picked).
5. Run the `sdlc:adopt` flow on the new repo.
   For a new repo, the adoption changes can land directly on `main` as the second commit, since nobody else is working on it.
6. Report the repo URL, the commands, and the one-time manual steps from adopt's hand-off.
