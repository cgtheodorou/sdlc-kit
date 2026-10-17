# sdlc-kit

An agentic software development lifecycle for Claude Code, packaged as one plugin that works the same way in every repo.
Each repo only declares its own commands in `.claude/sdlc.json`; everything else lives here, versioned.

## Lifecycle

| Phase | How |
|---|---|
| Spec | `/sdlc:spec <issue>` writes acceptance criteria onto the GitHub issue (bugs get an E2E repro first) |
| Plan | `sdlc:planner` agent: files, commit sequence, risks, test plan |
| Implement | In an isolated worktree branch, never on the default branch |
| Gate | Formatters run on every edit; the Stop hook blocks finishing while fast gates fail; `/sdlc:gate` runs everything |
| Verify | `sdlc:verifier` agent drives the real app via the repo's own verify recipe and returns evidence |
| Review | `/sdlc:review`: spec, standards/correctness and security reviewers in parallel |
| Ship | PR with `Closes #n`, criteria checklist and evidence; CI watched until green |

`/sdlc:ship <issue>` runs all of it end to end.
In GitHub, `@claude` on an issue or PR runs the same flow, and every non-draft PR gets an automatic review.

## Install

In a repo, run `/sdlc:adopt` once (existing project) or `/sdlc:new <name>` (new project), after adding the marketplace:

```
/plugin marketplace add cgtheodorou/sdlc-kit
/plugin install sdlc@sdlc-kit
```

Adoption commits `.claude/settings.json` with the marketplace and plugin enabled, so collaborators get the kit after accepting the workspace trust prompt.
The hooks do nothing in a repo without `.claude/sdlc.json`, so installing the plugin at user scope is safe.

## `.claude/sdlc.json`

```json
{
  "format": [{ "files": "src/**/*.{ts,svelte}", "run": "npx eslint --fix {file}" }],
  "gates": [
    { "name": "typecheck", "files": "src/**", "run": "npm run check", "timeout": 180 },
    { "name": "e2e", "files": "src/**", "run": "npx playwright test", "stage": "pr" }
  ],
  "verify": "How to run and drive the product end to end, or the name of the project skill that does."
}
```

- `format`: runs after each Edit/Write on matching files; `{file}` is the path relative to `cwd`. Non-zero exits are fed back to Claude.
- `gates`: `files` globs (`*`, `**`, `?`, `{a,b}`) select which gates a change triggers; `cwd` defaults to the repo root; `timeout` is in seconds (default 300).
  `stage: "stop"` (default) gates run when the agent tries to finish; `stage: "pr"` gates run in `/sdlc:gate` and should mirror CI.
- Gates in the same `cwd` run sequentially; different `cwd`s run in parallel. Passing results are cached per tree state in `.git/sdlc-gate-state.json`.
- The Stop hook only runs when the working tree changed during the session, and blocks at most 3 times in a row before letting the agent stop with a warning.
- `SDLC_GATES=0` or `"disabled": true` turns everything off.

## GitHub agent setup (per repo, one time)

1. `claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN`.
2. Install the Claude GitHub App on the repo: `/install-github-app` or https://github.com/apps/claude.
3. The workflows from `plugins/sdlc/templates/github/` are added by `/sdlc:adopt`.

## Development

`npm test` runs the gate script's integration tests (Node 22+).
The plugin has no `version`, so every commit on `main` is an update; tag a release and pin `#vX.Y.Z` in a repo's marketplace source if it needs stability.
