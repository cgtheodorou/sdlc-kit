## Agentic workflow

This repo uses the [sdlc kit](https://github.com/cgtheodorou/sdlc-kit): `/sdlc:ship <issue>` takes a change from spec to PR, `/sdlc:review` reviews a branch, `/sdlc:gate` runs the quality gates.
Gates and formatters are declared in `.claude/sdlc.json`; the Stop hook will not let an agent finish while the fast gates fail, and the PR-stage gates mirror CI.
`@claude` on an issue or PR runs the same flow in GitHub Actions.
